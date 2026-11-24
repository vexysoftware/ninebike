# IA do WhatsApp (n8n) ↔ Ninebike OS

A IA que atende no WhatsApp usa estas rotas para consultar o sistema **na hora de responder**. São rotas de uso interno da loja e não formam uma API pública.

## 1. Gerar a chave

1. Em **Configurações → Integração com a IA do WhatsApp**, o proprietário gera a chave. A geração exige MFA recente.
2. Copie a chave `nbk_…`, porque ela aparece uma única vez. O banco guarda apenas o hash.
3. No n8n, crie uma credencial **Header Auth** com:
   - Nome do cabeçalho: `Authorization`
   - Valor: `Bearer nbk_…`
4. Para cortar o acesso na hora, use **Revogar**. Uma chave vazada deve ser revogada e substituída por uma nova.

URL base: `https://<domínio-do-sistema>/agent/v1`

Limite: 120 requisições por minuto por chave. Acima disso a resposta é `429`.

## 2. O que a IA pode fazer

A IA tem acesso apenas às três permissões abaixo.

| Permissão | Rota | Para quê |
| --- | --- | --- |
| `catalog.read` | `GET /products?q=&type=BIKE\|ACCESSORY&only_available=true&limit=10` | Buscar modelos, preço e disponibilidade |
| `catalog.read` | `GET /products/{id}` | Detalhe de um modelo |
| `customers.read` | `GET /customers/by-phone?phone=<número ou JID>` | Saber se o contato já é cliente, quem é o vendedor e o que já comprou |
| `leads.write` | `POST /leads` | Registrar lead ou anotação da conversa no CRM |

A IA **não** acessa:
- custo, margem ou fornecedor;
- CPF, e-mail ou endereço;
- financeiro, notas fiscais ou usuários;
- alterações de estoque, preço, proposta ou pedido.

Vender, dar desconto ou reservar continua sendo trabalho do vendedor, dentro do sistema.

Em `phone` e `mobile_phone`, a IA pode mandar o JID do WhatsApp direto, por exemplo `5511999998888@s.whatsapp.net`. O formato antigo, sem o nono dígito, também é aceito.

## 3. Exemplos (nó HTTP Request do n8n)

### Buscar estoque

```
GET /agent/v1/products?q=bike elétrica aro 26&only_available=true
```

Resposta:

```json
{ "data": [ { "id": "…", "name": "Bike elétrica Urban 350W", "type": "BIKE", "brand": "…", "color": "Preta",
  "price_cents": "1249990", "price_display": "R$ 12.499,90",
  "stock": { "known": true, "available": 2, "in_stock": true } } ] }
```

Quando `stock.known` vem `false`, o estoque daquele item ainda não foi conferido. Nesse caso, a IA não deve afirmar que o produto está disponível. Deve dizer que vai confirmar com o vendedor.

### Reconhecer o cliente

```
GET /agent/v1/customers/by-phone?phone={{ $json.from }}
```

Resposta:
- `{ "found": false }` quando o contato não é cliente;
- quando é, os campos `name`, `first_name`, `seller_name`, `birthday_today`, `open_opportunities[]` (etapa e produto de interesse) e `recent_orders[]` (número, data, situação, entrega, total e itens).

### Registrar lead ou anotação

```
POST /agent/v1/leads
Content-Type: application/json

{ "event_id": "{{ $json.messageId convertido em UUID }}", "name": "{{ $json.pushName }}",
  "mobile_phone": "{{ $json.from }}", "note": "Quer bike elétrica até R$ 10 mil, usa para trabalho",
  "interest_product_id": "<id opcional vindo da busca>" }
```

Comportamento:
- Celular novo: cria o contato e uma oportunidade na primeira etapa do pipeline, atribuída ao **responsável pelos novos leads** definido em Configurações. Sem responsável configurado, a resposta é `503`.
- Celular já cadastrado: reaproveita o contato e a oportunidade aberta e só acrescenta a anotação `[IA WhatsApp] …`, que o vendedor vê no histórico.
- `event_id` precisa ser um UUID estável por evento. Reenviar o mesmo `event_id` devolve o mesmo resultado sem duplicar. Mudar o conteúdo com o mesmo `event_id` gera `409`.
- Para gerar um UUID estável no n8n a partir do id da mensagem, use um nó Code:

  ```js
  const h = require('crypto').createHash('sha1').update($json.messageId).digest('hex');
  return { event_id: `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}` };
  ```

## 4. Uso sugerido no agente (AI Agent do n8n)

Exponha as três rotas como ferramentas (HTTP Request Tool), com instruções como estas:

- **consultar_estoque(q)**: "Use sempre antes de citar preço ou disponibilidade. Nunca invente preço. Se `stock.known=false` ou `available=0`, diga que vai verificar com o vendedor."
- **identificar_cliente(phone)**: "Chame no início da conversa. Se o contato for cliente, cumprimente pelo primeiro nome e, se fizer sentido, cite o vendedor que o atende."
- **registrar_lead(name, phone, note)**: "Chame quando o cliente demonstrar interesse (modelo, faixa de preço, test ride, parcelamento). Escreva na nota um resumo curto e objetivo para o vendedor."

Mantenha fora do prompt promessas de desconto, prazo de entrega ou condição de pagamento que não venham do vendedor.

## 5. Erros

| HTTP | `code` | Ação no fluxo |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | Chave ausente, errada ou revogada. Gerar nova. |
| 403 | `PERMISSION_DENIED` | A chave não tem a permissão. Gerar outra com a permissão marcada. |
| 422 | `VALIDATION_FAILED` | Celular inválido ou campo faltando (`details.field`). |
| 429 | `RATE_LIMITED` | Aguardar e tentar de novo. |
| 503 | `CAPABILITY_UNAVAILABLE` | Falta configurar o responsável pelos leads. |
