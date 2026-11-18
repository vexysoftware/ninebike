# NINEBIKE OS — tarefas de implementação v2.10.0

**Atualização v2.10.0 — 26/10/2026:** implementação suspensa por pedido do responsável; provedor financeiro em revisão (recebimento integral D+1, condições comerciais em revisão privada). O fiscal reúne Olist e SHOP Simples com aprovação/confirmação humanas; o responsável confirmou que os dados saem pendentes do Olist e são aprovados/emitidos no SHOP; arquivo/layout e homologação ainda precisam de validação. As referências financeiras anteriores não representam fornecedor atualmente escolhido. Ver [decisões atuais](../../README.md) e [fluxo fiscal](fiscal.md).

Atualizado em 26/10/2026. As 17 tarefas T00–T16 continuam pendentes, com 175 cenários de aceite futuros. Referências: [guia de construção](build-guide.md), [spec](spec.md), [arquitetura](architecture.md), [plano](plan.md), [design](design.md), [dados](data-model.md), [API](contracts/api.md), [aceite](acceptance.md). Nenhum comando abaixo foi executado como teste de aplicativo nesta entrega documental.

## Regras de execução

**Recorte sem PSP — 26/10/2026:** seguir [build-guide.md, seção 2.1](build-guide.md): T01 → T02/T03 → T04/T05 integradas; T10/T16 internos e T11 preparo avançam somente após suas dependências. Contratação, taxas, antecipação D+1, split operacional, T07–T09, conciliação oficial e Koin ficam pendentes. Não marcar tarefas inteiras concluídas por entregar apenas sua parte interna, nem enfraquecer aceites de entrega/recebimento/produção. Esta revisão documental não retoma implementação.

Para lógica: criar o teste, observar a falha esperada, implementar o mínimo e observar sucesso. Cada entrega termina com evidência e revisão do risco. Ownership por fluxo; contratos/migrations compartilhados são alterados em sequência. Não criar arquivos vazios antecipadamente. Os scripts npm serão criados em T01 no aplicativo futuro; este pacote não é um aplicativo executável.

Fase 1 mantém a finalidade das funções inspecionadas do Olist, com melhor UX/segurança e controles pedidos, sem copiar automações fiscais ou permissões inseguras. T11 unifica o preparo e a conferência observados no SHOP Simples; o estado pendente na saída do Olist foi confirmado; formato e passagem técnica continuam pendentes. Cada tarefa registra separadamente **código/testes concluídos** e **capacidade habilitada**: contrato ou configuração ausente bloqueia o efeito dependente, não a construção dos módulos independentes. Fixtures/mocks só em desenvolvimento/testes, nunca saldos ou pagamentos fictícios em produção. Referências visuais posteriores não bloqueiam T01–T04.

## T00 — Condições de implantação

**Dono:** Ninebike + prestadora + engenharia. **Arquivos futuros:** `docs/operations/provider-capabilities.md`, `launch-settings.md`.

- [ ] Após escolher o PSP, registrar contrato/contas ou recebedores/titulares, credenciais e autenticação, tarifas/vigências, meios/bandeiras/parcelas, antecipação integral D+1 e seus cortes/calendário, reservas e limites. Asaas é referência histórica, não escolha atual obrigatória.
- [ ] Formalizar comissão 1,5% bruto, frete/acréscimos, reversões/perdas/tarifas e responsabilidades; provar cada percurso de split/saque/consulta após timeout. Separadamente aprovar taxa/base/atribuição, reconhecimento, liberação, vencimento e reversão da equipe; sem regra, mostrar não configurado e bloquear cálculo/liberação correspondentes.
- [ ] Registrar contador/UF/regime/certificado, canal de disparos somente na etapa final (sem gate de comunicação no núcleo), alçadas, prazo de reserva/proposta, beneficiário PJ, recuperação/retenção e responsáveis.

**Aceite:** capacidades vinculadas a evidências; condição desconhecida fica bloqueada. T00 pode correr em paralelo à construção futura e Koin não impede módulos independentes. O fiscal unifica Olist prepara pendente → SHOP aprova/emite no Ninebike, via OS_PRIMARY; contrato/certificado/modelos/UF/perfil condicionam ativação. Implementação permanece suspensa até orientação explícita, conforme recorte do guia.

## T01 — Runtime, identidade e segurança

**Dono/arquivos:** foundation/identity; `src/worker.ts`, `src/modules/identity/`, `src/adapters/http/auth.ts`, `src/web/auth/`, migrations identity e configuração Vite/Worker.

- [ ] Fixar versões/compatibility date e separar ambientes/keys; criar scripts `typecheck`, `build`, `test:unit`, `test:integration`, `test:db`, `test:e2e`.
- [ ] Inspecionar o repositório de produto escolhido antes de criar estrutura; reaproveitar convenções/dependências. Montar base UI acessível conforme [design](design.md), migrations versionadas, grants/RLS restritos e Storage privado no ambiente de teste, sem tabelas vazias para módulos futuros.
- [ ] Em `tests/integration/access.test.ts`, provar vendedor sem saque, perfil desativado negado apesar do JWT, grants acima do teto SELLER negados e anon sem escrita de tabela/RPC.
- [ ] Implementar Auth oficial, bearer/sessão por aba, grants atuais, convite, MFA recente, validação/erros, CSP e auditoria; provar build no runtime Workers.
- [ ] Executar teste de acesso, `npm run typecheck` e `npm run build`; registrar ausência de secrets no browser/preview.

**Aceite:** SEG-01–08/15–17/22–24. **Produz:** ator, autorização e contratos HTTP usados por todas as tarefas.

## T02 — Contatos, fornecedores, CRM, pipeline e landing

**Dono/arquivos:** CRM; `src/modules/crm/`, `src/web/crm/`, `src/adapters/http/crm.ts`, `public/`, migrations CRM. **Depende:** T01.

- [ ] Em `tests/unit/lead-validation.test.ts`, afirmar nome+celular suficientes, CPF/e-mail/observação omitidos válidos, dado opcional inválido rejeitado e PATCH omitido preservado.
- [ ] Implementar cadastro/edição/busca, dedup assistida, carteira/responsável, origem, notas/histórico e captura pública antispam com submission ID. Reutilizar contato único com papéis cliente/fornecedor, PF/PJ e campos sob demanda; fornecedor não se torna beneficiário de pagamento. Validar ausência de vazamento de custos, dívidas e dados da equipe pela busca de contatos.
- [ ] Aceitar aniversário opcional no contato e consultar aniversariantes no escopo; dia/mês juntos, ano opcional, calendário/fuso corretos e sem inferência dos CSVs. Nada é enviado por salvar o campo. Aceite LOJ-42/43, sem depender de T12.
- [ ] Implementar Kanban/lista, etapas gerenciáveis, filtros, atividades humanas, perda/reabertura e atualização concorrente por versão.
- [ ] Persistir posição dos cards/cards_version e reordenação atômica de colunas; testar mouse/toque/teclado/menu, filtros/paginação, permissão revogada, resposta perdida e duas abas sem sobrescrita. Preencher proposta a partir do card com os mesmos IDs, conforme contratos.
- [ ] Executar unitário, `tests/integration/lead-idempotency.test.ts` com três reenvios e `tests/e2e/crm.spec.ts`: lead sem CPF → oportunidade → movimento sem gerar pagamento.

**Aceite:** CRM-01–06, LOJ-01–03/16/17/22–24. Valor potencial não vira faturamento; nenhum disparo/IA.

## T03 — Catálogo, fotos e estoque

**Dono/arquivos:** estoque; `src/modules/inventory/`, `src/web/inventory/`, `src/adapters/http/inventory.ts`, migrations estoque. **Depende:** T01.

- [ ] Em `tests/db/inventory.sql`, afirmar modelo+quantidade gera movimento/unidades internas; série nula inicial permitida, série preenchida duplicada negada; duas reservas deixam apenas uma ativa.
- [ ] Implementar modelo/nome/foto/quantidade, SKU automático, variações, marca/categoria/unidade/garantia/fornecedor/localização/estoque mínimo opcionais, upload/substituição, preço/custo por entrada autorizado e arquivamento preservando histórico.
- [ ] Implementar recebimento, reserva/liberação/vencimento, recontagem auditada e inspeção; contagem derivada sem PATCH de saldo. Custo desconhecido não é zero. Entrada física e obrigação compartilham referência/capitalização única. Compra vinculada ao fornecedor/obrigação não vira CMV antecipado; custo do catálogo não refaz custo de unidade ou venda histórica.
- [ ] Executar `npm run test:db` e `tests/e2e/inventory.spec.ts`: gestor cadastra foto/três bikes sem séries iniciais; vendedor consulta/reserva e não altera saldo/custo.

**Aceite:** EST-01–06, LOJ-04–06/18–21/25/26, SEG-02/16/19. SELLER não recebe custo nem escrita de estoque; OWNER administra.

## T04 — Proposta, pedido e entrega

**Dono/arquivos:** vendas; `src/modules/sales/`, `src/web/sales/`, rotas/migrations vendas. **Depende:** T02/T03.

**Execução em duas partes:** T04 entrega primeiro propostas, snapshots, contratos e reserva em grupo, permitindo T05 construir o núcleo financeiro. Confirmação real de pedido permanece indisponível até T04/T05 fornecerem juntas a RPC atômica de pedido+alocações+comissão do software. Preparar cálculos puros/schema mínimo de T05 antes desse commit, sem antecipar SDK/Asaas. Não persistir pedido confirmado incompleto nem concluir o aceite de entrega com fontes simuladas. ENT-01/LOJ-07 e a disputa com reversão/fiscal são aceites integrados depois de T05/T07/T08/T11 aplicáveis e antes de T14; dependência de construção não significa todos esses testes já passaram.

- [ ] Em `tests/unit/order-policy.test.ts`, provar preço/alçada do servidor, snapshots históricos e cobertura parcial sem entrega.
- [ ] Implementar validade/desconto, reserva, confirmação/alocações, cancelamento solicitado, troca e retorno físico separados das finanças.
- [ ] Implementar Registro de vendas/lista/detalhe sobre os mesmos pedidos, número/data/vendedora históricos, filtros/paginação/totais no escopo e status independentes; nenhum módulo paralelo. Confirmar condições comerciais locais não chama PSP ou confirma recebimento.
- [ ] Implementar entrega atômica com versão, unidade física/série aplicável, cobertura, risco e situação fiscal.
- [ ] Executar unitário, `tests/db/delivery-race.sql` e `tests/e2e/order.spec.ts`; pagamento após reserva vencida vira exceção e reversão concorrente não é sobrescrita.

**Aceite:** VEN-01–08, ENT-01, LOJ-07/08/53–55. **Produz:** pedido, alocações e vínculo de reserva para o financeiro.

## T05 — Dinheiro, comissão, recebíveis e livro

**Dono/arquivos:** núcleo financeiro; `src/modules/finance/money.ts`, `ledger.ts`, migrations financeiro/livro. **Depende:** T04/T01.

O cálculo puro pode começar após T01; a referência a T04 é sua base/schema de proposta/pedido, não o aceite final de entrega. Migrations compartilhadas e a confirmação atômica são implementadas em sequência com T04. Confirmar pedido nunca usa placeholder de comissão, recebível ou reserva para “completar depois”.

- [ ] Em `tests/unit/money.test.ts`, afirmar comissões `400000→6000`, `800000→12000`, `1500000→22500` centavos, rateio soma alvo e refund integral cumulativo zera comissão.
- [ ] Implementar valores inteiros/limites, regra versionada, rateio, recebíveis folha e fatos separados de confirmação/liquidação/split/refund.
- [ ] Em `tests/db/ledger.sql`, rejeitar journal desequilibrado/postado alterado, fato duplicado e refund acima do elegível; separar livros Ninebike/prestadora.
- [ ] Em `tests/db/order-confirmation.sql` e integração concorrente com sessões reais, falhar após pedido antes das alocações/comissão e provar rollback de proposta/reserva/pedido/recibo. Duas confirmações da mesma proposta com keys distintas deixam um pedido e um conjunto consistente de compromissos/alocações/comissão; nenhuma confirmação parcial.
- [ ] Executar unitário/banco real e provar que confirmação de cartão mais parcelas recebidas não duplicam obrigação/receita. Separar receita reconhecida, adiantamento e recebimento; software reconhece despesa/obrigação uma vez e split liquida a obrigação.

**Aceite:** FIN-01–04/12/16/22/33/34. **Produz:** cálculos e commits monetários, sem SDK no domínio.

## T06 — Inbox, operações e fila

**Dono/arquivos:** integrações; `src/modules/integrations/`, adaptador persistence e migrations inbox/operações/pgmq. **Depende:** T01.

- [ ] Em `tests/integration/operation-lifecycle.test.ts`, provar rollback dado+enqueue, dois consumidores, crash antes/depois de dispatch e resposta antiga sem sobrescrita.
- [ ] Implementar preparo/dispatch/finalização em RPC, fila logged, lease/geração, arquivo e `NEEDS_REVIEW`; sem retry cego de dinheiro ou `pop` destrutivo.
- [ ] Implementar consumidor bounded/Cron, timeouts/backoff e manutenção fora do banco; dedup de fato além de evento.
- [ ] Executar integração e `tests/db/operations.sql`; operação incerta não despacha segundo POST.

**Aceite:** FIN-05–15, SEG-10–12, OPS-01/02. **Produz:** protocolo externo compartilhado.

## T07 — Provedor de pagamentos, Pix, boleto e cartão — pendente

O provedor será escolhido depois da negociação. Caminhos/nomes de testes Asaas abaixo são a referência anterior; revisar contrato/API/dados e adaptar ao fornecedor efetivamente contratado antes de implementar. Não construir integração Asaas nem várias integrações por antecipação. Nenhum preço publicado ou meta comercial configura uma capacidade homologada.

**Dono/arquivos:** pagamentos; `src/adapters/providers/asaas.ts`, `src/modules/finance/payments.ts`, webhook Asaas e `src/web/payments/`. **Código depende:** T05/T06 e contrato oficial do percurso; **ativação depende:** evidências T00/conta/subconta/modalidade.

- [ ] Em `tests/integration/asaas-payments.test.ts`, provar Pix R$ 8.000 − tarifa R$ 1,99 − comissão R$ 120 = líquido R$ 7.878,01; redirect não confirma e parcela não repete comissão total.
- [ ] Implementar emissão pela subconta, capacidades/tarifas conhecidas, split fixo verificado antes de expor QR/link e correlação de checkout/cobranças/parcelas.
- [ ] Implementar webhook token/200 após commit, consulta/evidência e máquina de estados; atualização/restauração não remove split silenciosamente.
- [ ] Executar integração/sandbox e guardar cobrança/split nos dois titulares. Parcelamento hospedado só habilita após prova do rateio total correto no contrato específico.

**Aceite:** FIN-17–21/34/35, SEG-09/12, PIX-01–03. Pix está na entrega principal; tarifa fixa é despesa separada.

## T08 — Refund, chargeback e MED

**Dono/arquivos:** financeiro; `src/modules/finance/refunds.ts`, `disputes.ts`, rotas/telas e adaptador Asaas. **Depende:** T07/T05/T06.

- [ ] Em `tests/integration/refunds.test.ts`, provar parciais concorrentes dentro do elegível, resposta perdida sem novo refund e taxa não restituída preservada.
- [ ] Implementar solicitação/aprovação/reserva/execução e reversão de comissão prevista distinta da efetivamente realizada; tratar saldo insuficiente.
- [ ] Processar disputa/MED/bloqueio inclusive sem pedido, sem segunda devolução automática após chargeback/refund.
- [ ] Executar integração/banco e homologar modalidades disponíveis, registrando limitações do sandbox e responsáveis por perdas.

**Aceite:** FIN-22–26, SEG-05/06, LOJ-06/11. Refund não recoloca bike no estoque.

## T09 — Saque PJ e aprovações

**Dono/arquivos:** financeiro/identity; `transfers.ts`, `approvals.ts`, callback síncrono separado, migrations de vínculo/aprovação e telas. **Depende:** T07/T05/T06/T01.

- [ ] Em `tests/integration/transfer-approval.test.ts`, provar vendedor negado, mudança payload/beneficiário/custo invalidando aprovação e dois IDs remotos sem reutilizar autorização.
- [ ] Implementar beneficiário PJ versionado, quote local por tabela/contrato com evidência, MFA recente, reserva do débito total e execução pelo proprietário.
- [ ] Revalidar custo antes do despacho; diferença constatada depois é incidente, sem garantia fictícia de tarifa congelada. Callback só aprova ID inequivocamente vinculado.
- [ ] Executar integração/banco e homologar pendência/bloqueio/falha/conclusão/timeout sem segundo saque; movimentos externos entram na conciliação.

**Aceite:** FIN-27–30/36, SEG-13/14/18, PIX-04. Suporte não move saldo.

## T10 — Conciliação, despesas e relatórios

**Dono/arquivos:** financeiro/leitura; `src/modules/integrations/reconciliation.ts`, `src/modules/finance/reports.ts`, `payables.ts` e telas/consultas. **Código depende:** T05/T06; **integração oficial/habilitação:** T07/T00. Gastos/estrutura de relatórios podem ser construídos antes de ativar Asaas.

- [ ] Em `tests/integration/reconciliation.test.ts`, provar paginação incompleta sem fechamento, diferença de um centavo visível e split/saque sem aumento de faturamento.
- [ ] Implementar extrato/recursos com cursor, sobreposição/dedup, snapshots/issues e recuperação de fatos com evidência histórica.
- [ ] Implementar gastos/AP, categorias com classificação de resultado e caixa, competência/vencimento, contas gerenciais e baixas parciais comprovadas/reversíveis. Requests criam aprovação antes da execução; lock/version impede sobrequitação. Retorno real separado de reversão de baixa reduz fonte reutilizável. Nenhuma baixa administrativa confirma venda Asaas ou altera seu saldo oficial.
- [ ] Implementar relatórios de caixa, gastos por categoria, AP/AR, DRE gerencial e custo histórico/CMV, com impostos/despesas/custos ausentes visíveis como parcial. Aporte, distribuição e transferência própria separados; pagamento não repete despesa. Cada total abre seus fatos.
- [ ] Implementar saldos de abertura com data de corte/proveniência, fechamento mensal versionado, correção/fato tardio sem reescrever período publicado. Atualização após commit, canal autorizado sem valores sensíveis, reconsulta na reconexão e fallback; mostrar fontes, versão, atualizado em e conciliado até.
- [ ] Executar integração e `tests/e2e/finance-report.spec.ts`; exportação respeita grants e prestadora vê somente suas comissões permitidas.

**Aceite:** FIN-31–43/49–52, indicadores do spec, LOJ-08, SEG-17/20/21, OPS-11. Nenhuma diferença vira receita fictícia.

## T11 — Fiscal humano e pacote mensal

**Dono/arquivos:** fiscal; `src/modules/fiscal/`, adaptador fiscal, telas, RPCs/migrations e exportação privada. **Código depende:** T04/T06/T01; **ativação:** gates fiscais T00. Regras em [fiscal.md](fiscal.md).

- [ ] Construir direção OS_PRIMARY por provedor homologado, unificando preparo do Olist e conferência/gestão fiscal mostrada no SHOP Simples, sem clonar menus. Validar arquivo/layout da passagem pré-emissão confirmada, um único emissor ativo, capacidades por ato/modelo/ambiente, titularidade/numeração/perfil/certificado e critério mensal. Não inventar adaptador Alterdata; início permanece suspenso até nova orientação.
- [ ] Implementar rascunho progressivo, validação sem efeito, prévia/revisão por snapshot, solicitação/aprovação e clique de envio humano. Aprovar não enfileira transmissão; Cron/webhook/fila fiscal só consultam/reconciliam. Mudança relevante invalida aprovação.
- [ ] Provar em `tests/integration/fiscal-human-gate.test.ts` que pagamento/estoque/entrega/fechamento/restore não emitem nota, que duas abas não duplicam, e que envio incerto só consulta a mesma referência. Nenhum envio em finally/reconexão/retomada automática.
- [ ] Implementar eventos cancelamento/CC-e/inutilização e contingência somente quando suportados, com revisão/aprovação/clique próprios. Provar elegibilidade/numeração, resultado individual e financeiro/estoque independentes; impressão/download não alteram estado oficial.
- [ ] Guardar/verificar XMLs, protocolos e eventos distintos de DANFE/prévia. Upload/pré-análise em quarentena não cadastram nem lançam; preview compara dados/itens/vínculos. OWNER aprova snapshot e confirma incorporação; alteração invalida aprovação. Distinguir dados pré-emissão de evidência já autorizada, bloquear origem incerta, resultados parciais explícitos e idempotência por item. Efeitos em contas/estoque usam comandos próprios já existentes, sem repetição.
- [ ] Materializar o mapa tela→snapshot→contrato/XML→DANFE por campo, com origem, obrigatoriedade, escala, transformação e ordem de itens. Validar sequência/cardinalidade do XML pelo XSD homologado e conferir visualmente o documento final com o mesmo exemplo aprovado; agrupamento de tela não prova layout fiscal.
- [ ] Implementar pedido humano de pacote mensal com período explícito, todas as páginas, eventos de nota antiga, manifesto/hash/contagem/pendências e revisão/download privado. Conhecer o nome SHOP Simples não comprova layout, envio ou escrituração; não transmitir para destino externo sem confirmação própria.
- [ ] Homologar por ato e ensaiar segurança A1, papéis/exports, artefato ausente, pacote parcial, rejeição e restore sem retransmissão; registrar evidência e limitações reais.

**Aceite:** FIS-01–30, LOJ-09–11 e gates pertinentes. Implementação e homologação do provedor/perfil continuam pendentes; XML/payload/backend finais não foram verificados na inspeção. Isso é gate de transmissão fiscal, não de início do produto. Nenhuma transmissão real é autorizada por esta lista.

## T12 — Etapa final: campanhas, composição IA e aniversário diário automático

**Adiada até núcleo T14 aceito.** SELLER no escopo autorizado e OWNER loja. Arquivos futuros: comunicação outbound, diretório comercial do canal, adaptador de geração de texto e transporte, telas de campanhas/regras e migrations pertinentes. Reutilizar operações/fila/Cron/RPC/arquivos atuais; não implementar inbox/handoff/agente, credencial n8n ou alterar IA/workflow/sessão/callback existentes.

- [ ] Implementar seleção CRM/base comercial WhatsApp/mista com referências resolvidas no servidor, paginação/estado da fonte e sem criar leads ou consentimento por importação. Nome/telefone desconhecidos não são inventados, dados comerciais respeitam escopo atual.
- [ ] Composição IA opcional por destinatário usa contexto mínimo nome/observação comercial autorizado e receita configurada; sem ferramentas ou dados financeiros/fiscais/sensíveis. Testar prompt injection, fallback BASE/SKIP, hash/revisão/generation state e resultado antigo, sem substituir texto já aprovado.
- [ ] Implementar campanha simples, faixa aleatória min/max persistida, gate de despacho e limite imutável70/dia São Paulo compartilhado entre todos. Concorrência pelo 70º/71º, virada de dia, nova key/campanha/binding e incerteza não contornam quota; sem sleep ou retry cego. Max da faixa não vira SLA de entrega.
- [ ] Implementar birthday_rule/run e switch diário por carteira SELLER, geral/master OWNER, hierarquia e revalidação do responsável. Ativação autoriza diariamente, sem clique por pessoa; desligamento impede jobs não despachados, sem apagar enviado/incerto. Data29/02, escopo, opt-out e limite anual/diário explícitos.
- [ ] Ensaiar transporte/status/base de contatos/opt-out/geração em ambiente de teste com versão real, permissões/adaptação mínima e sem capturar o callback da IA atual. Sem promessa de 70incluindo o tráfego independente n8n. Piloto real só mediante autorização específica de canal/público/conteúdo.
- [ ] Demonstrar restauração bloqueando saída até reconstruir quota/ocorrências; gerais sem vaga podem continuar no próximo dia aceito, aniversário vencido expira com motivo. Casos críticos em banco real e E2E da UX simples nos dois temas, sem PII em CI.

**Aceite futuro:** LOJ-12–14/34–40/42–52, SEG-22–25, OPS-13. Campo/lista de aniversário T02 não depende de T12. Nenhuma mensagem ou chamada IA real foi executada por esta revisão documental.

## T13 — Operação e restore

**Dono/arquivos:** operações/importação; `docs/operations/{incidents,restore,reconciliation}.md`, `src/modules/integrations/data-imports.ts`, UI administrativa/migrations de importação, configuração Worker/Supabase/R2 e backup. **Depende:** T01 e capacidades da liberação para backup/restore e corte do núcleo; T08–T10 para aceite com efeitos financeiros, T11 para fiscal e T12 somente na etapa final. Backup/restore de CRM/estoque é gate anterior ao seu piloto, sem aguardar PSP. Preparação dos CSVs e código do importador de contatos/catálogo podem começar após T01–T03.

- [ ] Implementar alertas de fila/consumidor/incerteza/divergência/chave/certificado/backup e responsáveis com runbooks.
- [ ] Configurar PITR/backup contratado e cópia independente de objetos/XMLs com hashes/retenção e acesso de recuperação separado.
- [ ] Antes de qualquer produção do núcleo, ensaiar restore isolado de dados, Auth/grants e objetos privados do recorte. Quando houver efeitos externos habilitados, incluir saque já concluído no provedor: bloqueio fora do banco impede replay até reconciliar.
- [ ] Registrar perda/tempo observados, objetos/grants/Auth recuperados e rollback compatível com schema.
- [ ] Preparar roteiro de migração por origem/corte e executar dry-run isolado com extratos/arquivos autorizados, chaves estáveis/dedup e relatório de faltantes. Conferir abertura de contatos/fornecedores, produtos/unidades/custos, pedidos/AP/AR/comissões e saldos; preservar identidades fiscais para não reemitir histórico. Migração não confirma pagamentos nem dispara efeitos externos.
- [ ] Implementar lotes/linhas/source_links privados, prévia hash/versionada, validação, resolução de exceções e apply retomável conforme dados/API. Cobrir LOJ-28–33 com fixtures sintéticas que reproduzem apóstrofo/zeros/telefone ausente/SKU repetido/atributos/pais/variações sem vínculo. Nenhum CSV real entra em Git, preview ou CI; importação real só no ambiente e corte autorizados.

**Aceite:** OPS-03–10/12, LOJ-15/28–33; backup habilitado não substitui restore demonstrado, e cadastro importado não prova abertura de estoque/financeiro.

## T14 — Piloto e lançamento

**Gate transversal:** seguir a cadeia local → PR → staging → homologação → piloto de [plan.md](plan.md), com commit/schema/cenário/esperado/observado/evidência. Aceites de integração pendentes de T04 são retomados com as fontes efetivas; CI não usa credenciais ou cadastros de produção. Falha material bloqueia a capacidade afetada, sem declarar testes simulados como homologação.

**Dono:** Ninebike + prestadora + engenharia. **Arquivos:** `docs/operations/pilot-evidence.md`, checklist de release. **Depende:** tarefas da liberação escolhida e gates pertinentes; T16 quando comissões forem liberadas. T11 exige percurso humano homologado antes da liberação fiscal; integração do destino continua pendente, sem declarar fiscal resolvido.

- [ ] Para piloto parcial, declarar o recorte/capacidades: identidade/CRM/estoque/propostas/registro de vendas conforme tarefas concluídas, dados de abertura conferidos, backup/restore e uma autoridade de escrita por cadastro/estoque. Funcionalidades dependentes ausentes ficam indisponíveis. Quando liberar a operação financeira/fiscal completa, executar lead → oportunidade → modelo/estoque → proposta/pedido → meio homologado → split → fiscal humano → entrega → saque em ambiente/piloto autorizados.
- [ ] Conferir permissões, dados e persistência do recorte. Quando houver financeiro externo, conferir valores/IDs/tarifas/estados nas contas e demonstrar devolução controlada; estoque físico e percurso fiscal somente quando incluídos na liberação. Para financeiro/equipe, importar abertura com corte e conferir AP/AR/custos/obrigações sem duplicar passado.
- [ ] Resolver divergências críticas, treinar usuários, registrar aceite e liberar somente capacidades homologadas.
- [ ] Aprovar corte e abertura conciliada, declarar uma autoridade de escrita para estoque/cobrança/fiscal e encerrar operação duplicada da mesma venda no Olist. Cobranças/notas antigas seguem transição/reconciliação explícitas sem recriação. Fazer backup final, aplicar migração revisada, verificar contas/grants/fontes e entregar runbooks/responsáveis/monitoramento. Em falha, congelar/reconciliar antes de rollback compatível; nenhum rollback apaga efeito remoto.

**Aceite:** condições de primeira produção em acceptance; implementado não significa homologado.

## T15 — Koin condicionada

**Dono/arquivos:** crédito; jornada em `src/web/payments/`, regras no financeiro e adaptador Koin somente se produto/API compatível contratado. **Depende:** T00/T07/T08 + KOIN-01–07.

- [ ] Obter prova do QR dinâmico específico, originador, valor, split, elegibilidade/faixa comercial e devolução coordenada do crédito total/parcial.
- [ ] Implementar somente estados observáveis; sem API do App, informar forma escolhida e acompanhar Pix Asaas, sem inventar aprovação/parcelas/dívida.
- [ ] Demonstrar recusa/abandono/entrada/limite insuficiente/QR vencido e refund/crédito antes de ativar; payout por chave sozinho não atende.

**Aceite:** tarifa fixa Pix aceita; nenhuma liquidação/split simulado. Sem homologação, manter modalidade indisponível com motivo.

## T16 — Comissões da equipe

**Dono/arquivos:** financeiro/identity; `src/modules/finance/staff-commissions.ts`, telas de regras/extrato e migrations vinculadas a payables. **Código depende:** T04/T05/T10; **cálculo/liberação:** política T00 aprovada/ensaiada. Sem política, construir rascunhos/estrutura/extrato não configurado, sem valor presumido. Não depende de Koin nem cria split para funcionário.

- [ ] Definir regra aprovada versionada: beneficiário/atribuição, base, modalidade/taxa ou valor, vigência, reconhecimento, liberação, vencimento e reversão. Não presumir 1,5%, base bruta ou gatilho por recebimento sem decisão.
- [ ] Congelar regra/funcionário/base/valor por venda e separar previsto, reconhecido, liberado, a pagar, vencido, parcialmente pago e pago. Desligamento/mudança CRM não reescrevem histórico.
- [ ] Reutilizar obrigação/baixas parciais/livro; liberar/pagar não reconhece despesa de novo. Ajustes referenciam a comissão original, exigem motivo/autor e não apagam pagamentos ou geram descontos presumidos.
- [ ] Provar cálculo/rateio/reversão conforme regra configurada, duplicatas, duas quitações concorrentes, devolução após pagamento e extrato anterior + movimento − pagamentos = saldo. Vendedor só vê sua comissão mediante grant explícito; sem margem ou comissão alheia.

**Aceite:** FIN-44–48, SEG-20, FIN-40/41/49/50. Percentual/base ainda pendentes: estrutura pode ser construída, cálculo/liberação ficam indisponíveis até configuração aprovada e ensaiada.

## Cobertura consolidada

| Requisito | Tarefas | Aceite |
| --- | --- | --- |
| Contatos/fornecedores/CRM/pipeline/aniversário | T02 | CON-01–03, CRM-01–06; LOJ-01–03/23/24/42/43 |
| Catálogo/foto/quantidade/custo/reserva | T03/T04 | EST-01–09; LOJ-04–08/25/26 |
| Propostas/vendas/entrega/devolução | T04/T11 | VEN-01–05, ENT-01; LOJ-05–11 |
| Software/caixa/livro/relatórios/gastos | T05/T07–T10 | GER-01–08, MET-01–07; FIN-01–43/49–52 |
| Comissão da equipe independente | T16/T10 | COM-E01–05; FIN-44–48; SEG-20 |
| Segurança e autorizações | T01/T03/T06/T08/T09/T16 | SEG-01–21 |
| Fila/reconciliação/restore/atualização | T06/T10/T13 | OPS-01–11 |
| Pix/Koin | T07/T15 | PIX-01–04; KOIN-01–07 |
| Fiscal humano/exportação mensal | T11 | FIS-01–30; LOJ-09–11 e gates aplicáveis |
| Disparos finais | T12 | T12 final; campanhas sem inbox/IA |

Multiempresa, crédito próprio, IA, disparos/campanhas e pagamento automático de fornecedores estão fora da entrega. Não estimar prazo/custo fictícios antes das condições externas. Homologação, UF/regime, alçadas/prazos comerciais, responsáveis e orçamento de recuperação são configurações/condições de implantação explícitas.
