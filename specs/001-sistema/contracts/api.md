# NINEBIKE OS — contrato interno HTTP v1

**Atualização v2.10.0 — 26/10/2026:** implementação suspensa por pedido do responsável; provedor financeiro em revisão (recebimento integral D+1, condições comerciais em revisão privada). O fiscal reúne Olist e SHOP Simples com aprovação/confirmação humanas; o responsável confirmou que os dados saem pendentes do Olist e são aprovados/emitidos no SHOP; arquivo/layout e homologação ainda precisam de validação. As referências financeiras anteriores não representam fornecedor atualmente escolhido. Ver [decisões atuais](../../../README.md) e [fluxo fiscal](../fiscal.md).

Data: 26/10/2026. Baseline documental v2.10.0, preservando clientes/fornecedores, gastos, resultado e equipe e incluindo o fluxo fiscal unificado com decisão humana. Implementação suspensa e testes pendentes. SHOP Simples foi identificado; a saída pendente no Olist e a aprovação/emissão no SHOP foram confirmadas pelo responsável; arquivo/layout e provedor/configuração de emissão ainda precisam de validação, sem adaptador de destino presumido.
Regras: [spec.md](../spec.md). Fronteiras e execução: [architecture.md](../architecture.md). Persistência: [data-model.md](../data-model.md). Fiscal: [fiscal.md](../fiscal.md).
Este contrato atende SPA e Worker da mesma loja; não cria uma plataforma pública, SDK ou portal de desenvolvedores.

**Direção v2.10.0:** o produto reúne as funções selecionadas do Olist e a conferência/gestão fiscal observada no SHOP Simples. O responsável confirmou Olist pendente → SHOP aprova/emite; a passagem técnica exige validar arquivo/layout; o Ninebike usa provedor homologado (OS_PRIMARY somente após configuração/testes). A implementação permanece suspensa. UNDECIDED continua bloqueando transmissão antes da ativação; EXTERNAL_PRIMARY é alternativa futura/migração, sem implementação antecipada nem emissão dupla. Execução em [build-guide.md](../build-guide.md).

## 1. Convenções e autorização

- Base `/api/v1`; JSON UTF-8; campos `snake_case`; IDs internos UUID; IDs externos opacos, separados dos internos.
- `MoneyCents`: string decimal sem sinal, separador ou zeros excedentes, conforme `^(0|[1-9][0-9]*)$`; moeda `BRL`. Comandos financeiros exigem valor maior que zero, limite validado e cálculo inteiro sem overflow. Nenhum valor monetário JSON usa ponto flutuante.
- Consultas usam `SignedMoneyCents` para saldo/resultado/delta, conforme `^(0|-?[1-9][0-9]*)$`. Valor desconhecido/incompleto é `null`, com motivo; não converter para `"0"`. Percentuais são strings decimais calculadas no servidor e podem ser `null` quando o denominador não for positivo ou a base estiver incompleta.
- `FiscalDecimal` é string decimal não negativa sem expoente/separador de milhar, conforme `^(0|[1-9][0-9]*)(\.[0-9]+)?$`, para quantidade/preço unitário/alíquota fiscal. Escala máxima, unidade e arredondamento vêm do XSD/perfil aceitos; não usar float/toFixed nem converter quantidade fiscal em movimento de estoque. Totais monetários usam MoneyCents; código NCM/CFOP/CST/CSOSN permanece string para preservar zeros.
- Instantes: ISO 8601 UTC com `Z`; datas civis/vencimentos: `YYYY-MM-DD`, com interpretação comercial `America/Sao_Paulo`. Não converter vencimento em timestamp implícito.
- `expected_version`: inteiro positivo da entidade alterada; comparação e incremento ocorrem no commit. Recursos relacionados recebem versões específicas quando o comando depende delas.
- Requisição autenticada: `Authorization: Bearer <Supabase JWT>`, validado por `getClaims`/JWKS com assinatura, issuer/projeto, audiência e expiração; consultar vínculo ativo e permissões atuais inclusive no commit. Browser só recebe configuração publicável; nunca `service_role`, API key ou wallet operacional.
- `actor_id`, organização, papéis, conta emissora, regra/carteira de comissão e valores derivados vêm do servidor. Campos desconhecidos em comandos são rejeitados com `422`; consultas e eventos externos toleram campos adicionais.
- Permissão inclui ação **e** escopo de carteira/equipe/recurso; concessão não ultrapassa teto do perfil nem implica poderes não concedidos. Recurso fora do escopo retorna `404`; ação vedada sobre recurso visível retorna `403`.
- OWNER exigem MFA `aal2`; aprovação e execução sensível exigem JWT validado com `aal=aal2`, `session_id` e entrada `amr.method=totp` cujo timestamp satisfaça `0 <= server_now - timestamp <= 300` segundos. Horário futuro, ausência de AMR ou timestamp antigo falham fechado. Refresh/`iat` recente não renovam MFA. O servidor vincula `sub`, `session_id`, timestamp TOTP e hash da intenção à aprovação/auditoria; nenhum desses dados é aceito do body. [Claims oficiais Supabase](https://supabase.com/docs/guides/auth/jwt-fields).
- O ID de desafio Supabase identifica um desafio, não comprova sua verificação. Não há `challenge_id` ou prova opaca própria nos comandos v1. Se o projeto não emitir evidência suficiente, bloquear atos sensíveis até implementar e homologar verificação real no backend, com contrato próprio; não aceitar token de prova inventado.
- Manutenção técnica é excepcional/temporária/auditada, sem perfil humano alternativo ou movimentação de dinheiro. Exportações usam permissão própria e registram finalidade.
- Respostas internas levam `X-Request-Id`; dados financeiros/pessoais usam `Cache-Control: no-store`. CORS é restrito às origens da aplicação; rate limit retorna `429` e `Retry-After`.
- Login, refresh, MFA e logout usam SDK oficial Supabase Auth; sessão em `sessionStorage` por aba, sem cookies de autenticação customizados. `/session` devolve vínculo/permissões efetivas. Cadastro de funcionário é por convite; o OS não recria endpoints de login.
- Token acessível por JavaScript mantém risco de XSS: CSP forte, sem scripts de terceiros no `/app`, conteúdo sanitizado e dependências fixadas. MFA/reautenticação recente continua obrigatória para dinheiro e não elimina esse risco.
- Comissão de software e comissão da equipe têm permissões/recursos distintos. `staff_commissions.read:self` resolve funcionário a partir do vínculo autenticado; mudar filtro/UUID não amplia escopo. Fornecedores, custos, categorias, resultado e baixas exigem grants próprios; papel de contato não concede permissão bancária.

## 2. Respostas, paginação e idempotência

```json
{"data":{"id":"3a5c2dd0-9781-44e8-bb51-d060ce00a001","version":1},"request_id":"c8c7e8d4-1f2a-4c8f-a230-4d4a2589a002"}
```

Listas: `GET ?limit=50&cursor=<opaco>`; `limit` entre 1 e 100; ordenação estável `(created_at,id)` ou `(occurred_at,id)` explicitada pelo recurso. Resposta `{data:[],page:{next_cursor:null,has_more:false},request_id}`. Cursor vincula filtros/ordenação/escopo; cursor inválido retorna `400`. Percorrer páginas não promete snapshot isolado; conciliação usa janela fechada, sobreposição e dedup.

| HTTP | Significado no OS |
| --- | --- |
| `200` | Consulta ou alteração local concluída; replay de comando existente usa o status e envelope originalmente persistidos. |
| `201` | Recurso local criado e commit confirmado; `Location` aponta para ele. Solicitação de estorno/saque criada ainda não movimenta dinheiro. |
| `202` | Intenção, auditoria e job gravados atomicamente; `Location: /api/v1/operations/{id}`. Não confirma recebimento, estorno, transferência, nota ou mensagem entregue. |
| `400/401/403/404` | Sintaxe/cursor inválidos; sessão inválida; ação proibida; recurso inexistente/inacessível. |
| `409` | Versão/estado concorrente, reserva disputada, key com payload diferente, aprovação inválida ou operação anterior incerta. |
| `422` | Comando bem formado viola schema/regra: valor, alocação, meio não homologado ou dados insuficientes. |
| `429/503` | Limite ou dependência indisponível; não alegam falha definitiva de operação externa já preparada. |

Todos os POST/PATCH autenticados exigem `Idempotency-Key` UUID, exceto endpoints explicitamente externos. Escopo único: `(environment,organization_id,actor_id,command_name,key)`; chave aponta para hash canônico do comando validado, versão, alvo e resposta persistida. Mesma chave/hash retorna a resposta original, após revalidar acesso atual; não executa outra ação. Chave/hash diferente retorna `409 IDEMPOTENCY_CONFLICT`. Guardar vínculo enquanto existir o recurso/evidência; rotação de chave não remove trava de negócio.

Uma segunda key para a mesma alocação, solicitação, aprovação ou intenção em andamento encontra o recurso existente e retorna `409 OPERATION_IN_PROGRESS` com seu ID. Pagamentos legítimos distintos pertencem a alocações distintas; saques novos exigem solicitações distintas, aprovação própria e confirmação explícita. Hash igual sozinho não proíbe operações legítimas futuras.

A key pertence ao OS; não pressupõe suporte Asaas, unicidade de referência externa ou transação distribuída. Após envio autorizado, timeout/queda mantém `UNCERTAIN`; consultar/reconciliar a operação existente, nunca criar nova cobrança/refund/transferência para destravar. “Não encontrado” isolado não prova inexistência. [Orientação oficial de retries](https://docs.asaas.com/docs/retries-e-idempot%C3%AAncia).

```json
{"data":{"operation_id":"3a5c2dd0-9781-44e8-bb51-d060ce00a003","resource_id":"3a5c2dd0-9781-44e8-bb51-d060ce00a004","state":"PREPARED"},"request_id":"c8c7e8d4-1f2a-4c8f-a230-4d4a2589a002"}
```

`GET /operations/{id}` retorna `id,kind,resource_id,state,version,created_at,updated_at,result,error,next_action`. Estados: `PREPARED`, `DISPATCHING`, `PROVIDER_PENDING`, `SUCCEEDED`, `FAILED_FINAL`, `UNCERTAIN`, `NEEDS_REVIEW`. `result` só contém evidência confirmada e dados autorizados; erro assíncrono fica nessa consulta, não transforma retroativamente o `202` em falha HTTP. Não há rota genérica “retry financeiro”.

Erro único: `{code,message,details,request_id}`; `details` contém somente campos/contexto seguros, nunca stack, tokens ou payload bruto. Códigos estáveis: `VALIDATION_FAILED`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `MFA_RECENCY_REQUIRED`, `NOT_FOUND`, `VERSION_CONFLICT`, `CURSOR_STALE`, `RESERVATION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_IN_PROGRESS`, `OPERATION_UNCERTAIN`, `APPROVAL_REQUIRED`, `APPROVAL_INVALID`, `REAPPROVAL_REQUIRED`, `CAPABILITY_UNAVAILABLE`, `INSUFFICIENT_AVAILABLE_BALANCE`, `REFUND_LIMIT_EXCEEDED`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`. MFA insuficiente/antigo retorna `403 MFA_RECENCY_REQUIRED` e orienta nova verificação no SDK oficial.

## 3. Rotas e permissões mínimas

Perfis humanos: SELLER e OWNER, exatamente um por conta individual. Grants nunca ultrapassam o teto da [matriz](../spec.md). OWNER também está sujeito a MFA, aprovação, integridade e capacidade vigente. A automação n8n externa não é provisionada nem recebe perfil/grants humanos no Ninebike. Onde a implementação ainda usar siglas antigas, não mapear usuários automaticamente: substituir a política por estes dois perfis antes de liberar.

| Área | Método e rota sob `/api/v1` | Permissão/resultado |
| --- | --- | --- |
| Sessão | `GET /session` | Pessoa ativa; perfil, teto e escopo atuais, sem secrets. |
| CRM | `GET /contacts`, `GET /contacts/{id}`, `POST /contacts`, `PATCH /contacts/{id}` | SELLER na carteira atribuída/compartilhada; OWNER toda a loja. `crm.read/write/manage` conforme caso; mesmo contato entre vínculos. |
| Fornecedores | `GET /suppliers`, `POST /suppliers`, `POST /contacts/{id}/roles` | OWNER somente; grants específicos da rota, versões e transação; fornecedor não vira beneficiário. |
| CRM | `GET /opportunities`, `POST /opportunities`, `PATCH /opportunities/{id}`, `POST /opportunities/{id}/activities` | SELLER na carteira atribuída/compartilhada; OWNER toda a loja. `crm.read/write/manage` conforme caso; mesmo contato entre vínculos. |
| Pipeline | `POST /opportunities/{id}/moves`, `GET /pipeline-stages`, `GET /pipeline-stages/{id}/opportunities` | SELLER move cards autorizados; OWNER configura etapas. `crm.manage/read`; versão/ordem, sem efeito financeiro/fiscal. |
| Pipeline — colunas | `POST /pipeline-stages/reorder` | OWNER somente; grants específicos da rota, versões e transação; fornecedor não vira beneficiário. |
| Pipeline | `POST /pipeline-stages`, `PATCH /pipeline-stages/{id}`, `POST /pipeline-stages/{id}/archive` | OWNER somente, `pipeline.manage`; versões e movimentação explícita antes de arquivar etapa ocupada. |
| CRM | `POST /contacts/{id}/merge-requests`, `POST /contact-merge-requests/{id}/approve` | OWNER somente, `crm.merge`; snapshots/versões dos dois contatos, sem ampliar visibilidade silenciosamente. |
| Propostas | `GET /quotes`, `GET /quotes/{id}`, `POST /quotes`, `PATCH /quotes/{id}` | SELLER no escopo e política; OWNER toda a loja. Valores/versões derivados; entrega depende de cobertura/fiscal/risco no commit; solicitação comercial não executa refund. |
| Propostas | `POST /quotes/{id}/discount-requests` | SELLER no escopo e política; OWNER toda a loja. Valores/versões derivados; entrega depende de cobertura/fiscal/risco no commit; solicitação comercial não executa refund. |
| Registro de vendas / pedidos | `POST /orders`, `GET /orders`, `GET /orders/{id}` | Mesmos pedidos, sem cadastro paralelo. SELLER própria carteira/compartilhamento autorizado; OWNER toda a loja. Lista/detalhe comerciais não retornam custo, margem, tarifas, líquido, split ou bancos ao SELLER. |
| Pedidos | `POST /orders/{id}/cancellation-requests`, `POST /orders/{id}/returns` | SELLER no escopo e política; OWNER toda a loja. Valores/versões derivados; entrega depende de cobertura/fiscal/risco no commit; solicitação comercial não executa refund. |
| Entrega | `POST /orders/{id}/deliveries` | SELLER no escopo e política; OWNER toda a loja. Valores/versões derivados; entrega depende de cobertura/fiscal/risco no commit; solicitação comercial não executa refund. |
| Catálogo | `GET /catalog/products`, `GET /catalog/products/{id}`, `POST /catalog/products`, `PATCH /catalog/products/{id}`, `POST /catalog/products/{id}/archive` | SELLER lê projeção comercial sem custo; OWNER gerencia com `catalog.manage` e `inventory.manage` para abertura; sem PATCH livre de saldo. |
| Estoque | `GET /inventory/units`, `GET /inventory/balances`, `POST /inventory/receipts`, `POST /inventory/adjustments`, `POST /inventory/recounts` | SELLER lê disponibilidade comercial, sem custo; OWNER escreve entradas/recontagem/ajuste com `inventory.manage`; reserva usa fluxo próprio. |
| Estoque | `PATCH /inventory/units/{id}/identification` | SELLER lê disponibilidade comercial, sem custo; OWNER escreve entradas/recontagem/ajuste com `inventory.manage`; reserva usa fluxo próprio. |
| Reserva | `POST /reservations`, `GET /reservations/{id}`, `POST /reservations/{id}/release` | SELLER no escopo e política; OWNER toda a loja. Valores/versões derivados; entrega depende de cobertura/fiscal/risco no commit; solicitação comercial não executa refund. |
| Pagamento | `GET /payment-methods?order_id={id}` | SELLER cria/consulta cobrança de pedido autorizado, valor derivado; recebe meios/parcelas comerciais, QR/link e estado sem tarifa/split/líquido/conta bancária. OWNER acessa detalhes restritos; sem baixa manual de venda. |
| Pagamento | `POST /payments`, `GET /payments/{id}` | SELLER cria/consulta cobrança de pedido autorizado, valor derivado; recebe meios/parcelas comerciais, QR/link e estado sem tarifa/split/líquido/conta bancária. OWNER acessa detalhes restritos; sem baixa manual de venda. |
| Recebível | `GET /payment-receivables/{id}` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Pagamento | `POST /payments/{id}/cancellation-requests` | OWNER somente, `payments.cancel`; alvo/correlação/versão revalidados; 202 não comprova cancelamento remoto. SELLER solicita cancelamento comercial no pedido. |
| Estorno | `GET /returns/{id}/refund-plan` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Estorno | `POST /refunds`, `GET /refunds/{id}` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Estorno | `POST /refunds/{id}/execute` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Saque | `POST /transfers/quotes` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Saque | `POST /transfers`, `GET /transfers/{id}`, `GET /transfers` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Saque | `POST /transfers/{id}/execute` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Aprovação | `GET /approval-requests`, `GET /approval-requests/{id}`, `POST /approvals` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Operações | `GET /operations/{id}` | Ator autorizado consulta o recurso de origem; projeção comercial SELLER exclui payload/valores financeiros, secrets e dados de outras carteiras. |
| Conciliação | `POST /reconciliation-runs`, `GET /reconciliation-runs/{id}` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Conciliação | `GET /reconciliation-issues`, `POST /reconciliation-issues/{id}/resolutions` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Financeiro | `GET /finance/balances`, `GET /finance/statements`, `GET /finance/commissions`, `GET /finance/reports`, `GET /finance/receivables` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Gestão | `GET /finance/accounts`, `GET /finance/categories`, `POST /finance/accounts`, `PATCH /finance/accounts/{id}`, `POST /finance/categories`, `PATCH /finance/categories/{id}` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Gastos/obrigações | `POST /payables`, `PATCH /payables/{id}`, `GET /payables`, `GET /payables/{id}`, `POST /payables/{id}/recognition-requests`, `POST /payables/{id}/adjustment-requests`, `POST /payables/{id}/recognitions`, `POST /payables/{id}/adjustments` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Caixa externo | `POST /finance/external-cash-entries`, `GET /finance/external-cash-entries/{id}`, `POST /finance/external-cash-entries/{id}/post` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Baixas | `POST /payables/{id}/settlement-requests`, `POST /payables/{id}/external-settlements`, `GET /payables/{id}/settlements`, `POST /payable-settlements/{id}/reversal-requests`, `POST /payable-settlements/{id}/reversals` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Equipe | `GET /staff-members`, `POST /staff-members`, `PATCH /staff-members/{id}` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Regra da equipe | `GET /staff-commission-rules`, `POST /staff-commission-rules`, `PATCH /staff-commission-rules/{id}`, `POST /staff-commission-rules/{id}/approval-requests`, `POST /staff-commission-rules/{id}/activate` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Comissão da equipe | `GET /staff-commissions`, `GET /staff-commissions/{id}`, `GET /staff-members/{id}/commission-statement`, `POST /staff-commissions/{id}/adjustment-requests`, `POST /staff-commissions/{id}/adjustments` | OWNER administra/ajusta; SELLER apenas GET SELF explícito, sem custo/regra alheia/ajuste/quitação. Previsto/reconhecido/liberado/pago separados. |
| Fechamento | `GET /finance/period-closures`, `POST /finance/period-closures`, `GET /finance/period-closures/{id}`, `POST /finance/period-closures/{id}/publish` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Fiscal — rascunho | `POST /fiscal-documents`, `PATCH /fiscal-documents/{id}/draft`, `GET /fiscal-documents`, `GET /fiscal-documents/{id}`, `POST /fiscal-documents/{id}/validations` | SELLER prepara/valida rascunho da própria venda e lê projeção permitida; OWNER revisa/administra. Sem transmissão/financeiro/estoque automático. |
| Fiscal — revisão | `POST /fiscal-actions/{id}/validations`, `GET /fiscal-actions/{id}/review`, `POST /fiscal-actions/{id}/approval-requests` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Fiscal — envio | `POST /fiscal-actions/{id}/submit` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Fiscal — eventos | `POST /fiscal-documents/{id}/cancellation-requests`, `POST /fiscal-documents/{id}/correction-requests`, `POST /fiscal-number-void-requests` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Fiscal — pré-análise | `POST /fiscal-import-previews`, `GET /fiscal-import-previews/{id}` | OWNER com `fiscal.import`; arquivos privados e somente leitura/validação/consulta em quarentena. Sem cadastros, lançamentos, numeração, emissão ou aprovação automática. |
| Fiscal — evidência | `POST /fiscal-evidence-imports`, `POST /fiscal-documents/{id}/reconciliation-requests`, `GET /fiscal-documents/{id}/artifacts/{artifact_id}/access` | OWNER importa/reconcilia; SELLER somente GET do documento autorizado permitido da própria venda. XML/PDF privados, evidência oficial distinta de status local. |
| Configuração fiscal | `GET /admin/fiscal-configurations`, `POST /admin/fiscal-configuration-requests`, `POST /admin/fiscal-configurations/{id}/activate` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Arquivos | `POST /attachments`, `POST /attachments/{id}/complete`, `GET /attachments/{id}/access` | Dono do recurso e escopo autorizados; URL privada curta. SELLER só mídia comercial/rascunho/documento autorizado permitido da própria venda, arquivos da própria campanha e evidência promocional da fonte autorizada, sempre pelo escopo do recurso pai; sem anexos financeiros ou exportações globais. |
| Administração | `GET /admin/users`, `POST /admin/invitations`, `PATCH /admin/users/{id}/access` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Administração | `GET /admin/policies`, `POST /admin/policy-versions`, `POST /admin/beneficiary-change-requests` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Administração | `GET /admin/capabilities`, `POST /admin/capability-evidence`, `GET /admin/audit-events` | OWNER somente, com grants específicos do caso e MFA/aprovação/capacidade quando exigidos; preservar versões, estados e invariantes definidos abaixo. |
| Exportação | `POST /exports`, `GET /exports/{id}` | OWNER por dataset/escopo; SELLER somente extrato próprio de comissão quando habilitado. Sem exportação geral/financeira da loja ou vazamento de carteira. |

Fora dessa base: `POST /public/v1/lead-submissions` usa `submission_id` UUID estável e os campos de contato abaixo: somente nome/celular obrigatórios para a pessoa; finalidade/origem vêm do formulário/configuração do servidor e UTM opcional validada. Antispam/rate limit não acrescentam campo comercial obrigatório. Retorna `201` sem PII; repetição idêntica retorna o resultado original; divergência da mesma ID retorna `409`. Não aceita papéis, saldo, desconto, IDs operacionais ou segredo no JavaScript.

## 4. Schemas dos comandos críticos

### Acesso humano e integrações

`POST /admin/invitations` recebe `{email,profile:SELLER|OWNER}`; `PATCH /admin/users/{id}/access` recebe `{expected_version,active?,profile?:SELLER|OWNER,grants?:[{permission,scope,expires_at?}]}`. Somente OWNER autenticado com MFA recente; papel/grant nunca vem de signup público. Catálogo de grants é fechado e limitado pelo teto do perfil. Atualização trava o conjunto de donos quando pertinente, protege último OWNER ativo e invalida comandos pendentes incompatíveis; não promover automaticamente um usuário legado por seu papel antigo. Só o fluxo administrativo valida profile e grants; `/session`, JWT fornecido pelo cliente ou mudança do próprio cadastro não concedem acesso.

Não provisionar identidade/credencial n8n nesta versão. Workers/jobs de integração aplicam somente seus casos de uso restritos; a automação externa não recebe sessão humana nem rotas financeiras/fiscais.

### Importação administrativa privada

Rotas `POST /data-imports`, `GET /data-imports/{id}`, `GET /data-imports/{id}/rows`, `POST /data-imports/{id}/validate`, `POST /data-imports/{id}/rows/{row_number}/resolve` e `POST /data-imports/{id}/apply` exigem `migration.manage`, inicialmente somente proprietário. Paginação/Storage seguem o mesmo escopo; conhecer file_id não concede acesso. Todas as mutações usam Idempotency-Key; execução longa retorna 202 com operation_id e consulta de progresso. O job só processa dados locais da solicitação humana, sem efeito financeiro/fiscal remoto.

```text
ImportBatchCreate = {file_id: UUID, dataset_kind: CONTACTS|PRODUCTS|PRODUCT_ATTRIBUTES,
                     mapping_revision: PositiveInt, source_cutoff?: Timestamp|null}
ValidateImport = {expected_version: PositiveInt, reference_file_id?: UUID}
ResolveImportRow = {expected_version: PositiveInt, decision: CORRECT|SKIP|LINK_EXISTING,
                    reason: string, corrections?: [{column: ImportColumnEnum, value: string|null}],
                    target_contact_id?: UUID, target_product_id?: UUID,
                    expected_target_version?: PositiveInt}
ApplyImport = {expected_version: PositiveInt, preview_hash: string}
```

ImportColumnEnum é lista fechada por layout/mapping aceito, excluindo IDs/chaves de identidade imutáveis. CORRECT exige somente corrections permitidas; SKIP não recebe alvo/correção; LINK_EXISTING exige exatamente um alvo tipado e sua versão, sem corrections. Toda resolução revalida conteúdo e preserva original/motivo; não faz merge implícito nem escreve tabela diretamente. Caso o alvo já tenha sido alterado, responder conflito. Linha APPLIED não é reescrita por resolve; revisão posterior usa nova intenção com o domínio dono e sua versão.

Criação deriva source_system/source_scope do binding de migração e verifica arquivo privado/hash/tamanho/tipo/cabeçalho. Validate produz hash da prévia com arquivo, mapping, decisões e versões; apply aceita somente essa prévia atual. Mudança a invalida. Resposta de lote inclui state, contagens por situação, confirmed_through_row, issues e origem; COMPLETED refere-se apenas ao escopo do lote. Dado obrigatório ausente para atendimento/fiscal ou estoque desconhecido permanece explícito; importar cadastros não resolve abertura financeira. Arquivo/mapping reaplicado retorna mesmo lote; alterações de origem/target não são sobrescritas automaticamente. Dados reais não aparecem em logs ou exemplos públicos.

Para estas fontes transformadas por IA, Validate compara reference_file_id privado da exportação/snapshot original aceito por mapping versionado e retorna source_verification_state, comparison_hash e diferenças por identidade/campo. Sem referência/evidência suficiente, mantém UNVERIFIED e não habilita ApplyImport na base operacional; validação estrutural continua disponível. Prévia inclui hashes de referência/comparação/transformações. VERIFIED é derivado da comparação resolvida e revisada pelo responsável, nunca valor de payload nem inferência de “arquivo abre normalmente”.

Notação: `UUID`, `MoneyCents`, `Date`, `Instant`, `PositiveInt`, `NonNegativeInt`, `NonZeroInt`; `?` opcional; objetos fechados. Campos abaixo são do OS, não payloads de terceiros. Todo comando autenticado mutável traz key no header, e sessão fora do body.

### Cadastro, pipeline e catálogo

```text
ContactCreate = {name: string, mobile_phone: string,
                 cpf?: string|null, email?: string|null, notes?: string|null,
                 birthday?: Birthday|null, person_type?: PF|PJ}
ContactPatch = {expected_version: PositiveInt, name?: string, mobile_phone?: string,
                cpf?: string|null, email?: string|null, notes?: string|null, birthday?: Birthday|null,
                person_type?: PF|PJ, trade_name?: string|null, cnpj?: string|null,
                phone?: string|null, address?: Address|null}
LeadSubmission = ContactCreate & {submission_id: UUID, utm?: ValidatedUtm}
SupplierCreate = {name: string, person_type: PF|PJ, trade_name?: string|null,
                  mobile_phone?: string|null, phone?: string|null,
                  cpf?: string|null, cnpj?: string|null, email?: string|null,
                  address?: Address|null, notes?: string|null}
Address = {postal_code?: string|null, street?: string|null, number?: string|null,
           complement?: string|null, district?: string|null, city?: string|null, state?: string|null}
AddContactRole = {expected_version: PositiveInt, role: CUSTOMER|SUPPLIER,
                  mobile_phone?: string, person_type?: PF|PJ, owner_id?: UUID}
OpportunityCreate = {contact_id: UUID, title?: string, stage_id?: UUID,
                     interest_product_id?: UUID|null, expected_value_cents?: MoneyCents|null,
                     expected_purchase_date?: Date|null, tags?: string[]}
OpportunityPatch = {expected_version: PositiveInt, title?: string,
                    interest_product_id?: UUID|null, expected_value_cents?: MoneyCents|null,
                    expected_purchase_date?: Date|null, tags?: string[], next_contact_at?: Timestamp|null}
MoveOpportunity = {expected_version: PositiveInt, stage_id: UUID,
                   expected_stage_version: PositiveInt,
                   expected_source_cards_version: NonNegativeInt,
                   expected_target_cards_version: NonNegativeInt,
                   before_opportunity_id?: UUID, after_opportunity_id?: UUID,
                   loss_reason?: string|null}
ReorderStages = {stages: [{id: UUID, expected_version: PositiveInt}]}
StageCreate = {name: string, position: NonNegativeInt, kind: OPEN|WON|LOST}
StagePatch = {expected_version: PositiveInt, name?: string}
QuoteCreate = {contact_id: UUID, opportunity_id?: UUID|null,
               items: [{product_id: UUID, unit_id?: UUID|null, quantity: PositiveInt,
                        discount_cents?: MoneyCents}], freight_cents?: MoneyCents}
QuoteRevision = QuoteCreate & {expected_version: PositiveInt}
ProductCreate = {
  name: string, initial_quantity: NonNegativeInt, type?: BIKE|ACCESSORY,
  sku?: string|null, sale_price_cents?: MoneyCents|null,
  acquisition_cost_cents?: MoneyCents|null, initial_units?: [{serial_number?: string|null}],
  brand?: string|null, category?: string|null, size?: string|null, color?: string|null,
  measurement_unit?: string|null, warranty_note?: string|null,
  supplier_contact_id?: UUID|null, minimum_stock?: NonNegativeInt|null, location?: string|null
}
ProductPatch = {expected_version: PositiveInt, name?: string, photo_attachment_id?: UUID|null,
                sku?: string|null, sale_price_cents?: MoneyCents|null,
                reference_cost_cents?: MoneyCents|null,
                type?: BIKE|ACCESSORY, complete_import?: true,
                brand?: string|null, category?: string|null, size?: string|null, color?: string|null,
                measurement_unit?: string|null, warranty_note?: string|null,
                supplier_contact_id?: UUID|null, minimum_stock?: NonNegativeInt|null, location?: string|null}
ArchiveProduct = {expected_version: PositiveInt, reason: string}
StockReceipt = {product_id: UUID, expected_inventory_version: PositiveInt,
                quantity: PositiveInt, reason: string, units?: [{serial_number?: string|null}],
                unit_acquisition_cost_cents?: MoneyCents|null, supplier_contact_id?: UUID|null,
                purchase_document_reference?: string|null, payable_id?: UUID|null,
                evidence_attachment_id?: UUID|null}
StockAdjustment = {product_id: UUID, expected_inventory_version: PositiveInt,
                   quantity_delta: NonZeroInt, unit_ids?: [UUID], reason: string}
StockRecount = {product_id: UUID, expected_inventory_version: PositiveInt,
                counted_quantity: NonNegativeInt, observed_unit_ids?: [UUID], reason: string,
                confirm_initial_opening?: true, unit_acquisition_cost_cents?: MoneyCents|null,
                initial_units?: [{serial_number?: string|null, acquisition_cost_cents?: MoneyCents|null}]}
```

Nome não pode ser vazio após trim; preservar acentos e nome completo. Para ContactCreate/LeadSubmission e papel CUSTOMER, celular é obrigatório, normalizado com DDI/DDD e validado; não prova identidade/titularidade. CPF/e-mail/observação omitidos na criação, `null`, vazios ou só espaços resultam em `null`; validar CPF/e-mail somente quando preenchidos. Observação é texto simples. No PATCH, campo omitido preserva valor; `null`/branco limpa apenas opcionais, nunca nome/celular de cliente. Não mesclar automaticamente por celular/CPF/e-mail nem proibir telefone compartilhado; duplicata de submissão e duplicata de pessoa são decisões diferentes.

SupplierCreate exige somente nome/tipo PF/PJ; celular/documento/endereço são opcionais até uso específico. Validar documento informado e consistência PF/PJ; Address é objeto fechado de campos postais opcionais normalizados, sem exigir endereço para prospectar. POST /suppliers cria contact com SUPPLIER; GET /suppliers é projeção/filtro dos mesmos contatos. Para pessoa já existente, AddContactRole usa o ID existente e revalida campos do novo papel no commit. Dados de fornecedor/custos não aparecem na resposta comercial sem grant; editar campos exclusivos de fornecedor exige suppliers.write mesmo com crm.write. Nenhuma dessas rotas aceita beneficiário/chave Pix/conta de saque.

Mapeamentos internos: `mobile_phone` normalizado persiste em `contacts.mobile_e164`; `notes` em `contacts.note`; `type=BIKE/ACCESSORY` deriva `products.tracking=UNIT/QUANTITY`. Esses nomes da persistência não alteram o contrato HTTP. Mover para etapa `LOST` exige motivo de perda conforme a regra comercial; reabrir/mover nunca altera finanças.

Modelo é `BIKE` por padrão; SKU e IDs internos são gerados se ausentes. `initial_quantity` cria entrada auditada com produto, unidades/saldo e autor em uma transação; quantidade positiva exige também `inventory.manage`, impedindo contornar permissão de estoque pelo catálogo. Quantidade zero não cria estoque fictício. Bikes recebem uma unidade UUID/código interno por peça sem exigir série/chassi inicial. Lista de séries é opcional; se fornecida, deve corresponder à quantidade de unidades e validar duplicatas preenchidas. Acessórios usam quantidade. Preço ausente impede proposta vendável; custo ausente retorna `null` e margem indisponível, sem convertê-lo em zero. Ler/editar custo exige grant específico, sem conceder saldo ou saques. Pedidos existentes preservam snapshots de preço/custo.

`ProductCreate.acquisition_cost_cents` é custo unitário da entrada inicial, não valor total nem despesa automática. ProductPatch usa `reference_cost_cents` apenas para referência atual; não altera custo histórico de unidades/entradas/vendas. Marca/categoria/tamanho/cor/unidade/garantia/estoque mínimo/localização são opcionais. Fornecedor deve ser contact com SUPPLIER ativo; associação não executa compra/pagamento. StockReceipt congela custo por entrada e documento/evidência; vincular payable evita duplicar a mesma aquisição como gasto. Para acessórios, método de consumo de custo ainda precisa de aceite (FIFO é uma opção proposta); sem método/custo completos, CMV e resultado final permanecem parciais.

Quantidade/disponibilidade não são campos de `ProductPatch`; entradas, ajustes, perdas e recontagens usam movimentos imutáveis. Recontagem registra quantidade observada/diferença compensatória e auditoria no mesmo commit. Reserva/compromisso incompatível ou unidade afetada não identificada abre divergência e bloqueia nova promessa de estoque; não apaga histórico ou escolhe outra bike silenciosamente. Consulta devolve `physical_on_hand,available,reserved,committed,inspection_maintenance` separados. Arquivar preserva histórico e impede novas propostas/reservas do modelo; não cancela pedidos existentes.

Formulário pode receber nome/foto/quantidade juntos: primeiro cria modelo com imagem padrão; `POST /attachments` registra upload `PENDING` vinculado ao `product_id` e emite URL limitada; `/complete` verifica objeto/bytes/tipo/tamanho/hash e decodificação antes de `READY`; `ProductPatch` associa somente foto `READY` pertencente ao produto. Falha/retry da foto não recria produto/entrada. Não aceita HTML/SVG ativo ou URL externa arbitrária como imagem. `photo_attachment_id=null` remove associação e usa imagem padrão. Leitura gera URL curta autorizada no escopo do produto; bucket privado. Substituição preserva auditoria/anexos históricos necessários; conhecer UUID nunca autoriza acesso.

### Reserva e dinheiro

ProductCreate interativo exige quantidade inicial explicitamente informada e deriva migration_pending=false e inventory_opening_state=CONFIRMED, inclusive em zero conferido, sem criar movimento de quantidade zero. Importação sem quantidade não usa esse default e permanece UNKNOWN.

**Legado até uso operacional:** nos comandos de contato, proprietário com `migration.manage` pode completar dados e AddContactRole atribui papel/responsável validado; owner_id é permitido para esse complemento inicial, sem contornar regras de atribuição de carteira. O servidor retira migration_pending somente após os mínimos operacionais do conjunto de papéis estarem satisfeitos. Não presumir consentimento e não exigir documento opcional para iniciar atendimento. `ProductPatch.type` só classifica importado sem movimento ou segue a restrição existente de alteração antes do primeiro movimento; `complete_import=true` exige migration.manage+catalog.manage e mapeamento/colisão de SKU/situação resolvidos. Servidor deriva tracking e migration_pending e aplica a situação aceita, sem PATCH livre de active/saldo. Concluir o catálogo não confirma estoque.

Para produto UNKNOWN, StockRecount com `confirm_initial_opening=true` registra a abertura explicitamente conferida com `inventory.manage`, corte/evidência/autor e transação próprios. counted_quantity aceita zero conferido; UNIT cria IDs internos para exatamente N bikes, usando initial_units quando fornecidas (comprimento igual a N), sem inventar chassis. QUANTITY grava quantidade inteira na unidade aceita. Esse percurso exige ausência de movimentos/reservas/abertura anteriores, registra abertura única, incrementa versão e deriva CONFIRMED; em zero, usa recibo/auditoria/estado sem criar movimento com quantity=0; repetição não duplica. Abertura inicial não recebe observed_unit_ids de uma recontagem. Recontagem comum não recebe confirm_initial_opening/initial_units e não recria unidades. StockReceipt/reserva/entrega não prometem quantidade enquanto UNKNOWN. O expected_inventory_version é a versão corrente do agregado inventory.products, retornada pela leitura de estoque, com comparação no commit. Consultas retornam migration_pending/inventory_opening_state e quantidades null com motivo para UNKNOWN; nenhum total converte desconhecido em zero. Custos informados na abertura viram snapshots das unidades/movimento e vinculam a valoração patrimonial de abertura já prevista, sem nova receita/despesa; custo individual informado prevalece sobre o valor do lote. Campos de custo de abertura não são permitidos em recontagem comum. Custos ausentes continuam null e resultado parcial.

Oportunidade nova deriva proprietário/origem e primeira etapa aberta da política quando omitidos; contato deve estar habilitado para atendimento. PATCH não move etapa, posição ou carteira por efeito implícito. Proposta com oportunidade exige o mesmo contato e escopo; preços/descrição/custos/política são obtidos e congelados no servidor. Desconto solicitado não contorna alçada. PATCH da proposta é uma nova revisão imutável conforme QuoteRevision; após aceita, não sobrescreve a revisão anterior. `Timestamp` é ISO8601 UTC com Z, conforme a convenção geral. Itens vazios, repetição indevida de unidade ou produto arquivado para nova venda são rejeitados.

Mover card dentro ou entre etapas usa o mesmo MoveOpportunity. `before_opportunity_id` e `after_opportunity_id` são mutuamente exclusivos; ambos omitidos significam fim global da etapa, não fim da página carregada. A âncora deve ser outro card acessível da etapa destino. Na mesma etapa, as duas cards_version devem ser iguais; servidor trava etapas/registro, valida suas versões e o motivo de perda quando necessário, reordena e retorna card/versão, etapas/cards_version e referência ao recibo de idempotência. Repetição com a mesma key/payload retorna o recibo original. Timeout recupera o recibo repetindo a mesma key/payload, sem reexecutar o efeito, e reconsulta estado antes de nova intenção; 409 não sobrescreve alteração concorrente.

`GET /pipeline-stages/{id}/opportunities` ordena por `(position,id)`; cursor opaco inclui etapa, filtro/escopo e cards_version. Retorna `items,next_cursor,has_more,visible_count,cards_version`. Mudança de ordem invalida cursor com `409 CURSOR_STALE`; refazer a leitura mantém filtros. Quantidades e eventuais somas são agregadas no servidor sobre registros autorizados, não sobre a página. ReorderStages recebe exatamente todas as etapas ativas na ordem desejada; alteração do conjunto/versões resulta em conflito. Criar/arquivar/reordenar usam o mesmo lock do pipeline. PATCH não aceita position isolada; histórico e posições únicas permanecem consistentes. Essas rotas são exceção explícita à ordenação geral por data da API.

```text
ReserveStock = {
  quote_id: UUID, expected_quote_version: PositiveInt,
  items: [{quote_item_id: UUID, unit_id: UUID} |
          {quote_item_id: UUID, product_id: UUID, quantity: PositiveInt}]
}
CreateOrder = {
  quote_id: UUID, expected_quote_version: PositiveInt,
  reservation_id: UUID, expected_reservation_version: PositiveInt,
  allocations: [{amount_cents: MoneyCents, mode: PIX|BOLETO|CARD|KOIN_APP_PIX,
                 due_date: Date, installment_count?: PositiveInt}]
}
CreatePayment = {allocation_id: UUID, expected_version: PositiveInt}
RequestRefund = {
  receivable_id: UUID, expected_receivable_version: PositiveInt,
  return_id?: UUID, amount_cents: MoneyCents, reason: string
}
QuoteTransfer = {
  beneficiary_id: UUID, expected_beneficiary_version: PositiveInt,
  amount_cents: MoneyCents, rail: PIX|BANK_TRANSFER
}
RequestTransfer = {fee_quote_id: UUID, reason: string}
DecideApproval = {
  approval_request_id: UUID, expected_version: PositiveInt,
  payload_hash: string, decision: APPROVE|REJECT, reason?: string
}
ExecuteFinancialRequest = {
  expected_version: PositiveInt, approval_id: UUID
}
ConfirmDelivery = {
  expected_order_version: PositiveInt, unit_ids: [UUID], evidence_attachment_id: UUID
}
```

Reserva retorna `id,quote_id,version,state,items,expires_at`; id/version identificam `inventory.reservation_groups`, enquanto items contém as linhas `stock_reservations` identificadas. `CreateOrder.reservation_id/expected_reservation_version` referem-se a esse grupo e sua versão; nunca ao UUID de uma linha arbitrária. Prazo é derivado da política, nunca livre no browser. Trava grupo/unidades/saldos, expira reservas elegíveis e grava cabeçalho/linhas/projeções em uma transação. Duas reservas da mesma bike não podem confirmar; acessórios não ficam negativos. Liberar/expirar reserva de pedido já comprometido é conflito. Expiração posterior ao pagamento abre exceção, não captura outra bike.

Cada quote_item_id pertence à revisão quote_id; unidade/produto correspondem à linha, e somas por item cobrem exatamente as quantidades a reservar, sem duplicar unidade nem escolher a primeira linha com o mesmo produto. A confirmação deriva order_item_id dessa origem. Um único grupo ativo por quote_id; mudança de quote_version por estado não permite criar outro grupo da mesma revisão.

Pedido deriva preços, descontos aprovados, frete, custos históricos, total, regra/base/comissão e estoque da proposta/reserva. Número comercial, confirmed_at, created_by e atribuição/snapshot da vendedora são gerados pelo servidor; não fazem parte de CreateOrder. Soma das alocações deve ser exatamente o total contratado; valores não positivos ou condições recusadas pela política comercial local são rejeitados. Confirmar pedido registra obrigações/condições comerciais e não chama PSP. Sem integração habilitada, não criar tentativa, recebível oficial, cobertura ou split liquidado fictícios; criar cobrança continua bloqueado até homologação. `allocations[].mode` persiste como `approved_method`; `installment_count` como `requested_installment_count`. Para `CARD`, omissão normaliza para 1 e valor informado exige inteiro positivo aceito pela política comercial; o percurso homologado é exigido para CreatePayment, sem inventar taxa/antecipação no snapshot comercial. Demais meios devem omitir o campo, persistido como `null`. Servidor cria `payment_terms_snapshot` da revisão aprovada com meio, quantidade de parcelas, vencimento, principal e condições históricas; Koin App não registra parcelas do empréstimo.

`GET /orders` aceita filtros fechados `confirmed_from/confirmed_to` (instantes ISO UTC, início inclusivo/fim exclusivo a partir do período civil São Paulo), `contact_id`, `owner_id`, `product_id`, `commercial_state`, `coverage_state`, `delivery_state`, `fiscal_status` e busca `q` por referência interna/nome. IDs/enums/período/limite são validados; filtro não concede visibilidade. Paginação segue a convenção geral com ordenação estável `(confirmed_at DESC,id DESC)`, cursor ligado aos filtros/escopo e limite. Não implementar novos endpoints para o mesmo registro. Resposta inclui `queried_at`, lista sem duplicações e totais filtrados comerciais autorizados no servidor; tais totais não são receita, caixa ou lucro. Leitura concorrente pode mudar estados; atualização não promete snapshot congelado de toda a lista.

Lista retorna `id,display_number,version,confirmed_at,customer_summary,seller_summary,items_summary,total_cents,commercial_state,coverage_state,payment_review_required,delivery_summary,fiscal_summary`; `display_number` é string decimal no JSON para preservar BIGINT sem perda; UUID continua sendo a identidade das rotas. detalhe retorna snapshots, condições e vínculos/histórico permitidos. Campos de estado projetam as máquinas de cada domínio, sem novo estado de pagamento editável na venda. Fora de escopo retorna 404; filtro/exportação/contagem não revela existência nem montantes de vendas alheias. Cancelamento/devolução não remove registro. Repetir confirmação idempotente retorna o pedido original e sua referência, sem novas reservas, alocações ou efeitos fiscais.

Resumos/filtros não criam novas máquinas de estado: `coverage_state` usa exatamente NONE/PARTIAL/FULL_CONFIRMED/PARTIAL_REVERSAL/REVERSED/DISPUTED do domínio monetário. Sem fato confirmado, NONE, nunca FULL_CONFIRMED; `payment_review_required=true` sinaliza tentativa incerta/divergência/revisão de cobertura, sem ocultar a incerteza sob “não pago”. Cada cobrança e seu estado próprio permanecem no detalhe. PSP indisponível é capacidade indisponível, não saldo zero ou recebimento negado.

`delivery_summary={state:NOT_DELIVERED|DELIVERED,delivered_at:null|Instant,returned_quantity:NonNegativeInt}`: DELIVERED exige entrega integral persistida/movimentos correspondentes, não apenas aptidão; NOT_DELIVERED inclui ausência de entrega. returned_quantity soma somente quantidades efetivamente recebidas no retorno físico contra os itens entregues, sem somar solicitações/decisões financeiras. Entrega histórica não desaparece ao devolver; UI mostra também a quantidade devolvida. Filtro delivery_state usa esses dois valores.

`fiscal_summary={document_count:NonNegativeInt,official_counts:{NOT_SUBMITTED,PROCESSING,AUTHORIZED,REJECTED,CANCELLED,UNKNOWN,DENIED_LEGACY}}` contém contagens inteiras não negativas por documento vinculado, sem duplicar revisões/eventos/arquivos; soma das contagens fecha document_count. Sem documento, count=0 e contagens zero: UI “Sem documento”, sem inferir dispensa fiscal. Filtro fiscal_status aceita um estado oficial e corresponde a existência de pelo menos um documento nesse estado, ou NO_DOCUMENTS para count=0. Estados mistos permanecem contagens/múltiplos indicadores, sem “última nota vence”; autorização exige evidência oficial conforme fiscal. Não expor payload/tributos/chaves restritos ao SELLER por esses resumos.

Cobrança deriva alocação, conta Ninebike, cliente necessário, vencimento, meio, regra de tarifa, carteira allowlist e fatia fixa de comissão. `CreatePayment` congela na tentativa `approved_method_snapshot,requested_installment_count,payment_terms_snapshot` da versão aprovada; adaptador não escolhe novo meio/parcelamento. O cliente não envia `amount_cents`, percentual, `wallet_id`, split, PAN/CVV ou URL de callback. O job só publica `payment_url`/QR após importar todas as folhas, conferir quantidade contra parcelas solicitadas, somas de principal/comissão, conta, vínculo e splits gravados no provedor; antes disso a consulta mostra pendência.

Identidade HTTP: `payment_id` e `{id}` em `/payments/{id}` sempre identificam `finance.payment_attempts.id`, não grupo/Checkout nem uma cobrança folha. O `resource_id` do `202` de criação é essa tentativa. Consulta retorna `id,version,allocation_id,approved_method_snapshot,requested_installment_count,payment_terms_snapshot,state,operation_id,receivables[]`, com termos filtrados pela permissão. Cada elemento contém `receivable_id,version,provider_charge_ref,installment_number,principal_cents,coverage_cents,status`. `provider_charge_ref` identifica a cobrança externa exata por conta/ambiente/tipo/ID opaco, sem credencial; `GET /payment-receivables/{id}` retorna a mesma folha e seu `payment_id`. Durante emissão/importação incompleta, a lista pode estar vazia/incompleta e não autoriza link, entrega ou estorno por inferência.

Comissão de servidor: `C(B)=floor((B*15+500)/1000)`; fatia `C(S_i)-C(S_anterior)`, com ordem estável das alocações. Tarifa fixa de recebimento Pix é separada, pode ser zero ou positiva, e não reduz a base de 1,5% bruto. Tarifa percentual de recebimento Pix bloqueia habilitação. Taxas previstas/efetivas nunca são mescladas. Não transportar `totalFixedValue` de parcelamento para Checkout por analogia; capacidade deve provar split total/rateio exato no percurso usado.

Estorno retorna solicitação `id,version,state,amount_cents,receivable_id,payment_id,return_id,refundable_snapshot,approval_request_id`; `payment_id` é a tentativa derivada da folha, nunca um segundo alvo livre. Validar versão da folha, vínculo com pedido/devolução e cobrança externa exata. Reserva local de restituição mais valores já devolvidos/disputados não supera o elegível, com lock por folha/obrigação e revalidação no envio. Refund não repõe estoque nem cancela nota. Koin exige percurso homologado para destinatário, Pix e recomposição da dívida; sem isso `CAPABILITY_UNAVAILABLE`.

Na devolução total/parcial, UI usa `return_id` e apresenta um plano calculado pelo servidor com `lines[{receivable_id,expected_receivable_version,amount_cents}],total_refundable_cents,blocked_reasons`, derivado de `return_allocations` e folhas elegíveis. Funcionário confirma valores comerciais; não escolhe IDs técnicos. A devolução existente relaciona 1:N solicitações `RequestRefund`, cada uma com key/aprovação/resultado próprios; não criar entidade agregadora ou motor financeiro genérico. Plano é consulta, não reserva/sucesso: cada execução revalida elegibilidade e a tela acompanha todas as pendências/falhas, sem declarar devolução integral se apenas parte foi realizada.

Uma intenção de refund tem uma folha como alvo e só despacha por percurso que homologue estorno, consulta, identificação e reversões dessa cobrança exata. Suporte a estorno de grupo/parcelamento total não comprova estorno de folha/parcial; não chamar endpoint de grupo com ID de folha nem expandir silenciosamente para outras parcelas. Se a semântica externa não permitir esse mapeamento exato, bloquear o comando/capacidade com `CAPABILITY_UNAVAILABLE` até homologação; não fabricar associação econômica a partir do total.

Cotação de saque retorna `id,source_account_id,beneficiary_id,beneficiary_version,rail,amount_cents,fee_cents,total_debit_cents,observed_at,expires_at,fee_policy_version,evidence_id`. `total_debit_cents=amount_cents+fee_cents`. Conta PJ titular Ninebike e beneficiário validado vêm do cadastro; dados bancários/chave Pix livres são rejeitados. `FeeQuote` é snapshot local de consulta/tabela/contrato aplicável, não pressupõe endpoint Asaas de cotação nem congelamento remoto de tarifa. Sem base confiável/fresca do custo, não produzir cotação apta nem executar saída.

Solicitação de saque congela o snapshot local e retorna `id,version,state,approval_request_id,payload_hash`. Execução revalida tabela/condição de tarifa e saldo oficial fresco suficiente para débito total, descontadas reservas de saída concorrentes. Cotação vencida ou mudança detectada de tarifa/beneficiário/versão exige nova cotação/solicitação/aprovação (`409 REAPPROVAL_REQUIRED`), antes do despacho. Não existe atomicidade prometida entre tabela externa e saque: diferença descoberta só após execução gera divergência de tarifa/alerta e registro do débito efetivo, sem apagamento ou promessa de reversão. Reserva de saída persiste em pendência/incerteza; falha só a libera com evidência conclusiva.

`ApprovalRequest` contém snapshot canônico gerado no servidor: `kind,target_id,target_version,requester_id,source_account_id,amount_cents,currency,beneficiary_id,beneficiary_version,fee_quote_id,fee_cents,total_debit_cents,quote_expires_at,reason,related_order_id,related_payment_attempt_id,related_receivable_id,related_receivable_version,commission_rule_version`, conforme aplicável; ausências são `null` explícito. Para refund, congela também referência da cobrança externa folha e evidência do elegível. `payload_hash=SHA-256` da representação canônica persistida. Browser confirma esse hash; servidor recalcula e não confia no texto recebido.

Aprovação grava aprovador/instante/método/validade/versão e `session_id,mfa_verified_at` derivados dos claims assinados; não guarda JWT bruto. Mutação de qualquer dado relevante invalida aprovação; execução revalida estado, vínculo ativo, permissão/MFA atuais do executor e consome a intenção atomicamente. O executor autorizado pode ser diferente do aprovador; a sessão registrada identifica a evidência de aprovação, sem exigir compartilhamento da sessão do proprietário com o financeiro. Solicitante e aprovador distintos no modo duplo; modo proprietário único só se explicitamente configurado e auditado, com MFA recente. Uma aprovação financeira autoriza uma intenção e um único ID externo, nunca vários saques com os mesmos dados.

Entrega revalida cobertura integral, unidade física, série/chassi quando aplicável ao produto/fiscal, risco e exigência fiscal no mesmo commit; screenshot/sucesso de Checkout não autorizam. Status comercial, cobertura, cobrança, split, disponibilidade, conciliação, entrega e fiscal retornam separadamente, sem um booleano genérico `paid`.

### Gastos, caixa externo, equipe e fechamento

```text
PayableCreate = {
  origin_kind: SUPPLIER_EXPENSE|INVENTORY_PURCHASE|TAX|OPENING,
  supplier_contact_id?: UUID|null, counterparty_name: string, category_id: UUID,
  amount_cents: MoneyCents, competence_date: Date, due_date: Date,
  document_reference?: string|null, evidence_attachment_id?: UUID|null, notes?: string|null,
  receipt_movement_ids?: [UUID]
}
PayablePatch = {expected_version: PositiveInt,
               counterparty_name?: string, supplier_contact_id?: UUID|null, category_id?: UUID,
               amount_cents?: MoneyCents, competence_date?: Date, due_date?: Date,
               document_reference?: string|null, evidence_attachment_id?: UUID|null, notes?: string|null}
RecognizePayableRequest = {expected_version: PositiveInt}
AdjustPayableRequest = {expected_version: PositiveInt, direction: INCREASE|DECREASE,
                 amount_cents: MoneyCents, competence_date: Date, reason: string,
                 evidence_attachment_id: UUID}
ExecuteLocalFinancialRequest = {expected_version: PositiveInt, approval_id: UUID}
ExternalCashEntryCreate = {
  management_account_id: UUID, expected_account_version: PositiveInt,
  kind: OBLIGATION_PAYMENT|PAYMENT_RETURN|OWN_TRANSFER_CREDIT|CONTRIBUTION|DISTRIBUTION|OPENING_BALANCE,
  direction: INFLOW|OUTFLOW, amount_cents: MoneyCents, occurred_at: Instant,
  external_reference: string, evidence_attachment_id: UUID, reason: string,
  related_transfer_id?: UUID|null, original_cash_entry_id?: UUID|null
}
PostExternalCashEntry = {expected_version: PositiveInt, approval_id: UUID}
ExternalPayableSettlementRequest = {
  expected_version: PositiveInt, cash_entry_id: UUID, amount_cents: MoneyCents,
  settled_at: Instant
}
ReverseSettlementRequest = {expected_version: PositiveInt, reason: string,
                            evidence_attachment_id: UUID}
StaffMemberCreate = {name: string, profile_id?: UUID|null}
StaffMemberPatch = {expected_version: PositiveInt, name?: string, active?: boolean,
                   ended_on?: Date|null}
StaffRuleDraft = {
  effective_from: Date, effective_until?: Date|null,
  calculation_kind?: PERCENTAGE|FIXED_PER_ORDER,
  rate_bps?: NonNegativeInt|null, fixed_amount_cents?: MoneyCents|null,
  base_policy_code?: PolicyCode|null, rounding_policy_code?: PolicyCode|null,
  attribution_policy_code?: PolicyCode|null, recognition_policy_code?: PolicyCode|null,
  release_policy_code?: PolicyCode|null, due_policy?: DuePolicy|null,
  reversal_policy_code?: PolicyCode|null
}
StaffRulePatch = StaffRuleDraft fields optional & {expected_version: PositiveInt}
ApproveStaffRuleRequest = {expected_version: PositiveInt}
ActivateStaffRule = {expected_version: PositiveInt, approval_id: UUID}
StaffAdjustmentRequest = {expected_version: PositiveInt, direction: CREDIT|DEBIT,
                          amount_cents: MoneyCents, competence_date: Date,
                          reason: string, evidence_attachment_id: UUID}
PeriodClosureCreate = {month: YYYY-MM, expected_current_revision: NonNegativeInt}
PublishPeriodClosure = {expected_version: PositiveInt, approval_id: UUID}
```

Todos são objetos fechados, com limites de texto/valores. `PolicyCode` vem de catálogo de comportamentos suportados e aprovados, não executa expressão/script fornecido pelo usuário. `DuePolicy` será objeto fechado do vencimento escolhido pela Ninebike; até essa definição a regra fica DRAFT e não é ativável. Base/taxa/gatilhos/reversão staff permanecem pendentes; o contrato não escolhe um comportamento para preencher lacunas. Percentual e valor fixo são mutuamente exclusivos; convenção de arredondamento e unidade ficam explícitas no snapshot aceito. Alteração de draft usa versão; accepted não aceita PATCH. Vigências sobrepostas no mesmo escopo são rejeitadas.

PayableCreate retorna DRAFT com versão; cadastro não reconhece despesa nem movimento. Reconhecimento aprovado deriva classificação, obrigação e lançamento na mesma RPC. Origem INVENTORY_PURCHASE registra ativo/custo da entrada vinculada, não segunda despesa; ausência de custo/item associado torna a aquisição pendente de conferência. OPENING exige data de corte/evidência e não entra como despesa do mês. Staff/software só são criados pelos respectivos fatos elegíveis; origem desses tipos enviada pelo browser é rejeitada. Após reconhecimento, PayablePatch só modifica campos administrativos permitidos que não afetem lançamento; alteração de valor/classificação/competência usa compensação aprovada e preserva original. Decréscimo abaixo do já quitado gera valor a resolver, sem apagar baixas ou presumir restituição.

Para INVENTORY_PURCHASE, PayableCreate pode associar receipt_movement_ids já existentes ou StockReceipt pode apontar payable DRAFT existente. Associação trava entradas/obrigação e conserva a acquisition_reference gerada no servidor, com documento/fornecedor e dedup de origem. RecognizePayable é o único dono da capitalização e obrigação; entrada física nunca debita ativo novamente. Exige custos/quantidades/documento consistentes e salva recognition_journal_id com efeito único. Sem documento/valorização aprovados, estoque inicial é abertura/pendência e não despesa presumida. Pagamento anterior à aquisição permanece fonte de pagamento a alocar, sem lucro/despesa fictícios.

ExternalCashEntry é comando restrito de movimento já realizado em banco externo/caixa próprio, com revisão/evidência. Seu `id` referencia journal de fonte com estado DRAFT/POSTED. Criação retorna approval_request_id; `/post` valida aprovação/versão/MFA recentes e registra caixa uma vez. Conta ASAAS_OFFICIAL, entrada de venda fora Asaas disfarçada, finalidade incompatível ou fonte sem identidade/evidência confiável são rejeitadas/revisadas. Saldo inicial/aporte/distribuição/transferência própria não entram como receita de venda ou despesa operacional. Crédito de OWN_TRANSFER_CREDIT exige transferência própria correlacionada; vincula o mesmo trânsito existente, sem duplicar entrada. Não há `ledger_account_id`, status de pagamento, livre classificação contábil ou saldo final no body.

PAYMENT_RETURN exige INFLOW, original_cash_entry_id de saída OBLIGATION_PAYMENT, conta de retorno própria, evidência e aprovação. Sob lock do original, retornos acumulados e valor a recuperar são revalidados; duplicata não cria novo crédito e excesso fica em revisão. Recompõe pagamento a alocar/valor a recuperar segundo origem aprovada, sem classificar como aporte/receita ou apagar quitação anterior. É distinto da reversão de alocação da baixa.

ExternalPayableSettlement liga obrigação ao movimento OBLIGATION_PAYMENT já postado, cuja conta/data/origem vêm do servidor. Valor é validado contra saldo reconhecido/liberado e saldo não alocado da fonte, sob locks da obrigação e fonte. Uma fonte pode liquidar várias obrigações, mas seu caixa só foi postado uma vez; a soma das baixas fecha o valor alocado. O saldo da fonte disponível para novas baixas deduz uma vez as alocações líquidas, PAYMENT_RETURN efetivos e reservas aplicáveis, sob o mesmo lock. Retorno real com alocação ainda ativa fica preservado e abre pendência de compensação/reclassificação; não apaga a quitação nem permite reutilizar dinheiro já devolvido. Aprovação vincula obrigação/favorecido, fonte, valor, versão e evidência. Repetição retorna a baixa existente; outra key não consome o mesmo saldo novamente. Documento administrativo não altera snapshot Asaas nem cobertura/split de venda. Reversão de baixa é compensação da alocação: devolução real do dinheiro exige evidência/fato próprio, não crédito de caixa automático.

Comissões da equipe são calculadas por fato elegível no servidor, sem endpoint “marcar liberada/paga” ou valor livre na venda. Funcionário atribuído é estável; ativar regra futura não recalcula vendas antigas. Pedido sem regra aceita mostra NOT_CONFIGURED. Reconhecimento cria payable único; liberação revalida regra e evidência; pagamento externo consome apenas saldo liberado da obrigação. Ajuste de staff exige aprovação vinculada ao original e mantém saldo a resolver se já pago, sem desconto salarial automático. Software continua nos recursos commission_rules/allocations/splits de 150 bps e nunca usa a regra staff.

Novos tipos de aprovação reutilizam `/approvals`: PAYABLE_RECOGNITION, PAYABLE_ADJUSTMENT, EXTERNAL_CASH_ENTRY, PAYABLE_SETTLEMENT, SETTLEMENT_REVERSAL, STAFF_RULE_ACTIVATION, STAFF_COMMISSION_ADJUSTMENT e PERIOD_CLOSURE. O snapshot congela versões, favorecido/funcionário, categoria/classificação, competência, fonte, valor, regra ou período/corte aplicáveis. Esses comandos locais não criam operação Asaas nem job de pagamento a terceiro. Permissão, MFA, aprovação e invariantes são revalidados no commit; alteração do alvo exige nova aprovação.

Lifecycle completo: as rotas `recognition-requests`, `adjustment-requests`, `settlement-requests`, `reversal-requests` e `approval-requests` recebem seus DTOs de preparo e criam a própria linha identity.approvals PENDING, com snapshot/hash gerados no servidor e command_receipt. Respondem `201` com `approval_request_id,version,payload_hash,target_id,target_version`; não postam efeitos. ExternalCashEntryCreate e PeriodClosureCreate geram essa mesma solicitação junto do rascunho/snapshot. GET /approval-requests permite revisar; POST /approvals registra decisão por DecideApproval, sem executar o efeito preparado.

Execução usa apenas ExecuteLocalFinancialRequest nas rotas `/recognitions`, `/adjustments`, `/external-settlements` e `/reversals`; staff usa `/staff-commissions/{id}/adjustments`, regra usa `/activate`, caixa `/post` e fechamento `/publish`. `approval_id` identifica a mesma linha aprovada, não outra tabela. Servidor recupera todos os parâmetros do snapshot; o body não repete valor/favorecido/categoria. Trava alvo/aprovação/fontes, revalida versão, hash, estado, permissão/MFA e saldo aplicáveis; efeito, projeção, auditoria, command_receipt e estado CONSUMED confirmam na mesma RPC. Erro faz rollback inclusive do consumo. Key repetida recupera resultado; nova key sobre mesma solicitação não repete efeito. Uma solicitação local pendente por tipo/alvo/versão impede duplicata acidental; após alteração/execução, outras aprovações da versão antiga são inválidas. Reversão e ajuste staff sempre têm essa execução explícita, sem destino indefinido após aprovação.

Consulta de payable retorna `id,version,origin_kind,original_amount_cents,recognized_amount_cents,adjustments_cents,settled_cents,outstanding_cents,release_state,due_date,competence_date,state,overdue,settlements[]`. `overdue` exige obrigação reconhecida, saldo aberto positivo e due_date conhecida anterior à data comercial; liberação é independente, data nula não presume atraso. É marcador, não outro valor somável. Campos signed permitem ajustes/saldo a resolver sem truncar para zero. Item da equipe retorna separado `estimated_cents,recognized_cents,released_cents,settled_cents,reversed_cents,recognition_state,release_state,payment_state,payable_id` e referências autorizadas; previsto não reconhecido fica fora do extrato devido.

`GET /finance/reports` recebe `view=RESULT|CASH|EXPENSES`, período e eixo de data `COMPETENCE|OCCURRED_AT|RECEIVED_AT` explicitamente suportado pela visão. Competência do resultado e data realizada do caixa não são trocadas implicitamente. Listas por funcionário/fornecedor/categoria/conta usam IDs internos, escopo servidor e paginação padrão. Extrato staff usa mês/funcionário e fórmula do modelo; filtro alheio é negado a SELF. Custos, salários/comissões alheias, regras e extratos não vazam em exports/canais de atualização.

Toda consulta financeira traz metadados de atualização/completude; exemplo sintético:

```json
{
  "data": {
    "view": "RESULT",
    "date_axis": "COMPETENCE",
    "period_start": "2026-10-01",
    "period_end": "2026-10-31",
    "revenue_cents": "800000",
    "cmv_cents": "600000",
    "known_direct_margin_cents": "187801",
    "result_cents": null,
    "result_margin_percent": null
  },
  "meta": {
    "as_of": "2026-10-17T15:00:00Z",
    "projection_version": 12,
    "projection_updated_at": "2026-10-17T14:59:58Z",
    "completeness": "PARTIAL",
    "missing_data": ["STAFF_RULE_NOT_CONFIGURED", "TAX_DATA_PENDING", "EXPENSE_SCOPE_UNCONFIRMED"],
    "source_cutoffs": [
      {"source": "ASAAS", "observed_at": "2026-10-17T14:59:30Z", "reconciled_through": "2026-10-17T14:55:00Z"},
      {"source": "EXTERNAL_BANK", "observed_at": null, "reconciled_through": null}
    ],
    "reconciliation_status": "PENDING"
  },
  "request_id": "c8c7e8d4-1f2a-4c8f-a230-4d4a2589a002"
}
```

R$ 1.878,01 no exemplo é subtotal conhecido após CMV/tarifa/software, não lucro final. Custos nulos não são excluídos silenciosamente da soma; tributos dependem de dados informados pelo responsável. `COMPLETE` exige fontes/itens necessários completos, critérios registrados e conferência de gastos declarada pelo responsável para o período/corte; não significa descobrir despesas nunca cadastradas. Conectividade não prova conciliação. Resposta preserva timestamps de fato/recebimento/processamento quando aplicáveis e mostra fonte externa administrativa sem fingir saldo bancário oficial em tempo real.

Consulta após commit/reabertura/reconexão sempre passa pelo Worker. Broadcast privado só publica invalidação/versão no escopo autorizado; cliente não publica fatos financeiros nem lê tabelas. Perda de evento/lacuna refaz consulta e usa polling de fallback. Eventual revogação impede nova consulta imediatamente, sem confiar no último evento de sessão.

PeriodClosureCreate gera snapshot PROVISIONAL com política, fontes/corte efetivo, versão da projeção, totais e pendências; revisão corrente divergente retorna 409. Publicação exige hash/corte/versão aprovados e preserva incompletude: PARTIAL não recebe selo de completo/conciliado. Nova revisão referencia a publicada anterior; evento tardio continua entrando no livro com datas original/registro e sinaliza impacto. Não há PATCH para reescrever fechamento publicado. Pacote fiscal mensal usa /exports conforme abaixo; outro aplicativo continua sem rota/adaptador de destino definido.

### Fiscal: emissor, revisão, aprovação humana e clique final

Gate obrigatório: configuração vigente por emitente/ambiente/modelo tem modo UNDECIDED, OS_PRIMARY ou EXTERNAL_PRIMARY. O fluxo atual confirmado pelo responsável é Olist prepara pendente → SHOP aprova/emite; o Ninebike reúne essas etapas em OS_PRIMARY. Não presumir arquivo/layout homologado nem dois emissores. UNDECIDED bloqueia transmissão; EXTERNAL_PRIMARY só prepara/exporta e importa/concilia evidência depois de comando humano, sem reemitir. OS_PRIMARY habilita submit apenas após contrato/capacidades homologados. Mudança de emissor requer conciliar documentos/numeração e operações em voo antes de ativar a nova configuração.

```text
FiscalDraftCreate = {
  issuer_configuration_id: UUID, order_id?: UUID,
  expected_order_version?: PositiveInt, purpose: SupportedFiscalPurpose,
  fiscal_input: ClosedFiscalInput, import_commit?: FiscalImportCommit
}
FiscalDraftPatch = {expected_version: PositiveInt, fiscal_input: ClosedFiscalInput}
ValidateFiscal = {expected_version: PositiveInt}
RequestFiscalApproval = {expected_version: PositiveInt, expected_document_version?: PositiveInt}
SubmitFiscalAction = {expected_version: PositiveInt, approval_id: UUID}
CancellationRequest = {expected_document_version: PositiveInt, reason: string}
CorrectionRequest = {expected_document_version: PositiveInt, correction_text: string}
NumberVoidRequest = {
  issuer_configuration_id: UUID, year: PositiveInt, series: string,
  number_start: string, number_end: string, reason: string
}
FiscalImportPreview = {
  issuer_configuration_id: UUID, evidence_attachment_ids: [UUID],
  source_description: string, mapping_revision: PositiveInt,
  supersedes_preview_id?: UUID, mappings?: ClosedFiscalImportMapping
}
FiscalImportCommit = {
  preview_id: UUID, expected_preview_revision: PositiveInt,
  preview_hash: string, approval_id: UUID
}
FiscalEvidenceImport = FiscalImportCommit
MonthlyFiscalExport = {
  dataset: fiscal_monthly_bundle, issuer_configuration_id: UUID,
  period_start: Date, period_end: Date, date_basis: SupportedFiscalDateBasis,
  include_danfe: boolean
}
FiscalConfigurationRequest = {
  expected_current_revision: NonNegativeInt, issuer_document: string,
  environment: HOMOLOGATION|PRODUCTION, model: SupportedFiscalModel,
  mode: UNDECIDED|OS_PRIMARY|EXTERNAL_PRIMARY, profile_evidence_attachment_id: UUID,
  provider_account_id?: UUID, schema_bundle_reference?: string,
  schema_bundle_evidence_attachment_id?: UUID,
  certificate_metadata?: {fingerprint: string, valid_until: Instant}
}
ActivateFiscalConfiguration = {expected_version: PositiveInt, approval_id: UUID}
```

issuer_configuration_id aponta revisão concreta permitida; modelo/ambiente/emitente reais vêm dessa configuração. Para origem pedido, servidor valida versão e deriva os fatos comerciais, destinatário/itens/valores disponíveis, sem aceitar ator/status/split livres. Dado fiscal informado é complemento controlado, não forma de reescrever pedido confirmado. Ausência de informação mantém rascunho incompleto e bloqueia aprovação/envio, sem tornar o lead retroativamente inválido.

ClosedFiscalInput é objeto fechado do perfil suportado. Campos de topo permitidos: `recipient`, `items`, `totals`, `transport`, `payment_classification`, `additional_information` e `numbering` quando aplicável. Cada subobjeto tem schema fechado versionado; não aceita expressões, XML arbitrário, funções ou JSON de tributação livre:

- `recipient`: nome/razão, tipo/documento, inscrição/regime e endereço quando exigidos pelo percurso; validação por modelo/operação/UF. Contato do CRM continua simples, dados adicionais só na etapa fiscal.
- `items[]`: `position, product_id?, description, ncm_code, cfop_code, measurement_unit, quantity_decimal, unit_price_decimal, discount_cents, freight_cents, other_expenses_cents, tax_status, taxes`. Quantidade positiva; zero/preço/escalas/limites seguem perfil aceito. CST e CSOSN são condicionais/mutuamente exclusivos conforme regime/operação, não escolhidos pela interface automaticamente.
- `tax_status/taxes`: grupos nomeados ICMS/IPI/PIS/COFINS/IBS_CBS somente quando cabíveis, com códigos, base, alíquota/unidade e valor nos schemas do perfil. Campos/obrigatoriedades/vigência dependem de pacote efetivamente verificado, tabelas e decisão do responsável fiscal; schema não escolhe incidência/alíquota/classificação. Grupo desconhecido é rejeitado, sem engine de fórmulas enviada pelo usuário.
- `totals`: totais/abatimentos em centavos derivados/recalculados no servidor e confrontados com origem comercial e itens; campo divergente rejeita o snapshot. Rateio de desconto/frete/despesas tem ordem persistida e soma exata, precisão/arredondamento fiscal aceitos, sem herdar 1,5% do software como regra tributária.
- `transport/payment_classification/additional_information/numbering`: somente campos do modelo/perfil habilitado, com finalidade/valores coerentes. Descrição de pagamento fiscal não cria recebimento; numeração/série seguem reserva/alocação contratadas, sem novo número automático para contornar timeout.

O contrato final deverá materializar esses schemas de runtime/XSD no incremento fiscal. Não fixar versão de NT/ZIP só porque aparece em resultado indexado do Portal NF-e; baixar/verificar pacote/hash e cronograma/homologação antes de aceitar perfil/configuração. Atualização normativa ou de código que mude payload invalida aprovações incompatíveis, sem modificar documento autorizado.

Lifecycle fechado:

1. POST /fiscal-documents cria DRAFT; PATCH só antes de despacho. Validations verifica sem transmitir e cria/recupera action ISSUE da revisão, retornando `action_id,version,validation_report,snapshot_hash,preparation_state`. Eventos/inutilização criam suas próprias actions em DRAFT; usam /fiscal-actions/{id}/validations. Nenhum desses comandos chama operação fiscal mutante ou gera lançamento de conta/estoque/Asaas.
2. GET /fiscal-actions/{id}/review mostra snapshot integral permitido e avisos. POST /approval-requests cria a própria identity.approvals PENDING, com snapshot/hash/versões/emitente/ambiente/modelo/finalidade e origem; `201` traz approval_request_id/version/hash. POST /approvals toma decisão humana pelo fluxo existente, sem transmitir. Tipos FISCAL_ISSUE/FISCAL_CANCEL/FISCAL_CCE/FISCAL_VOID_RANGE, separados da aprovação financeira.
3. Clique humano POST /submit verifica action/document/configuração/capacidade, hash, aprovação, ator/grants e MFA TOTP recente. Aprovação interna vale apenas para esse ato/revisão; modo duplo ou proprietário único segue configuração explícita. A RPC consome aprovação e cria/recupera external_operation/auditoria/command_receipt/job **somente de consulta**, atomicamente. Handler HTTP autenticado faz o CAS dispatch_started e chama a porta mutante; dispatch_origin=HUMAN_HTTP vem do servidor, não é campo aceito do cliente.
4. `202` aponta /operations/{id}; retorno aceito para processar não marca AUTHORIZED. Após transmissão possível, timeout é UNCERTAIN e scheduled/webhook só consultam/reconciliam o mesmo ato. Sem dispatch_started, novo clique pode retomar a mesma intenção após revalidar aprovação/MFA atuais; aprovação expirada/alterada invalida intenção ainda não enviada e exige nova revisão/decisão. Não reutilizar aprovação consumida para um segundo ato nem disparar transmissão pelo Cron.
5. Rejeição oficial conclusiva preserva XML/motivo/numeração/referência e admite revisão/correção somente no percurso contratualmente permitido, com nova aprovação/clique. Não encontrado isolado, lease vencido, refresh/reconexão/restore ou falta de webhook não autorizam retransmissão/renumeração. Reconciliação nunca regressa a SUBMISSION_STARTED/HUMAN_APPROVED de modo a habilitar novo envio.

Configuração segue o mesmo padrão local: POST /admin/fiscal-configuration-requests cria revisão DRAFT e identity.approvals PENDING com hash/capacidade/evidência; /approvals decide e /activate consome a aprovação no commit, verificando expected_current_revision e ausência de conflito com emissor/atos em voo. Conta/provedor/certificado/schema não são ativados pela mera gravação do pedido; A1/senha não transitam nesses DTOs nem em attachments comuns.

Mudanças relevantes de snapshot, revisão/origem, configuração/certificado, numeração, destinatário/itens/totais/tributos/texto do evento ou mapeamento/capacidade invalidam aprovação ainda não despachada. Revisão já submetida é imutável. Campos produzidos remotamente como assinatura/protocolo/número definitivo têm mapeamento explícito e histórico; prévia sem assinatura não é apresentada como XML autorizado já revisado em bytes.

Dimensões de resposta são separadas; exemplo sintético antes do clique:

```json
{
  "data": {
    "action_id": "3a5c2dd0-9781-44e8-bb51-d060ce00a090",
    "version": 3,
    "kind": "ISSUE",
    "preparation_state": "HUMAN_APPROVED",
    "official_status": "NOT_SUBMITTED",
    "operation_id": null,
    "protocol": null,
    "next_action": "HUMAN_SUBMIT_REQUIRED"
  },
  "request_id": "c8c7e8d4-1f2a-4c8f-a230-4d4a2589a002"
}
```

Estados oficiais/locais preservam raw_code/raw_status/status_source/verification_state/mapping_version e timestamps. AUTHORIZED requer resultado individual e protocolo/evidência oficial, não HTTP200/lote processado/DANFE impresso/status Olist “emitida”. DENIED_LEGACY é exclusivamente histórico/importado comprovado; não prever denegação corrente de 2026 só por constar em manual antigo. Informação local legada não comprovada fica LEGACY_LOCAL_UNVERIFIED/UNKNOWN, sem habilitar emissão repetida, entrega ou selo oficial. Imprimir/baixar DANFE registra acesso/artefato, nunca altera situação fiscal.

Cancelamento, CC-e e inutilização têm grants/justificativa/snapshot/aprovação/clique e resultado próprios. NFC-e65 não admite CC-e; NF-e55 tem correções limitadas, sem edição livre de tributo, emitente/destinatário ou datas. Faixa de inutilização não referencia nota fictícia: número/intervalo, ano, série, modelo/emitente/ambiente são travados, com conflito contra usados/pendentes/incertos. Elegibilidade, prazos, exceções e contingência seguem regra vigente validada, sem valores genéricos hardcoded. Salvar/autorizar/importar/cancelar fiscal não lança/estorna conta, estoque, Asaas ou comissão: qualquer efeito necessário usa comando humano distinto do módulo dono, com origem única.

Referência de nota e referência de ato são distintas: evento/protocolo próprio é o recurso principal da operação de cancelamento/CC-e/inutilização quando fornecido. Se não houver ID externo próprio do ato, preservar contexto/referência/protocolo sem fabricar ID; não vincular o mesmo ID de nota como recurso principal único de várias operações.

POST /fiscal-import-previews recebe FiscalImportPreview e retorna `202` com preview_id e operation_id de FISCAL_IMPORT_PREVIEW; GET /fiscal-import-previews/{id} retorna revisão/hash, estado ANALYZING/REVIEW_READY/BLOCKED/INVALIDATED, documentos/itens/eventos detectados, proveniência, diferenças, vínculos propostos e exceções por entrada. Fila só lê/valida arquivos privados em quarentena e consulta fonte autenticada quando suportada. Não cria contato, produto, nota operacional, série/número, obrigação, saldo, movimento ou transmissão. Todos os arquivos e alvos são autorizados no servidor; nenhum URL externo arbitrário é aceito. Bytes originais ficam em files/Storage privado; resposta é projeção autorizada, sem blob XML/base64/segredos ou payload bruto em JSON público. Cliente não fornece snapshots oficiais para serem aceitos sem comparação com os arquivos.

ClosedFiscalImportMapping é schema fechado por layout/perfil/mapping_revision comprovados: vínculos tipados de documento/pedido, produto/fornecedor/unidade e conversão de unidade, quando pertinentes, com posição/identidade da entrada e versões esperadas dos alvos existentes. Não aceita código executável, fórmula, status oficial, saldo ou tributo livre. Parser pode sugerir correspondência; não a confirma por nome aproximado nem extrai série/quadro de observação para alterar estoque. Mudança de arquivo/mapping/vínculo/classificação ou alvo gera nova prévia por supersedes_preview_id e invalida aprovação anterior. Formato transportado do Olist ainda não foi comprovado; não habilitar parser de planilha ou API do SHOPSimples por inferência dos vídeos.

Prévia separa PRE_ISSUE_DATA, ISSUED_DOCUMENT, EVENT e UNKNOWN, com verificação/evidência próprias. Deriva purpose EVIDENCE_ONLY para conjunto fechado de documentos/eventos ou PREPARE_DRAFT para exatamente um documento pré-emissão elegível; finalidades distintas exigem prévias/aprovações distintas. Arquivo com estado de origem desconhecido permanece bloqueado para incorporação operacional, lançamento e transmissão. “Recebimento Autorizado” na interface externa não significa baixa financeira; rótulo local não vira autorização fiscal sem correlação oficial. Reaproveita POST /approvals para FISCAL_IMPORT_COMMIT: alvo é preview_id/revisão, payload_hash congela arquivos/hashes, empresa/ambiente/modelo, classificação, mapeamentos, vínculos/versões, conjunto elegível de entradas e efeitos locais permitidos. OWNER com grant e MFA recente aprova; aprovar sozinho não incorpora nem envia. Não aprovar genericamente arquivos futuros ou itens com pendências.

POST /fiscal-evidence-imports é o clique humano de incorporação de FiscalEvidenceImport e retorna `202` com operation_id de FISCAL_IMPORT_EVIDENCE. Exige purpose EVIDENCE_ONLY, revalida prévia/hash/versões/aprovação e consome a aprovação atomicamente ao registrar a intenção local; não na pré-análise nem no ato de aprovar. Incorpora somente artefatos e vínculos oficiais verificados do conjunto aprovado, sem emitir novamente ou executar evento. Assinatura/schema isolados não provam autorização SEFAZ; sem protocolo/correlação suficientes, preservar original/status alegado como UNKNOWN/UNVERIFIED na quarentena e mostrar pendência. Armazenamento de arquivo não é incorporação operacional nem conclusão da obrigação fiscal.

Cada documento/evento é aplicado atomicamente com seus vínculos, artefatos e recibo idempotente; dedup de arquivo por hash é distinta da identidade fiscal e da identidade semântica do evento. Repetir comando, duas abas ou nova key para a mesma intenção não reaplicam entrada concluída. Resultado expõe APPLIED/ALREADY_LINKED/BLOCKED/FAILED por entrada, contagens, operation_id e pendências; lote parcialmente aplicado não recebe sucesso global. Retomada fica no conjunto congelado e só trabalha entradas ainda não aplicadas; alvo alterado exige nova revisão/aprovação. Não prometer atomicidade de um lote inteiro com consultas externas.

Para PRE_ISSUE_DATA comprovado e purpose PREPARE_DRAFT de um único documento, POST /fiscal-documents recebe import_commit e deriva o rascunho exclusivamente do snapshot aprovado, validando que fiscal_input e pedido/versões coincidem; cliente não troca dados após aprovação de incorporação. Preenche a tela a partir dos dados extraídos, sem exigir redigitação. O limite de um documento é recorte inicial do Ninebike, não limitação observada do SHOPSimples. Referência de negócio/origem estável impede que nova prévia/arquivo da mesma operação crie outro rascunho; ambiguidade exige vínculo/revisão, nunca associação só por valor/nome. A confirmação humana final consome atomicamente uma única aprovação/intenção com rascunho/proveniência/recibo idempotente, sem reutilizá-la para criar N rascunhos. Retorna rascunho local, sem alocar número ou transmitir; nova revisão/aprovação e clique de envio fiscal continuam obrigatórios. Esse percurso exige emitente/ambiente/modelo conferidos e não reutiliza documento já emitido; não exige ativar a transmissão para apenas preparar rascunho. Para documentos emitidos/eventos e purpose EVIDENCE_ONLY, usar apenas a incorporação de evidência, sem convertê-los em rascunho de emissão.

Nenhuma incorporação fiscal executa AP/AR/CMV/estoque/receita/caixa/comissão/refund. Prévia informa vínculos e efeitos já existentes; cadastro/entrada/obrigação eventualmente necessários exigem comandos humanos dos módulos existentes, permissões/aprovações próprias e origem única. Duplicatas descritas no XML não são prova de pagamento. Histórico respeita corte/abertura, sem recriar movimentações passadas. SHOPSimples/Alterdata foi identificado visualmente, mas não há conector, API homologada nem confirmação de importação/escrituração externa presumidos.

MonthlyFiscalExport usa POST /exports por clique humano; retorna `202` com export_id e Location /api/v1/exports/{id}. Worker congela filtros/lista/versões/corte e gera ZIP/manifesto privados de forma paginada/retomável. Critério de data/fuso fica visível; seleção cobre documentos do período e eventos oficiais ocorridos no período inclusive sobre notas antigas, conforme política fiscal aprovada. Versões históricas de configuração do mesmo emitente/ambiente/modelo não são omitidas por mudança de binding.

Manifesto registra identidade fiscal, modelos/ambiente/período/data-base/as_of, estados/proveniência, protocolos/eventos, caminhos/papéis/tamanhos/hashes SHA-256, contagens e totais por critério explícito, pendências/cobertura/paginação. Dedup é por identidade do documento/evento/artefato, não valor/nome. XML autorizado+protocolo, DANFE, XML de evento e inutilização são separados; originais não são reescritos. Status REQUESTED/BUILDING/READY/PARTIAL/FAILED é da exportação, não fiscal; falta/erro/paginação incompleta não vira READY completo. Nova geração tem revisão/ID, sem sobrescrever pacote entregue. GET /exports/{id} permite revisar manifesto/pendências e solicitar download privado pelos controles de acesso existentes. Nenhum destino, e-mail, URL de importação, agendamento mensal ou confirmação de escrituração é aceito/presumido; apenas geração/download locais autorizados.

Permissões fiscais são explícitas por ato: preparar/revisar/aprovar/enviar e ler/exportar/configurar. SELLER só prepara/valida rascunho e consulta situação/documento permitido da própria venda. Aprovação, envio, eventos, configuração e exportação exigem OWNER; n8n não recebe grants fiscais. Artefatos/imports/exports têm o mesmo escopo e finalidade, parser sem entidades XML externas e limites contra expansão/ZIP/caminhos indevidos. A1/senha ficam em custódia/segredo próprios; não retornam em API, logs, export, portal ou memória. Revogação/expiração/rotação bloqueia novas transmissões e invalida aprovações afetadas, preservando consultas dos atos já enviados.

Falhas específicas usam códigos estáveis: FISCAL_ISSUER_UNDECIDED, FISCAL_EXTERNAL_ISSUER_ONLY, FISCAL_PROFILE_UNVERIFIED, FISCAL_SNAPSHOT_CHANGED, FISCAL_NUMBERING_CONFLICT, FISCAL_OUTCOME_UNKNOWN, FISCAL_ACT_NOT_SUPPORTED. Schema/perfil/capacidade não definidos retornam 422; conflito/resultado incerto 409; permissão/MFA insuficiente 403. Campos secretos e XML bruto não aparecem no erro. Detalhes de fontes oficiais/limites da inspeção em [fiscal.md](../fiscal.md).

## 5. Webhooks e aplicação de fatos

| Rota externa | Autenticação/ack |
| --- | --- |
| `POST /webhooks/asaas/{binding_id}/events` | Token `asaas-access-token` do binding conta/ambiente, diferente da API key; `200` só após inbox+job duráveis. |
| `POST /webhooks/asaas/{binding_id}/authorization` | Mesmo vínculo autenticado; decisão síncrona oficial `APPROVED/REFUSED`, após validar intenção e persistir decisão. |
| `POST /webhooks/fiscal/{binding_id}` | Mecanismo exato homologado do provedor; consulta autenticada antes de efeito crítico quando necessário. |

Binding opaco identifica configuração, não autentica sozinho. Envelope inválido/token inválido recebe erro; DB indisponível nunca recebe sucesso durável. Duplicata autenticada já persistida recebe `200`; evento desconhecido válido é armazenado e sinalizado para revisão, sem inventar estado. Não exigir key local nem HMAC/timestamp inexistentes no contrato Asaas. [Recebimento oficial de eventos](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook).

Webhook fiscal persiste inbox/job e aplica apenas evidência oficial autenticada/correlacionada ao emitente/ambiente/ato, sem emitir, corrigir, cancelar, inutilizar ou reabrir submissão. Job fiscal de consulta não detém acesso à porta mutante. Nenhum evento fiscal cria conta/estoque/cobrança; efeitos de outros módulos exigem comando humano próprio com dedup de origem.

Autorização síncrona não usa `202`/fila para decidir depois. Transferência desconhecida, vínculo ambíguo ou dados divergentes são recusados. Primeiro ID externo consome atomicamente a intenção; callback do mesmo ID devolve decisão persistida, outro ID é recusado. Se callback preceder resposta de criação, só correlacionar por referência comprovadamente suportada; igualdade de valor/beneficiário não basta. Falha de banco não aprova. Não ativar autorização de split por padrão. [Validação oficial de saques](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks).

Dois níveis de dedup: entrega `(environment,provider,provider_account_id,event_id)` e efeito econômico `(environment,provider,provider_account_id,resource_type,resource_id,fact_kind,provider_fact_id)`. Identidade de fato ausente exige regra semântica homologada, não hash de payload nem comparação apenas por valor/data. Mesmo fato vindo de webhook e extrato gera um único lançamento; eventos diferentes do mesmo pagamento não multiplicam cobertura.

`FinancialFact` interno: `id,identity,kind,amount_cents,currency,occurred_at,observed_at,evidence_id,related_provider_object_id,reverses_fact_id?`. Aplicação transacional grava fato, lançamento equilibrado, projeção e chave de efeito. Correções usam compensação; nunca editar/apagar fato lançado. Fato sem pedido vira valor a identificar/divergência; dinheiro excedente permanece registrado e devido, não receita fabricada.

Consulta autenticada confirma conta/recurso/valor antes de efeito positivo. Estado bruto é preservado; enum desconhecido não autoriza entrega/saque. Não ordenar estados como inteiros: estorno, MED, disputa e bloqueio podem suceder recebimento. Captura da compra e parcelas liquidadas são a mesma obrigação; split e saque não aumentam faturamento. Perda de webhook é recuperada pelo extrato e recursos, com todas as páginas e checkpoint.

## 6. Portas mínimas dos provedores

Assinaturas abaixo são contratos TypeScript conceituais; não definem JSON oficial Asaas. `ProviderContext={environment,provider_account_id}` é resolvido no servidor. `Frozen*` são snapshots autorizados, com operação/referência estáveis. Nenhuma porta aceita credencial vinda do browser.

| Método de `PaymentsPort` | Retorno e uso |
| --- | --- |
| `capabilities(ctx, route): Promise<CapabilityRecord>` | Evidências válidas para conta/ambiente/percurso; ausência significa bloqueado. |
| `create_payment(ctx, FrozenPayment): Promise<DispatchResult<PaymentGraph>>` | Emissão hospedada/Pix/boleto conforme capacidade; grafo liga checkout/parcelamento/cobranças/splits. |
| `get_payment(ctx, PaymentRef): Promise<PaymentSnapshot>` | Referência externa tipada como grupo ou cobrança, com correlação explícita às folhas; estado/principal/captura/parcelas/taxas e evidência, sem inferir liquidação de screenshot. |
| `refund_payment(ctx, FrozenRefund): Promise<DispatchResult<RefundSnapshot>>` | Alvo `receivable_id` e referência externa folha congelados; total/parcial dessa folha somente se homologado; não presume semântica de refund do grupo. |
| `get_refund(ctx, RefundRef): Promise<RefundSnapshot>` | Resultado da intenção existente, vínculo exato à folha e reversões observadas; nenhuma expansão implícita a outras parcelas. |
| `quote_transfer(ctx, TransferIntent): Promise<FeeQuote>` | Calcula snapshot local de custo/validade com tabela/contrato/evidência aplicável; não exige endpoint remoto de quote/freeze inexistente. |
| `create_transfer(ctx, FrozenTransfer): Promise<DispatchResult<TransferSnapshot>>` | Saída única para beneficiário validado; criação não equivale a crédito bancário. |
| `get_transfer(ctx, TransferRef): Promise<TransferSnapshot>` | Estado, custo real, identificação e comprovante oficial disponíveis. |
| `lookup_operation(ctx, OperationLocator): Promise<LookupResult>` | `FOUND/NOT_FOUND/AMBIGUOUS/UNKNOWN`, com evidência; lookup só por mecanismos comprovados por endpoint. |
| `list_splits(ctx, PaymentRef, cursor?): Promise<Page<SplitFact>>` | Comissão prevista/pendente/liquidada/revertida diferenciada; inclui identificação da cobrança e destino. |
| `list_statement(ctx, Window, cursor?): Promise<Page<StatementFact>>` | Movimentos externos únicos e histórico necessário à conciliação, incluindo saídas feitas fora do OS. |
| `get_balance(ctx): Promise<BalanceSnapshot>` | Disponível/bloqueado/a receber conforme semântica oficial, fonte/horário; não calculado por soma de pedidos. |

`DispatchResult<T>` discrimina `ACCEPTED` com ID/evidência, `REJECTED_FINAL` com motivo conclusivo ou `UNKNOWN` após envio possível. A aceitação remota não é necessariamente estado econômico final. Resposta perdida usa `UNKNOWN`; adaptador não converte timeout em rejeição nem faz retry financeiro oculto. `Page<T>` informa cursor e completude; importação parcial jamais fecha conciliação.

`CapabilityRecord` inclui `account,environment,route,contract_schema_revision,evidence_ids,verified_at,valid_until,status`, além dos fatos necessários: emissão hospedada sem PAN/CVV; vínculo exato da cobrança/QR; split fixo sobre bruto e rateio total; consultas de IDs/parcelas/splits; estorno total/parcial e reversões; tarifa Pix de recebimento fixa sem percentual; custo/beneficiário/autorização de saída; lookup seguro; extrato e semântica de saldo. Configuração/regra pode expirar antes da data; divergência invalida a capacidade.

Koin acrescenta evidências do QR dinâmico específico, conta, faixa comercial, crédito/entrada, split Asaas, destinatário do refund e dívida total/parcial. Aprovação de crédito ou transferência por chave não comprova baixa da cobrança. Sem contrato próprio, OS apenas registra “Koin App informado” e acompanha o Pix; não inventa dívida, parcelas ou estado Koin.

Fiscal separa `FiscalReadPort.get_document/get_action/get_artifacts/lookup` e `FiscalSubmitPort.issue/cancel/cce/void_range`. Scheduled/webhook só recebem a porta de leitura; SubmitPort só é composto no caso de uso HTTP humano, com modo OS_PRIMARY, aprovação/capacidade e identidade durável. Métodos validadores remotos só entram se comprovadamente sem transmissão/efeitos. Cada ato tem capability/schema/autenticação/consulta/numeração próprios homologados; suporte de issue não prova suporte de CC-e/inutilização/cancelamento. Emissor/destino ainda desconhecidos impedem implementar o adaptador por suposição.

`MessagingPort` segue o contrato de comunicação da seção 8. Emissão fiscal não equivale a autorização; WhatsApp enviado não equivale a entregue. Não criar API Koin obrigatória ou gateway genérico para todo fornecedor.

## 7. Verificação de contrato exigida na implementação

| Fronteira/cenário | Resultado observável |
| --- | --- |
| Auth inválido, usuário desativado, vendedor fora da carteira | `401/403/404` adequado, nenhuma mutação/PII/effect remoto. |
| Nome/celular ausentes; opcionais omitidos/brancos; PATCH sem opcional | `422` só para obrigatórios inválidos; opcionais normalizados em `null`; PATCH omitido preserva valor, inclusive formulário público. |
| Modelo com quantidade zero/positiva sem séries; estoque alterado por PATCH | Cadastro/entrada auditados e unidades internas geradas; PATCH de saldo rejeitado; custo desconhecido não gera margem. |
| SELLER tenta editar catálogo/saldo ou sacar, inclusive com grant inválido/claim forjado | `403`; SELLER consulta/reserva no escopo, sem escrita de catálogo/financeiro. |
| Foto adulterada/acesso por UUID; recontagem conflita com reserva | Upload/acesso indevido negados; divergência visível sem apagar reserva/movimentos. |
| Movimento/edição concorrente do pipeline; etapa ocupada arquivada | `409`; histórico preservado; nenhuma alteração de cobertura, saldo, fiscal ou estoque. |
| Body injeta ator, comissão, carteira, valor de cobrança ou beneficiário livre | `422`; valores continuam derivados no servidor. |
| Centavos inválidos/overflow; base R$ 8.000; alocações com arredondamento | Entrada rejeitada ou alvo `12000` cents exato; soma das fatias igual ao alvo. |
| CARD sem count; meio diferente com count; alteração após tentativa congelada | CARD normaliza 1, demais persistem null/rejeitam campo informado; emissão mantém termos aprovados e quantidade de folhas comprovada. |
| Duas reservas simultâneas; expiração disputando confirmação | No máximo uma ativa por unidade, estoque não negativo; confirmação não usa reserva vencida. |
| Mesma key/hash, key/hash divergente, nova key sobre intenção pendente | Replay sem efeito novo; `409`; IDs existentes recuperáveis. |
| Timeout após dispatch e worker antigo após reconciliação | `UNCERTAIN`, sem segundo POST; lease/geração antiga não sobrescreve evidência nova. |
| Aprovação alterada, expirada, mesmo solicitante no modo duplo | Execução negada antes da rede; modo proprietário único precisa registro explícito. |
| JWT aal2 antigo/refresh recente, AMR TOTP ausente/futuro, challenge_id forjado | `403 MFA_RECENCY_REQUIRED` ou `422` de campo desconhecido; somente claims assinados com TOTP até 300s autorizam nova aprovação/execução. |
| Tarifa de saque muda/vence; duas saídas disputam saldo | `REAPPROVAL_REQUIRED` ou saldo insuficiente; reserva de débito total atômica. |
| Tarifa diferente só aparece no extrato após transferência | Débito real preservado, incidente/alerta; não alegar congelamento remoto nem apagar dinheiro. |
| Callback saque duplicado, outro ID igual em valor, callback antes da resposta | Mesma decisão para mesmo ID; outro recusado; sem correlação comprovada, bloqueia. |
| Webhook duplicado, eventos diferentes do mesmo fato, extrato sobreposto | Um inbox por entrega e um efeito econômico; livro equilibrado. |
| Banco cai antes do ack, assinatura Meta alterada, token Asaas incorreto | Sem `200` durável/fato financeiro indevido; reentrega posterior recuperável. |
| Evento fora de ordem, enum novo, chargeback após recebimento | Reversão preservada; desconhecido revisado; sem cobertura/entrega fictícia. |
| Parcela + captura, split + saque, pagamento excedente/tardio | Sem contagem dupla; excedente como obrigação; bike não revendida automaticamente. |
| Pix fixo, Pix percentual, Checkout sem split comprovado, Koin sem refund | Fixo aceito pela política; demais percursos bloqueados por capacidade. |
| Link/QR antes de verificar split ou alteração esvazia split | Link/QR retidos; incidente e bloqueio da modalidade. |
| Refunds parciais concorrentes, MED/chargeback, restituição integral | Limite elegível respeitado; comissão remanescente zero no total; nenhuma nova devolução automática indevida. |
| Tentativa com N folhas, refund de uma folha, endpoint externo só de grupo | `/payments/{id}` identifica tentativa e lista folhas; refund não afeta irmãs; sem semântica folha homologada, comando bloqueado. |
| Devolução total distribuída em N refunds; uma folha falha/incerta | UI propõe plano por return_id sem IDs técnicos; acompanha resultados por folha, preserva execução anterior e não anuncia sucesso integral. |
| Entrega com versão/cobertura/risco/fiscal inválidos | `409/422` e nenhum movimento de entrega. |
| Paginação interrompida, saldo antigo, operações após restore | Sem selo conciliado/saque novo; efeitos externos restaurados não são reenviados. |
| Fornecedor sem celular; contato recebe CUSTOMER sem celular; papel injeta beneficiário | SUPPLIER pode ter só nome/tipo; adicionar CUSTOMER exige celular; dados bancários operacionais rejeitados. |
| Custo de catálogo muda após entrada/venda; acessório sem método/custo | Histórico preservado; CMV usa custo atribuído; incompletude/pendência explícita, sem zero implícito. |
| Gasto reconhecido e depois baixado parcialmente; compra ainda em estoque | Despesa/ativo uma vez; obrigação remanescente exata; compra e CMV não deduzidos juntos. |
| Duas abas baixam mesma obrigação/fonte; comprovante reaparece no extrato | Locks/somas impedem excesso; vínculo ao efeito existente, sem nova saída/baixa. |
| Registro externo tenta debitar Asaas ou confirmar recebimento de venda | 422/403; snapshot, cobertura e split oficiais não mudam. |
| Regra staff incompleta ou futura; funcionário muda/desliga | Ativação incompleta negada, NOT_CONFIGURED sem regra; snapshots antigos preservados. |
| Comissão reconhecida, liberada parcialmente, paga e revertida depois | Dimensões separadas; despesa uma vez, baixa limitada ao liberado; reversão segue política/ajuste, sem desconto automático. |
| Vendedor troca staff_id, solicita custo ou assina canal/export alheio | 404/403 conforme visibilidade; nenhum dado financeiro fora do scope SELF. |
| Fechamento simultâneo, fato tardio ou custo/tributo ausente | 409 de versão; publicado preservado com revisão/impacto; PARTIAL/null, sem lucro final inventado. |
| Fiscal aprovado sem clique; modo UNDECIDED/EXTERNAL_PRIMARY; scheduled tenta mutação | Sem operação/envio indevido; submit bloqueado e porta mutante ausente no scheduled; preparação/export/evidência continuam conforme escopo. |
| Campo fiscal/configuração muda, duas abas enviam, resposta perde após dispatch | Approval invalidada ou operação única; resultado incerto só consulta, sem número/referência novos ou regressão a pronto para envio. |
| CC-e em modelo65, faixa usada/incerta, cancelamento rejeitado, status local Olist | Ato indisponível/conflito, documento não vira cancelado/autorizado sem evidência oficial; legado preservado com origem/confiança. |
| Nota salva/importada/autorizada/cancelada, impressão de DANFE | Nenhuma conta/estoque/Asaas implícitos e impressão não muda status; artefatos/acessos auditados. |
| Export com página/XML faltante, evento de nota antiga, import sem prova oficial | PARTIAL/pendência, dedup e manifesto/hash; import não emite nem fabrica autorização/importação no outro software. |

São cenários de aceite pendentes, não resultados de testes executados. Na implementação, schemas de runtime e rotas devem compartilhar essas definições; exemplos e testes de HTTP/RPC/adaptador comprovam o contrato. API interna pode evoluir junto do frontend, mantendo migrações/deploys compatíveis; alteração incompatível deliberada exige revisão e `/api/v2` quando consumidores v1 continuarem ativos.

## 8. Campanhas finais, IA de composição e aniversariantes automáticos

T12 continua posterior ao núcleo T14. Não implementar inbox/chatbot/handoff, service_principals n8n, contexto/resposta da IA de atendimento ou mudança no workflow atual. `integrations.inbox_events` técnico financeiro/fiscal permanece. IA aqui só gera conteúdo da campanha e usa credencial backend administrativa, sem sessão humana/tokens da automação externa.

### Cadastro e consulta de aniversariantes — T02

ContactCreate/ContactPatch aceitam Birthday opcional conforme os schemas fechados; omitido preserva no PATCH, null limpa o conjunto. PF é confirmado explicitamente para uso em lista/rotina, sem inferir de nome/documento e sem impedir criar lead mínimo. Validar calendário, nascimento futuro quando ano completo,29/02 sem ano e ausência de idade. Nos CSVs atuais não há aniversário; dado ausente permanece null.

`GET /contacts/birthdays?from=YYYY-MM-DD&to=YYYY-MM-DD` usa intervalo civil semiaberto em America/Sao_Paulo, carteira atual e cursor. Atalhos do dia, do mês e intervalo correspondem ao modal Olist observado; calendário pode pedir leap_policy para29/02 em ano comum. Retorna id, name, city?, phone?, mobile_phone, email? e birthday/occurrence_date/occurrence_year quando resolvidos, mais pendências, sempre no escopo. Cidade/telefone alternativo/e-mail são colunas opcionais recolhidas por padrão na UI para manter o layout limpo; sem CPF/custo/financeiro. Não cria campanha nem consome quota por consulta. O mapeamento futuro de dataNascimento completo da origem conserva dia/mês/ano; não preencher o ano ausente artificialmente.

### Público e permissões de campanhas

`GET/POST /campaigns`, `GET/PATCH /campaigns/{id}`, `POST /campaigns/{id}/previews`, `POST /campaigns/{id}/starts`, `POST /campaigns/{id}/pauses`, `POST /campaigns/{id}/resumptions`, `POST /campaigns/{id}/cancellations`, `GET /campaigns/{id}/recipients` e `GET /campaigns/{id}/recipients/{recipient_id}/preview`: SELLER nas próprias campanhas e fontes autorizadas; OWNER loja. Mutação exige Idempotency-Key e versão; autoria/conta/revisão e escopo são derivados e revalidados no commit/dispatch. Atualizar campanha em execução exige pausar e nova revisão, sem reescrever enviados ou reativar destinatários já decididos.

`GET /campaign-sources` lista CRM e base comercial WhatsApp conectada permitidas. `POST /campaign-sources/whatsapp/refresh`, `GET /campaign-sources/whatsapp/contacts` fazem solicitação/consulta paginada de diretório com binding server-side, source_revision, as_of, completeness e erro explícitos. SELLER só fonte comercial concedida; fonte/referência de outra conta negadas mesmo se o ID existir. Não usar listagem de mensagens/histórico ou número livre como substituto do diretório. Referência de contato do canal não cria contact CRM; nome/telefone não comprovados ficam pendentes ou excluídos. Nenhuma data de nascimento é inferida da agenda.

`GET /campaign-quota` retorna dia/fuso, limite fixo70, remaining e contagens agregadas de reserva/consumo/incerto, sem expor telefones/campanhas de outros vendedores. Esse orçamento é global da loja aos disparos Ninebike, não contador do WhatsApp inteiro ou da IA externa.

```text
Birthday = {day:PositiveInt, month:PositiveInt, year?:PositiveInt|null}
CampaignAudience = {source:CRM, contact_ids?:UUID[], filters?:AllowedCampaignFilters} |
                   {source:WHATSAPP, directory_refs:string[]} |
                   {source:MIXED, contact_ids:UUID[], directory_refs:string[]}
DelayRange = {min_seconds:PositiveInt, max_seconds:PositiveInt}
Personalization = {enabled:boolean, brief?:string, fallback?:BASE|SKIP}
CampaignContent = {kind:TEXT,text:string} |
                  {kind:TEMPLATE,template_binding_id:UUID,parameters:[{name:string,value:string}]}
CampaignDraft = {name:string, kind:GENERAL|BIRTHDAY, audience:CampaignAudience,
                 content:CampaignContent, delay?:DelayRange, personalization?:Personalization,
                 scheduled_for?:Instant|null,
                 birthday_period?:{from:Date,to:Date,leap_policy?:FEB_28|MAR_01|SKIP},
                 birthday_time?:LocalTime}
CampaignPatch = CampaignDraft & {expected_version:PositiveInt}
CampaignCommand = {expected_version:PositiveInt}
CampaignStart = CampaignCommand & {preview_hash:string}
BirthdayRuleCreate = {scope:OWNED|STORE, enabled:boolean, local_send_time?:LocalTime,
                      window_end_time?:LocalTime, leap_policy?:FEB_28|MAR_01|SKIP,
                      content:CampaignContent, delay?:DelayRange, personalization?:Personalization}
BirthdayRulePatch = BirthdayRuleCreate & {expected_version:PositiveInt}
BirthdayToggle = {expected_version:PositiveInt, enabled:boolean}
CampaignMasterToggle = {expected_version:PositiveInt, automations_enabled:boolean}
CampaignSendsToggle = {expected_version:PositiveInt, campaign_sends_enabled:boolean}
MarketingPreference = {expected_version:NonNegativeInt, state:ALLOWED|SUPPRESSED,
                       evidence_file_id?:UUID}
```

AllowedCampaignFilters é conjunto fechado de origem/etapa/responsável/etiqueta; CRM escolhe IDs OU filtros, nunca ambos; WHATSAPP/MIXED só referências da fonte permitida. Lista vazia/inválida rejeitada, sem ampliar para “todos”. Diretório com LID não resolvido não envia. Birthday manual/automático só CRM PF com data válida; MIXED/WHATSAPP são recusados para BIRTHDAY. Endpoint repetido no público vira uma seleção, com motivo/ambiguidade de personalização tratados antes da prévia, sem merge CRM. Número e conta nunca são definidos pelo modelo.

GENERAL permite scheduled_for UTC/Z ou início agora e não recebe campos birthday; BIRTHDAY exige período e horário HH:mm local (ou defaults aceitos e exibidos), não recebe scheduled_for. Servidor deriva due_at por occurrence_date em São Paulo. Horário ambíguo/inexistente precisa resolução; ocorrência passada é excluída, sem catch-up implícito. Binding é o único canal de campanha configurado/aceito pelo OWNER e snapshot da revisão; mudança invalida prévia. Nenhuma campanha altera o workflow/callback n8n ou cria uma sessão WhatsApp paralela.

DelayRange exige min≤max, valores seguros e compatíveis com resolução/limites do consumidor. Omissão usa default da política aceito e mostrado na prévia; usuário não precisa digitar min/max para cada contato. Sortear uniformemente e persistir next_dispatch_at/intervalo uma vez no avanço, não no retry. Antes de despachar, CAS do gate serializa campanhas na conta, revalida due_at/dia/horário/perfil/escopo/campaign_sends_enabled e, só para automação, automations_enabled, além de opt-out e quota da loja. A execução acontece no primeiro ciclo útil após vencimento; max não é SLA de entrega. Não esperar dentro do Worker.

### Geração de conteúdo, prévia e aceite

`POST /campaigns/{id}/previews` congela revisão/fonte/contexto e solicita geração/preparo durável se necessário, retorna202 com operation_id e estado, ou200 com resultado já pronto. Repetir key/hash não repete geração nem sobrescreve texto aprovado. CAMPAIGN_GENERATE key semântica por revisão+destinatário+contexto; saída velha vira INVALIDATED. A prévia manual só fica READY quando cada selecionado tem texto validado/base autorizada ou exclusão explicitamente contada; erro não vira sucesso escondido. `GET .../preview` permite examinar cada texto, sem exigir clique/edição de cada contato.

Contexto IA é construído no servidor a partir de nome/observação comercial e campos CRM permitidos da carteira; data/telefone/CPF/fiscal/custos/secrets não são necessários e não vão ao modelo. Observação livre é minimizada/filtrada; contexto inseguro fica fora. Para fonte WhatsApp sem vínculo, apenas nome permitido e texto/brief da campanha, sem inventar relação/histórico. Modelo sem ferramentas ou acesso ao banco; prompt não segue instruções da observação. Validação rejeita afirmação/variável não suportada, preço/benefício inventado ou formato inválido. Template aprovado só admite parâmetros permitidos, sem IA trocar livremente seu corpo. Fallback BASE precisa existir e ter sido autorizado; SKIP mantém motivo. Não apresentar texto de fallback como geração personalizada bem-sucedida.

Start manual exige preview_hash atual e textos congelados, não autoriza alteração posterior pelo modelo. Recipe da automação aniversário é aceita ao ativar: autoriza gerar/enviar diariamente dentro das regras, sem novo clique por pessoa/dia. OWNER configura provedor/modelo, versão, allowlist de campos, segredos e orçamento/limites; SELLER só liga a opção de composição dentro dessa política. Falta de capacidade/orçamento não gera credencial fictícia ou API aberta, usa base aceita/exclusão conforme regra. Nenhum comando de geração cria receita, desconto, saque ou ato fiscal.

### Aniversário diário automático

`GET/POST /birthday-rules`, `GET/PATCH /birthday-rules/{id}`, `POST /birthday-rules/{id}/toggle`, `GET /birthday-rules/{id}/runs`: SELLER próprio scope OWNED (owner_id atual do contato), OWNER também STORE. `GET /admin/campaign-policy`, `POST /admin/campaign-policy/automations-toggle`, `POST /admin/campaign-policy/sends-toggle` e configuração/credenciais globais são OWNER. automations_enabled pausa apenas birthday automático; campanha manual não depende dele. campaign_sends_enabled pausa todo despacho Ninebike, manual ou automático. Os dois toggles são OWNER e não recebem payload de teto>70; toggle geral não muda a IA externa. Enumeração de regras/runs respeita o mesmo escopo. Uma STORE habilitada no máximo por loja e uma OWNED habilitada por responsible_user_id; em OWNED o responsável deriva do criador e é imutável nesta versão; alterar regras de outra pessoa é OWNER e auditado.

Ativar regra valida data/horário/janela/base ou receita IA, intervalo e canal, mostra resumo e grava revisão/aceite. Ativação autoriza materializações diárias no fuso comercial; Cron não precisa aprovação nova. Regra pessoal do responsável ativo precede a STORE; STORE cobre os demais. Um run por regra/data, com reprocessamento para incluir novos elegíveis na janela; cada contato/endpoint/ano é reservado uma vez entre todos os runs/campanhas manuais. Desligar regra/master invalida trabalhos não despachados por revisão; envio em voo não pode ser desfeito. Reativar não recupera aniversários passados nem duplica os atuais.

Proposta inicial de defaults: IA off, intervalo 60–180s, envio 09:00 e encerramento 18:00; OWNER aceita/adapta uma vez conforme operação/canal antes de habilitar, campos diários reutilizam esses valores.29/02 em ano comum exige decisão FEB_28/MAR_01/SKIP na configuração; ausência gera pendência só dos afetados. Dia/mês sem ano continua válido e não calcula idade. Mensagem com cupom/oferta é só texto: fluxo de desconto comercial normal continua obrigatório.

Materialização diária pode reservar ocorrência anual antes da geração para impedir corrida, mas nunca consome quota diária até o despacho. O budget global 70 é alocado just-in-time. Preview manual não reserva; start aceito reserva sua ocorrência. Reutilizar ocorrência de revisão cancelada exige prova de nenhum despacho e CAS, preservando auditoria e invalidando jobs antigos. ACCEPTED/UNCERTAIN ou tentativa possivelmente despachada mantêm a trava anual. Telefone/CPF/owner/edit/merge não a apagam; ano e endpoint são evidência, não heurística de identidade.

### Limite diário, ritmo e estados

Quota por data civil São Paulo é compartilhada por toda a loja e todos os bindings/usuários/campanhas/runs. Antes da rede, RPC trava daily_quota/gate/recipiente/operação/ocorrência e reserva slot único dia+endpoint ligado à operação. Counts não negativos e RESERVED+CONSUMED+UNCERTAIN≤70 são constraint e teste de concorrência, nunca contador do browser. O mesmo endpoint não recebe segundo disparo promocional Ninebike naquele dia como default de proteção. Novas keys/campanhas/contas não removem a trava.

Autorização contém dia/expiração/geração; antes da chamada de rede verificar validade/dia novamente. Vaga antiga não autoriza envio depois da virada: se comprovadamente sem dispatch, mover/revalidar a mesma intenção no dia corrente sob locks e gate; se houver incerteza não mover/repetir automaticamente. Aceito ou incerto mantém quota do dia de despacho, mesmo se status chegar depois. Só falha conclusiva sem envio pode liberar/reutilizar a MESMA reserva. Contagem é dos disparos do Ninebike, sem afirmar70para envios externos do n8n.

Padrão proposto: aniversário automático do dia precede geral, depois due_at/ID estável; vagas ociosas não ficam reservadas para sempre. Geral sem vaga segue para próximo dia permitido; aniversário sem vaga/janela expira com EXPIRED_DAILY_LIMIT/EXPIRED_WINDOW, aviso curto e sem recuperação automática. Projeção exclusive pending/accepted/delivered/read/failed/uncertain/skipped/cancelled/expired; queued é pending, entregue/lido não somam duas vezes. COMPLETED é processamento resolvido, não entrega de todos; incerto aberto não recebe selo completo.

`POST /contacts/{id}/marketing-preferences` e equivalente `POST /campaign-sources/whatsapp/contacts/{ref}/marketing-preferences` derivam endpoint da fonteautorizada. SELLER pode registrar supressão ou evidência de permissão no escopo; ALLOWED exige prova/revisão válida conforme política, nunca consentimento inventado por listar/cadastrar. expected_version0 espera ausência sob UQ, positivo atualiza CAS; revogação prevalece entre fontes/duplicatas e é revalidada no dispatch. Sem fonte suficiente de opt-out, manter automação pendente em vez de presumir elegibilidade.

`MessagingPort.send/get/capabilities` só serve aos disparos finais. Diretório usa `CampaignDirectoryPort.list` paginado por referência opaca com source_revision/completude e autorização local; versão/engine reais precisam ser exercitadas. Consulta/status ou `POST /webhooks/campaign-delivery/{binding_id}` independentes autenticados preservam o webhook do n8n. Persistir inbox técnico+job antes do ack; conta+endpoint+ID bruto correlacionam, sem dedup por frase/horário. Sem lookup conclusivo, manter UNCERTAIN/NEEDS_REVIEW e não repetir POST. Restore congela saídas por controle fora do banco e exige reconstrução do budget/ocorrências; dado perdido não vira vaga livre.

Estados únicos do slot e dos contadores: RESERVED/DISPATCHING contam em reserved_count; CONSUMED em consumed_count; UNCERTAIN em uncertain_count; RELEASED não autoriza rede e conta zero. Soma das três contagens é≤70 e corresponde aos slots sob a mesma transação, não apenas um número solto. Aceito/entregue/lido mantêm CONSUMED; tentativa possivelmente enviada muda DISPATCHING→UNCERTAIN, sem liberar vaga; confirmação move incerto→consumido sem somar duas vezes. Falha tardia depois de aceite não libera slot. Liberação só com evidência conclusiva de nenhum envio, validada no servidor, nunca boolean informado pelo browser.

Inserir/transicionar/revincular slot atualiza contadores e autorização na mesma RPC sob lock de quota e destinatário/operação. Callback duplicado compara o estado/fato e é no-op para quota. Ao mover autorização comprovadamente sem dispatch entre dias, travar linhas antiga/nova em ordem de data, validar conflitos de endpoint e capacidade, decrementar/incrementar atomicamente e invalidar geração antiga; com incerteza não migra automaticamente. Corrupção/divergência de contagem ou restore sem reconstrução comprovada bloqueia envios, não assume70vagas livres. A quota de um dia usa o dia de autorização efetiva de despacho, não o dia do callback tardio.

Conteúdo comercial com preço/oferta fornecidos no texto base só é aceito conforme dados e alçada comercial atuais; IA não inventa benefício nem transforma observação em preço aprovado. Antes de enviar, revalidar vigência/condições quando a mensagem as prometer; divergência invalida preparo e não altera pedido/Asaas silenciosamente. Esses controles não acrescentam taxa ou texto técnico na tela comum.

Porta externa de composição, somente backend: `CampaignContentPort.generate({generation_key,recipe_revision,model_binding,context_snapshot,max_output_chars,token_budget})` retorna `{state:READY|REFUSED|FAILED,text?,model_revision,usage?}`. Contexto é DTO fechado/minimizado, sem IDs de credencial ou ferramentas de negócio; adapter não decide telefone/destinatário. Validação do caso de uso, hash e CAS antecedem READY; formato inválido/recusa usa fallback ou exclusão e nunca chama transporte diretamente. Provedor/SDK/limites reais são fixados e testados em T12; não adicionar framework de agentes ou chamada de modelo nesta revisão.

A campanha mantém seu próprio next_dispatch_at/sample persistido além do gate compartilhado do canal. Elegibilidade exige ambos vencidos, due_at do destinatário e janela permitida. No start e em cada avanço, atualizar próximo vencimento da campanha e gate no commit autorizado, com amostra/revisão auditadas; outra campanha não sobrescreve o relógio individual. Não antecipar envio porque o canal está livre nem re-sortear ao retomar o mesmo avanço.
