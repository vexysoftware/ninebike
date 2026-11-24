# NINEBIKE OS — registro de progresso da implementação

Baseline da especificação: v2.10.0 (hashes em [`specs/baseline.json`](../baseline.json)). Retomada da implementação por orientação explícita do responsável em 18/11/2026.

Dois estados separados, como exige o guia (§2.1): **código verificado** (testes passaram neste repositório) e **capacidade habilitada no ambiente** (só após configuração/homologação no projeto real). Nenhuma tarefa abaixo está marcada como concluída por inteiro.

## Evidência desta entrega — 18/11/2026

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` (Vite + `wrangler deploy --dry-run --env production`) | PASS — bundle do Worker ~211 KiB |
| `npm run test:unit` | PASS — regras de cadastro, documentos, aniversário, dinheiro como string, MFA ≤ 300 s |
| `npm run test:db` | PASS — PostgreSQL 16 real, sessões concorrentes independentes |
| `npm run test:integration` | PASS — API com banco real |
| `npm run test:e2e` | PASS — 4 jornadas no Chromium contra o Worker em `wrangler dev` (workerd) |
| Ambiente | Local, dados sintéticos. Nenhum dado real, nenhum projeto Supabase/Cloudflare provisionado. |

## T01 — Runtime, identidade e segurança

**Código verificado**
- Worker único (`src/worker.ts`): `/api/v1`, `/public/v1` e SPA por assets; executado em workerd local.
- Supabase Auth: validação de JWT (assinatura via JWKS ou segredo HS256, issuer, audiência, expiração, `role=authenticated`); MFA recente = `aal2` + `amr.totp` com 0 ≤ idade ≤ 300 s, falha fechada.
- Perfis SELLER/OWNER com teto fechado de permissões; revalidação do perfil **ativo** no banco a cada chamada (JWT válido de perfil desativado → 401).
- Convite → perfil criado por trigger em `auth.users` somente com convite pendente; signup sem convite não ganha acesso.
- Troca de perfil/ativação: OWNER + MFA recente + versão; último OWNER ativo protegido sob lock.
- Banco: browser (`anon`/`authenticated`) sem acesso a tabelas ou RPCs; Worker conecta como `ninebike_api` e só executa `api.*`; RLS ligada em todas as tabelas; funções internas não executáveis pelo backend.
- Contrato HTTP: payload fechado (campo desconhecido → 422), erros estáveis `{code,message,details,request_id}`, `Idempotency-Key` obrigatória com recibo persistido na mesma transação (mesma chave+hash → resposta original; hash diferente → 409), cursor opaco vinculado aos filtros, `Cache-Control: no-store`, CSP/headers via `public/_headers`.
- Auditoria append-only (trigger bloqueia UPDATE/DELETE inclusive do dono da tabela).
- Interface: shell 240 px, temas Claro/Escuro/Sistema (tokens do design.md), login, configurações de equipe/convites/MFA.

**Pendente**
- Concessões avulsas (`permission_grants`) e escopo compartilhado configurável: não implementados; o teto por perfil é o único escopo nesta versão.
- MFA TOTP só pode ser exercitado num projeto Supabase real (enroll/challenge pelo SDK). Em local, o login de desenvolvimento emite token `aal2` sintético — rota 404 fora de `ENVIRONMENT=local` (testado).
- Rate limit genérico da API (há limite apenas na captura pública).
- Habilitação: projeto Supabase/Hyperdrive/domínio de staging e produção não provisionados.

## T02 — Contatos, fornecedores, CRM, pipeline e landing

**Código verificado**
- Lead com nome + celular; CPF/e-mail/observação opcionais e validados quando preenchidos; PATCH distingue omitido de `null`; celular de cliente não pode ser limpo.
- Contato único com papéis CUSTOMER/SUPPLIER; fornecedor só com nome + PF/PJ; adicionar papel cliente exige celular; nada é mesclado automaticamente (telefone compartilhado gera aviso de possível duplicata, só entre contatos visíveis).
- Carteira: SELLER vê contatos próprios/das suas oportunidades (fora do escopo → 404); OWNER vê a loja.
- Pipeline com etapas padrão da spec; posição inteira persistida; movimento com versões da oportunidade e `cards_version` das etapas sob lock em ordem estável; âncora antes/depois; Perdido exige motivo; mover não cria efeito financeiro/estoque. Concorrência provada com sessões reais (um grava, outro 409; posições contíguas).
- Etapas: criar, renomear, reordenar (lista completa + versões sob advisory lock), arquivar só vazia e nunca a última do tipo.
- Atividades humanas (anotação, contato, tarefa com retorno), agenda de retornos, histórico pela auditoria.
- Aniversário opcional (29/02 sem ano válido, 31/04 inválido, nascimento futuro negado); lista por período semiaberto em America/Sao_Paulo, só PF confirmado, 29/02 em ano comum como exceção explícita, sem idade quando falta ano.
- Captura pública: `submission_id` idempotente (3 reenvios = 1 contato + 1 oportunidade), conteúdo diferente → 409, resposta sem PII, sem responsável configurado → 503 sem gravar, limite de 5 envios/10 min por IP (hash).
- Interface: Kanban com arraste (mouse/toque/teclado) e menu “Mover para” equivalente; lista; detalhe da oportunidade; contatos; fornecedores; aniversariantes; landing.

**Pendente**
- Mesclagem aprovada de contatos (`merge-requests`), compartilhamento explícito de oportunidade (`opportunity_access` existe, sem rota).
- Reordenar colunas por arraste (há botões subir/descer acessíveis em Configurações).
- Captcha/Turnstile na landing.

## T03 — Catálogo, fotos e estoque

**Código verificado**
- Produto com nome + quantidade inicial; BIKE por padrão; SKU automático; N bikes → N unidades internas `BK-000001` e N movimentos RECEIPT na mesma transação; quantidade zero não cria nada.
- Série opcional; série preenchida duplicada negada (normalizada) e nada é gravado.
- Acessórios por saldo (`quantity_balances`) com CHECK de não negatividade; bikes contadas só pelas unidades.
- Entrada, ajuste (+/−) e recontagem como movimentos append-only com motivo e autor; baixa de bike exige identificar a unidade; recontagem com unidades reservadas/comprometidas ausentes → conflito; versão de estoque concorrente → 409.
- Custo por entrada guardado no movimento/unidade; custo ausente = `null` (nunca zero). SELLER não recebe custo, fornecedor nem movimentos (verificado na API e no navegador).
- Arquivar preserva histórico e bloqueia novas entradas.
- Fotos: fluxo PENDING → upload assinado → verificação dos bytes reais (assinatura JPEG/PNG/WebP, tamanho, SHA-256) → READY; URL de leitura curta. Sem Storage configurado → 503 `CAPABILITY_UNAVAILABLE`.

**Pendente**
- Reservas (o planejamento liga reserva a proposta: entram com T04).
- Inspeção/manutenção de devolução (T04/T08).
- Fotos: adaptador Supabase Storage escrito, **não exercitado** contra um projeto real.
- Abertura de estoque de itens migrados (`UNKNOWN` → recontagem com confirmação) existe no banco, sem tela própria; depende da migração T13.

## T04 + T05 (núcleo) — 19/11/2026

**Código verificado**
- Política comercial versionada (prazo de reserva, validade, alçada de desconto da vendedora); sem política não há proposta nem reserva.
- Proposta versionada por série; preço sempre do catálogo no servidor; desconto acima da alçada → `APPROVAL_REQUIRED`.
- Reserva em grupo tudo-ou-nada sob lock; disputa pela última bike com sessões reais → uma ativa; expiração por estado persistido.
- Confirmação atômica: pedido (número interno), itens com snapshot de preço e custo histórico (`null` se desconhecido), unidades comprometidas, condições de pagamento somando o total e comissão por alvos cumulativos `floor((B*15+500)/1000)`; duas confirmações concorrentes → um pedido.
- Registro de vendas (lista/detalhe/totais), escopo da vendedora, sem custo; cancelamento sem pagamento devolve o estoque.
- `money.ts` com bigint e 10.000 casos de rateio.

**Bloqueado (externo):** cobrança, recebimento, split efetivo e entrega dependem do PSP (T07). As rotas respondem 503; nada é simulado.

## T11 — preparo fiscal (modo UNDECIDED) — 19/11/2026

**Código verificado**
- Rascunho criado a partir do pedido; um documento vivo por pedido; vendedora prepara só da própria venda.
- Validação local de campos exigidos (destinatário/documento, endereço para NF-e, NCM/CFOP por item, totais × pedido, emitente). Não é validação de XSD.
- Aprovação humana: somente OWNER, MFA recente, sobre o hash exato da revisão; qualquer edição posterior invalida a aprovação.
- Envio: 503 `issuer_not_homologated` — nenhuma transmissão.
- Vínculo da nota autorizada no emissor atual (chave de 44 dígitos única, série/número/protocolo), sem reemitir.

**Pendente:** tributos (dependem de perfil fiscal com contador), XML/DANFE/provedor, cancelamento/CC-e, pacote mensal, importação de XMLs.

## IA do WhatsApp (n8n) + T16 comissão da equipe — 24/11/2026

**Decisão do responsável (24/11/2026):** integrar a IA do WhatsApp (n8n) ao sistema. Isso substitui a restrição “não provisionar credencial n8n” de contracts/api.md §129, com escopo mínimo.

**Código verificado** (`tests/db/agent-commissions.test.ts`)
- Chaves de API por integração:
  - criadas só pelo OWNER, com MFA recente;
  - o segredo aparece uma vez e o banco guarda apenas o hash SHA-256;
  - podem ser revogadas na hora;
  - limite de 120 requisições por minuto, uso registrado.
- Escopos: `catalog.read`, `customers.read` e `leads.write`. Um JWT humano não vale nas rotas `/agent/v1`, e uma chave sem o escopo recebe 403.
- O que a IA consulta e registra:
  - produtos com preço formatado e disponibilidade (estoque não conferido vem como “desconhecido”), sem custo, fornecedor ou unidades;
  - cliente pelo celular ou JID do WhatsApp: nome, vendedor, oportunidades abertas e pedidos resumidos, sem CPF, e-mail ou endereço;
  - lead ou anotação: mesmo celular não duplica contato, `event_id` é idempotente e o conteúdo vai para o histórico da oportunidade.
- Comissão da equipe:
  - regra versionada pelo OWNER, com percentual padrão e exceção por vendedor, sobre o valor do pedido sem frete;
  - o lançamento é gravado na confirmação do pedido, com snapshot da regra;
  - sem regra, não há valor presumido;
  - o cancelamento estorna o lançamento;
  - o OWNER marca como paga manualmente (sem transferência automática);
  - a vendedora vê só o próprio extrato.
- Telas: **Comissões** (resumo por vendedor, lançamentos, regra) e **Configurações → Integração com a IA do WhatsApp**. Guia em `docs/operations/n8n-ia.md`.

**Pendente:** link de pagamento depende do PSP (T07). A IA não gera cobrança.

## T10 (parte interna) e visão geral — 24/11/2026

**Código verificado** (`tests/db/expenses.test.ts`)
- Despesas e contas a pagar (permissão `finance.manage`, só OWNER):
  - categorias com classificação (operacional, imposto, financeira, fora do resultado);
  - competência separada do vencimento;
  - parcelas mensais sem perder centavo;
  - baixa parcial com lock e versão, sem sobrequitação;
  - estorno de baixa com motivo;
  - cancelamento só sem baixa ativa.
- Resultado gerencial do mês:
  - receita por pedido confirmado (sem frete), CMV pelo custo histórico do pedido, comissões, impostos e despesas por competência;
  - custo ausente deixa o resultado PARCIAL;
  - avisos para imposto não lançado e para taxas do meio de pagamento ainda não integradas;
  - pago no mês (caixa) aparece separado.
- Visão geral: vendas do mês e do mês anterior, ticket médio, ranking por vendedor (OWNER), comissão própria, leads de 7 dias (site e IA), estoque baixo e notas aguardando revisão.

**Pendente (T10):** conciliação com extrato do PSP, contas a receber oficiais, fechamento mensal versionado e saldos de abertura.

## Automação e segurança — 25/11/2026

**Código verificado** (`tests/db/automation.test.ts`)

Automação:
- Tarefas automáticas: "Responder lead" em 1 h para lead do site ou da IA; pós-venda em 7 e 30 dias para a vendedora.
- Fila de eventos (outbox) para webhooks:
  - eventos lead novo, venda confirmada, venda cancelada e nota pronta para revisão;
  - assinatura HMAC-SHA256 com timestamp;
  - backoff exponencial, desistindo após 12 tentativas;
  - payload sem CPF, e-mail ou custo;
  - URL só `https` pública (bloqueio de SSRF: loopback, rede privada, IPv6 literal e credenciais na URL);
  - segredo de assinatura mostrado uma vez.
- Cron do Worker a cada 5 minutos: expira reservas vencidas, entrega webhooks e limpa registros técnicos.

Segurança:
- Chave da IA com lista de IPs permitidos (lidos de `cf-connecting-ip`) e validade.
- Limite por usuário humano de 600 requisições por minuto (resposta 429).

## IA: visitas, cobranças e comissão da operadora — 25/11/2026

**Decisão do responsável:** a IA tem autonomia para registrar visitas e cobranças (Pix/link), e as vendas de clientes trazidos por ela formam a base de comissão da operadora da IA.

**Código verificado** (`tests/db/ai-visits-charges.test.ts`)
- Escopos novos `visits.write` e `payments.write`.
- Visitas:
  - criadas pela IA, com cliente e tarefa automáticos e idempotência;
  - a IA pode remarcar ou cancelar só visita ainda agendada;
  - comparecimento ou não comparecimento é marcado pela loja.
- Cobranças da IA:
  - registro da cobrança, depois "pago (informado)" por id ou por provider + external_id, com repetição tolerada;
  - conferência do dono ("caiu na conta" ou "não caiu");
  - tarefa automática para conferir.
- Atribuição de cliente à IA:
  - motivo do primeiro contato: lead, visita ou cobrança;
  - cliente com compra anterior não é reivindicado;
  - o dono pode contestar, com motivo.
- Relatório "Resultados da IA":
  - vendas atribuídas dentro da janela, mais cobranças pagas sem pedido;
  - comissão confirmada separada de comissão a confirmar;
  - regra versionada (percentual e janela) definida pelo dono com MFA.

**Limites:** a IA não aprova nota, não cancela venda, não altera preço, estoque ou usuários e não apaga nada.

## Próximas

T10 (despesas, contas a pagar/receber gerenciais, DRE com completude) e T16 em rascunho; T13 importação dos CSVs; T06 só quando existir o primeiro efeito externo. T07–T09/T15 aguardam o PSP; T12 após T14.

## Cenários de aceite cobertos por teste automatizado nesta entrega

Cobertura parcial (o teste exercita o comportamento descrito, sem declarar o cenário inteiro aprovado em homologação): CRM-05/06, CON-01/02, EST-05/06/08/09, LOJ-42/43 (aniversário), SEG-01/02/16 (negação no servidor/banco), idempotência de lead (T02) e de comandos.
