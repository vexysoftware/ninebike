# NINEBIKE OS — guia de validação e operação inicial

**Atualização v2.10.0 — 26/10/2026:** implementação suspensa por pedido do responsável; provedor financeiro em revisão (recebimento integral D+1, condições comerciais em revisão privada). O fiscal reúne Olist e SHOP Simples com aprovação/confirmação humanas; o responsável confirmou que os dados saem pendentes do Olist e são aprovados/emitidos no SHOP; arquivo/layout e homologação ainda precisam de validação. As referências financeiras anteriores não representam fornecedor atualmente escolhido. Ver [decisões atuais](../../README.md) e [fluxo fiscal](fiscal.md).

Atualizado em 26/10/2026. Este é o roteiro a executar quando houver aplicativo. Nenhum comando representa teste já realizado nesta entrega documental. Regras: [spec](spec.md), [arquitetura](architecture.md), [plano](plan.md), [tarefas](tasks.md), [dados](data-model.md), [API](contracts/api.md), [aceite](acceptance.md).

Ler primeiro [build-guide.md](build-guide.md) para a sequência de construção/lançamento e [design.md](design.md) para o acabamento das telas. Este guia executa as jornadas do produto já implementado; os comandos abaixo não são scripts disponíveis no portal de planejamento.

## 1. Preparação da implementação

1. Selecionar o repositório real e conferir instruções/código antes de criar arquivos. Este pacote contém planejamento; não possui package.json ou banco do produto.
2. Em T01, fixar runtime/dependências e scripts npm, Workers config e migrations; ambientes local/staging/produção separados. Lockfile determina versões, sem instalações globais ou CLIs de IA adicionais.
3. Em T01, configurar somente Auth, banco e runtime necessários ao recorte, com secrets de servidor no ambiente correto. Browser recebe somente configuração publicável de Auth. Credenciais do PSP escolhido, webhook, fiscal e canal entram apenas na tarefa/capacidade dependente; não exigir Asaas, fiscal ou Meta para iniciar a fundação. Secrets de produção não entram em teste/preview.
4. Preparar pessoas/produtos fictícios, sem copiar dados pessoais de produção. Configurar RPCs/grants conforme o módulo; fila pgmq logged entra em T06 e não bloqueia a identidade/CRM por ainda não estar habilitada.
5. Cadastrar contas individuais de teste nos dois papéis humanos OWNER e SELLER; validar vínculo ativo e permissões. Financeiro sensível é atribuição OWNER, sem criar terceiro papel ou compartilhar login. Ativar MFA TOTP para os atos sensíveis exigidos.

Scripts de T01: `npm ci`, `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm run test:db`, `npm run test:e2e`. Dev/preview publicados usam runtime Workers. Comandos e credenciais exatos do banco dependem do repositório/ambiente configurados; não executar contra produção por padrão.

## 2. Jornada comercial básica

| Passo | Ação no sistema | Resultado exigido |
| --- | --- | --- |
| A | OWNER cadastra modelo “Bike Teste”, foto e quantidade 3 | Modelo aparece com imagem e três unidades internas; entrada com autor/data; sem exigir três chassis no primeiro formulário. |
| B | SELLER cadastra “Cliente Teste” e celular válido, omitindo CPF/e-mail/observação | Lead criado com dois campos; oportunidade em Novo; opcionais permanecem nulos. |
| C | Registrar observação, atribuir vendedor e mover para Contato/Proposta | Histórico e próxima ação humana preservados; nenhum pagamento criado. |
| D | Gerar proposta de R$ 8.000 e reservar uma bike | Disponível 2, reservada 1; total físico continua 3; duas reservas simultâneas da mesma unidade não confirmam. |
| E | Confirmar pedido pelo commit conjunto T04/T05 | Um pedido com snapshots, alocações e obrigações completos; registrar a venda não confirma recebimento, não emite nota nem libera entrega. |
| F | Somente com PSP/meio habilitados, criar cobrança Pix homologada e confirmar recebimento/split em sandbox | Uma intenção/cobrança; split de R$ 120 verificado no percurso contratado antes de exibir QR. Pagamento e comissão em estados próprios; cada fato contado uma vez. |
| G | Completar dados exigidos pela cobrança/fiscal e identidade física aplicável | Cadastro simples do lead não é retroativamente tratado como inválido; dados adicionais pedidos com motivo nessa etapa. |
| H | Com fiscal habilitado, revisar/aprovar e clicar enviar pelo humano; depois entregar conforme política | Protocolo oficial separado da aprovação; uma saída/entrega e unidade correta, sem lançamento fiscal automático ou estoque duplicado. Sem fontes financeiras/fiscais exigidas, entrega permanece bloqueada. |
| I | Com PSP habilitado, conciliar e consultar relatório | Venda R$ 8.000, comissão R$ 120 e tarifa realizada separados; exemplo fictício com R$ 1,99 deixa R$ 7.878,01, sem presumir condição contratada. |

Nome/modelo/telefone acima são fixtures de teste. Um status retornado do navegador ou comprovante falso nunca conclui F/H. O requisito de dado do provedor precisa ser atendido antes da operação que o exige, mesmo que o cadastro comercial já exista.

**Piloto parcial:** executar somente os passos do recorte liberado, conforme T14 e [build-guide.md](build-guide.md), seção 12. Identidade/CRM não dependem de PSP; estoque/propostas exigem abertura e corte conferidos; pedido confirmado exige T04/T05 completos. Uso real requer aceite da Ninebike, pessoas autorizadas, dados reconciliados, backup/restore e uma única autoridade de escrita por cadastro/estoque/operação. F/H/I não são gates de um piloto exclusivamente CRM, mas continuam obrigatórios antes de habilitar as capacidades correspondentes. Não substituir pagamento/fiscal indisponíveis por simulação em produção.

## 3. Jornada financeira e reversões

**Ensaio gerencial com dados fictícios:** cadastrar fornecedor e conta bancária gerencial, registrar entrada de bike com custo conhecido e obrigação. Reconhecer despesa de aluguel em sua competência e pagar em duas baixas; não lançar a despesa novamente. Comparar caixa, estoque e CMV no período da compra e da venda. Saldo bancário externo continua limitado à evidência cadastrada/importada.

**Ensaio de equipe:** somente após configurar regra aprovada, congelar funcionário/regra/base na venda e verificar previsto, reconhecido, liberado e pago separadamente. Quitar parcialmente com comprovante externo sem saída automática no PSP. Testar devolução após pagamento, extrato mensal, bloqueio de comissão alheia e versão do período fechado. Não usar os 1,5% do software como regra da equipe.

**Corte de entrada:** cadastrar abertura por conta/AP/AR/comissões com origem/data de corte aprovadas; reconciliar primeiro período. Não importar abertura como venda ou despesa nova. Se faltar custo, despesa, tributo ou fonte, relatório mostra parcial e os dados pendentes.


**Integração financeira — antes de habilitar o PSP contratado:** executar os casos abaixo no ambiente homologado da capacidade; não exigem movimentar conta para liberar o CRM.

1. Repetir comando de cobrança com mesma key, key diferente sobre mesma intenção, webhooks repetidos e ordem invertida; observar uma cobrança/fato/effect local por obrigação.
2. Simular aceitação do PSP escolhido seguida de resposta perdida; operação vira UNCERTAIN. Consultar/reconciliar sem segundo POST financeiro.
3. Refund parcial de R$ 2.000 na base R$ 8.000: comissão econômica remanescente R$ 90; reversão efetiva só após evidência do provedor. Repetir parciais até integral e verificar zero de comissão remanescente.
4. Devolução de dinheiro não disponibiliza bike entregue. Receber fisicamente, inspecionar e registrar movimento de retorno antes de voltar a disponível.
5. OWNER prepara saque para PJ Ninebike e vê beneficiário/valor/débito total real, faz MFA recente e aprova. Vendedor e suporte são negados inclusive por chamada HTTP direta.
6. Reenviar callback do mesmo ID retorna mesma decisão; outro ID não reutiliza aprovação. Saque pendente não aparece como concluído, timeout não gera novo saque.
7. Tarifa é quote local baseada em condição conhecida; diferença antes de despachar exige reaprovação. Mudança constatada após envio gera divergência/alerta, pois o OS não garante congelamento remoto do provedor.

Só executar testes reais com autorização específica dos titulares e condições do provedor. Este roteiro não concede autorização para movimentar contas.

## 4. Segurança, fiscal e atendimento

- Tentar API/tabela com anon, token inválido, funcionário desligado e vendedor sem grants; observar negação sem mutação. Alterar conta, preço, comissão ou beneficiário no body não concede poder.
- Na capacidade integrada correspondente, alterar payload de webhook/token e conferir rejeição; derrubar banco antes de persistir e verificar que não houve sucesso HTTP 200 de recebimento.
- Testar custo/CPF/e-mail ausentes, CPF/e-mail inválidos fornecidos e telefone compartilhado; sem mesclagem automática indevida ou margem inventada.
- Fiscal em homologação conforme [fiscal.md](fiscal.md): preparar/validar/revisar, aprovar sem transmitir e conferir ausência de envio; clicar enviar explicitamente, simular rejeição/timeout e apenas consultar referência existente. Cancelamento/CC-e/inutilização exigem atos humanos próprios. Nenhum ensaio real está autorizado por este roteiro.
- Solicitar pacote mensal fictício, conferir período/manifesto/eventos/pendências, revisar e baixar. Não importar/enviar/escriturar no outro software até o responsável apresentá-lo e a rotina ser definida.
- Na etapa final, repetir status de disparo e adulterar autenticação; provar dedup/negação e regra do canal, preservando atendimento/IA n8n externos.
- Conferir teclado, foco, rótulos, mensagens de erro, foto/imagem padrão e telas pequenas nas jornadas principais. Loading/pending não pode habilitar clique financeiro que repete a intenção.

## 5. Recuperação e operação contínua

**Fechamento mensal gerencial:** revisar completude de custos, despesas, impostos informados, AP/AR, comissões e fontes; publicar versão aprovada. Evento tardio/correção preserva versão anterior, com ajuste ou revisão explícitos. Tela mostra atualizado em, conciliado até e fontes cobertas; reconexão refaz consulta e atraso não vira falso tempo real.

**Fechamento diário financeiro:** com a fonte/PSP habilitados, importar todas as páginas do extrato, comparar cobranças/splits/refunds/saques e saldo, guardar janela/IDs e listar divergências com responsável. Não zerar diferença por lançamento de receita. Conciliação parcial aparece incompleta; CRM isolado não apresenta esse saldo como disponível.

**Incidente:** registrar operação e evidência, parar apenas ações afetadas ou todas as saídas quando houver risco de integridade, consultar provedor e restaurar após causa resolvida. Não pedir que usuário clique novamente em transferência incerta.

**Restore:** provar recuperação isolada de banco, Auth/grants e objetos do recorte antes do uso real, inclusive no piloto de CRM/estoque. Quando houver efeitos externos, bloqueá-los por controle fora do banco, preservar operações em voo, reconciliar a janela externa e reabrir gradualmente. Antes de habilitar financeiro, o ensaio deve conter uma transferência já concluída no provedor que reaparece pendente no banco restaurado; provar que não será reenviada. Aplicar a mesma proteção a ato fiscal quando essa capacidade for liberada.

**Operação da loja:** entradas/recontagens por autorizados; vendedor reserva, não corrige saldo. Funcionário desligado tem vínculo revogado. Beneficiário/credencial/contrato têm mudança controlada. Arquivos e exportações são privados e auditados.

## 6. Evidência de encerramento por etapa

Registrar versão código/schema, ambiente, cenário, IDs internos/externos sanitizados, valores esperados/observados, resultado e responsável. Artefatos de execução ficam em `docs/operations/` do aplicativo; nenhum token ou payload pessoal desnecessário.

Cada release é liberável quando os gates do recorte e seus cenários críticos têm evidência, o responsável aceita dados/corte/backup e há uma única autoridade de escrita por operação. Contador, contas e provedores precisam estar habilitados antes das ações que deles dependem; não são pré-requisito do CRM isolado. PSP, taxa e split seguem pendentes de contratação/homologação; cobrança, Pix, saque e conciliação oficial não entram no piloto por haver telas ou testes sintéticos. Antes de habilitá-los, exigir os percursos integrados aplicáveis e nenhuma divergência monetária crítica sem explicação. Koin continua indisponível até comprovar seu percurso completo e devolução do crédito. Não transformar um teste de aritmética em certificado de integração.

## 10. Perfis, aniversariantes e comunicação final v2.8

SELLER/OWNER continuam com contas individuais, teto de grants e financeiro/fiscal sensível somente donos. T02: lead sem aniversário é válido; dia/mês/ano opcional e lista do dia/mês/intervalo com escopo e sem idade inventada. Não enviar por salvar campo e não inferir do CPF/CSV/baseWhatsApp.

T12: SELLER monta público autorizado de CRM/base comercial conectada sem criar leads; IA opcional usa nome/observações permitidos, não fatos/destino inventados. Inspecionar preview individual/fallback sem exigir editar todas as mensagens. Intervalo aleatório é configuração única da campanha, sorteado/persistido sem sleep. Dois vendedores/rotinas concorrentes disputam70º/71º no mesmo orçamento diário; não contornar com nova campanha ou conta.

Ativar aniversário uma vez agenda execuções diárias; regra de carteira pessoal precede geral, master OWNER pausa todos. Cron repetido, opt-out, responsável desativado, mudança de receita, dia29/02, janela perdida e restore mantêm as travas anuais/diárias. Incerto não pode ser reexecutado só porque o relógio virou. Excesso birthday expira; geral pode continuar em próximo dia aceito. Não tocar IA/workflow/sessão/callback n8n. Homologação/piloto reais só com autorização específica, nenhum envio foi feito pelo planejamento.
