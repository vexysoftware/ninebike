# NINEBIKE OS — riscos, aceite e homologação

**Atualização v2.10.0 — 26/10/2026:** implementação suspensa por pedido do responsável; provedor financeiro em revisão (recebimento integral D+1, condições comerciais em revisão privada). O fiscal reúne Olist e SHOP Simples com aprovação/confirmação humanas; o responsável confirmou que os dados saem pendentes do Olist e são aprovados/emitidos no SHOP; arquivo/layout e homologação ainda precisam de validação. As referências financeiras anteriores não representam fornecedor atualmente escolhido. Ver [decisões atuais](../../README.md) e [fluxo fiscal](fiscal.md).

Atualizado em 26/10/2026. Baseline v2.10.0: fiscal humano e pacote mensal adicionados aos contatos/fornecedores, gastos/resultado e comissões da equipe. Tarifa fixa Pix e CRM simples preservados. Todos os ensaios de software/pilotos abaixo estão **pendentes**. A pesquisa documental não equivale a execução desses testes. Documentos relacionados: [spec.md](spec.md), [architecture.md](architecture.md), [tasks.md](tasks.md).

## 1. Como comprovar funcionamento

Cada cenário deve produzir resultado observado, ambiente, versão de código/schema, IDs de operação/conta/evento, valores em centavos e evidência sanitizada. Não guardar credenciais, PAN/CVV ou documentos completos no relatório de testes.

Usar a menor verificação que demonstre o risco: regra monetária com teste unitário; concorrência/rollback com PostgreSQL real; contrato com simulador e sandbox; permissões pela API; jornada crítica por navegador; liquidação/tarifa/estorno por piloto autorizado quando sandbox não reproduzir o produto. Não exigir três camadas de teste para cada campo de formulário.

Não declarar produção pronta enquanto houver cenário crítico sem evidência ou divergência monetária sem explicação. Não há tolerância de centavos ocultos: arredondamento previsto deve estar explicado; diferença inesperada vira incidente.

## 2. Cenários de integridade financeira

| ID | Situação real | Resultado exigido | Evidência mínima |
| --- | --- | --- | --- |
| FIN-01 | Venda R$ 4 mil, R$ 8 mil e R$ 15 mil | Comissão R$ 60, R$ 120 e R$ 225, sobre bruto | Cálculo inteiro e payload fixo correspondente. |
| FIN-02 | Taxa Asaas varia ou há desconto comercial | Taxa não reduz base contratual; desconto altera base antes do snapshot | Pedido, regra e decomposição conciliados. |
| FIN-03 | Entrada + saldo com centavo residual | Soma da comissão de alocações é exatamente o alvo do pedido | Casos de centavos e invariantes. |
| FIN-04 | Cartão parcelado | Comissão total rateada; não repetida integralmente em cada parcela | Todas as cobranças/splits e soma exata. |
| FIN-05 | Vendedor clica duas vezes ou abre duas janelas | Uma intenção/cobrança para a mesma obrigação | Duas requisições concorrentes + IDs externos. |
| FIN-06 | Cliente muda idempotency key na repetição | Proteção da intenção comercial também impede duplicidade | Conflito ou retorno da operação vigente. |
| FIN-07 | Mesma key com valor/beneficiário diferente | Rejeição por conflito; nenhuma segunda operação | Hashes e ausência de efeito externo. |
| FIN-08 | Asaas aceita cobrança e resposta se perde | Estado incerto; recuperação por consulta, sem novo POST cego | Simulador aceita/perde resposta; contagem de chamadas. |
| FIN-09 | Crash antes/depois de dispatch_started | Antes pode retomar; depois consulta/reconcilia | Interrupção controlada nas duas posições. |
| FIN-10 | Dois Workers, lease vencido e resposta antiga | Sem novo envio automático de intenção incerta; resultado antigo não sobrescreve | Consumidores concorrentes e fence local. |
| FIN-11 | Webhook repetido 10 vezes | Um fato financeiro e um movimento por efeito | Inbox, fatos e livro consultados. |
| FIN-12 | Eventos diferentes repetem o mesmo recebimento | Nenhum crédito adicional | Dedup pelo fato/ID remoto, além do event ID. |
| FIN-13 | Recebido chega antes de confirmado | Sem regressão nem dupla receita | Ordem invertida + consulta de estado. |
| FIN-14 | Estorno/disputa chega depois de pago | Reversão legítima processada; histórico preservado | Máquina de estados e livro compensatório. |
| FIN-15 | Webhook chega antes da resposta que traz o ID remoto | Correlação segura ou revisão; dinheiro não descartado | Operação estável vinculada posteriormente. |
| FIN-16 | Confirmação de cartão + recebimento de parcelas | Uma venda; caixa acompanha parcelas | Relatório sem soma dupla da obrigação. |
| FIN-17 | Recebimento sem split liquidado | Pagamento e comissão em estados próprios | Sem comissão recebida fictícia. |
| FIN-18 | Split acima do líquido/antecipação externa | Divergência e prazo visíveis; nenhuma redução silenciosa | Evento/consulta e alerta responsável. |
| FIN-19 | Atualização envia split vazio ou cobrança é restaurada | Não expor cobrança sem split verificado | Teste negativo do adaptador e consulta final. |
| FIN-20 | Carteira/configuração errada | Emissão bloqueada; conta correta e carteira aprovada | Payload adulterado e permissão negada. |
| FIN-21 | Pagamento duplicado, excedente ou tentativa antiga paga | Todo valor registrado; excesso em revisão/devolução, sem segunda entrega | Extrato e obrigação de devolver. |
| FIN-22 | Reembolso parcial e diversos parciais | Soma não supera recebido; reversão comissão não supera original | Concorrência + arredondamento cumulativo. |
| FIN-23 | Refund aceito com resposta perdida | Sem segundo estorno automático | Consulta posterior e total efetivo. |
| FIN-24 | Taxas não devolvidas/saldo insuficiente | Solicitação em falha/pendência explícita; sem “estornado” falso | Resposta Asaas e saldo atualizado. |
| FIN-25 | Chargeback após entrega ou estorno já solicitado | Exposição registrada; não devolver duas vezes | Estado de disputa e vínculo dos ajustes. |
| FIN-26 | MED/bloqueio com ou sem paymentId | Retenção por conta sem inventar pedido; desbloqueio próprio | Payloads e saldo conciliados. |
| FIN-27 | Snapshot de saldo desatualizado | Sem autorização de saque baseada no cache | Timestamp/consulta e rejeição. |
| FIN-28 | Dois saques concorrentes ou saque externo | Reservas locais coerentes; provedor decide saldo final | Intenções, extrato e reconciliação. |
| FIN-29 | Saque criado/bloqueado/falhou/concluiu | Somente conclusão confirma transferência; falha conclusiva libera reserva | Eventos/consulta e livro por estado. |
| FIN-30 | Saque aceito com resposta perdida | Resultado incerto bloqueia nova tentativa | Nenhum débito adicional no simulador/sandbox. |
| FIN-31 | Extrato com várias páginas/tarifas e enum novo | Importação completa ou fechamento explicitamente incompleto | Cursores, IDs únicos e pendências. |
| FIN-32 | Diferença deliberada de um centavo | Divergência encontrada; sem lançamento de receita para “acertar” | Caso e responsável no painel. |
| FIN-33 | Comissão liquidada e saque posterior | Faturamento da loja não cresce com split ou saque | Comparação do relatório antes/depois. |
| FIN-34 | Pix R$ 8.000 com tarifa fixa R$ 1,99 | Comissão R$ 120; líquido Ninebike R$ 7.878,01; sem percentual Pix implícito | Payload, extrato e relatório; tarifa efetiva pode divergir da referência. |
| FIN-35 | Promoção Pix termina, tarifa muda ou taxa realizada diverge | Vigência/tarifa reais registradas; percentual/condição não aceita bloqueia novas emissões | Mudança de tabela e alerta sem apagar recebimento. |
| FIN-36 | Mudança de tarifa de saque detectada antes de dispatch, ou diferença descoberta somente após execução | Antes: reaprovar total e não enviar com custo alterado; depois: preservar débito efetivo, abrir divergência/alerta sem prometer congelamento remoto | Hash/revalidação antes do envio e caso de diferença constatada após execução. |
| FIN-37 | Recebimento antes da entrega; entrega antes de liquidação final | Adiantamento/caixa, recebível e receita reconhecida seguem fatos/datas distintos; receita e CMV uma vez | Linha do tempo e livro por competência/caixa. |
| FIN-38 | Compra de bike paga hoje, venda reconhecida depois | Entrada física e AP compartilham capitalização única; pagamento reduz caixa; CMV só com receita, sem deduzir compra e CMV juntos | Custo de entrada, obrigação, baixa e item vendido. |
| FIN-39 | Custo ou tributo/despesa ainda não informado | Resultado parcial com pendências e vendas afetadas; sem margem final agregada omitindo silenciosamente itens sem custo | Relatório e lista de completude. |
| FIN-40 | Despesa reconhecida e quitada em duas baixas | Despesa uma vez, saldo remanescente exato; reversão de baixa não credita banco; retorno real ligado à saída reduz fonte reutilizável | Obrigação e baixas com referências. |
| FIN-41 | Duas abas quitam o mesmo saldo; comando repetido | Locks/versão/idempotência impedem excesso ou duplicata, rollback integral | Concorrência em PostgreSQL real. |
| FIN-42 | Pagamento externo registrado administrativamente | Conta gerencial indicada e evidência; não reduz snapshot oficial Asaas nem confirma venda/split; matching posterior não duplica saída | Fonte, comprovante e conciliação. |
| FIN-43 | Asaas → banco próprio, aporte, distribuição e pró-labore | Transferência própria via trânsito e créditos comprovados, sem receita/despesa além da tarifa; aporte/distribuição fora do resultado, remuneração classificada | Journals e extratos por conta. |
| FIN-44 | Equipe sem regra; mudança de regra/responsável depois da venda | Não configurado sem cálculo inventado; nova vigência e vendedor CRM não mudam snapshots históricos; software segue 1,5% | Regra versionada e pedido. |
| FIN-45 | Comissão reconhecida antes de ser liberada | Obrigação/despesa reconhecida uma vez; pagamento bloqueado até gatilho aprovado; previsto não reconhecido fora do saldo devido | Fatos de reconhecimento/liberação. |
| FIN-46 | Comissão da equipe/software já reconhecida é paga parcialmente ou split liquidado | Baixa reduz obrigação sem gerar segunda despesa; funcionário sem split Asaas automático | Livro e vínculo obrigação→liquidação. |
| FIN-47 | Devolução parcial antes/depois de pagar equipe | Ajuste segundo política aprovada, referência original e saldo a resolver; não apaga pagamento nem desconta remuneração automaticamente | Reversão e decisão autorizada. |
| FIN-48 | Mesmo fato chega por webhook, consulta e extrato | Uma comissão/obrigação/despesa por efeito econômico; extrato anterior + reconhecido + ajustes − pagamentos fecha | Identidade do efeito e extrato mensal. |
| FIN-49 | Evento tardio ou correção em mês fechado | Período publicado preservado; ajuste/data original/nova versão aprovada ou período aberto conforme política | Fechamento e trilha de revisão. |
| FIN-50 | Fonte atrasada, conexão perdida ou reconciliação incompleta | Atualizado em e conciliado até distintos; erro/atraso visíveis, reconsulta recupera dados sem falso saldo em tempo real | Timestamp/fonte/versão e reconexão. |
| FIN-51 | Desconto já incluído no preço; taxa/tributo já classificado | Cada parcela deduzida uma vez; denominador de margem ≤0 mostra não aplicável; líquido Asaas não rotulado lucro | Fórmulas e relatório rastreável. |
| FIN-52 | Importação inicial encontra dívida/baixa anterior e evento posterior ao corte | Abertura aprovada com origem/data; sem recriar despesa, recebimento ou comissão histórica; divergência explícita | Lote de abertura e reconciliação na data de corte. |

## 3. Acesso, segurança e protocolo

| ID | Situação real | Resultado exigido | Evidência mínima |
| --- | --- | --- | --- |
| SEG-01 | Vendedor chama execução de saque/estorno ou alteração de beneficiário | Negação no servidor e ausência de operação financeira; solicitação comercial de devolução permitida não executa refund | Requisições HTTP diretas às rotas de execução e de solicitação. |
| SEG-02 | Vendedor altera valor/desconto/carteira/ator no payload | Cálculo/identidade do servidor prevalecem ou rejeição | Payload manipulado. |
| SEG-03 | Funcionário desligado conserva token válido | Comando negado por vínculo atual | Revogação de perfil e repetição. |
| SEG-04 | SELLER tenta herdar financeiro por grants, body ou JWT alterados | Negação pelo teto de perfil no servidor/commit, sem leitura ou escrita sensível | Matriz SELLER/OWNER e testes diretos de API. |
| SEG-05 | Aprovação antiga, payload mudado ou própria aprovação indevida | Aprovação invalidada/negada | Hash, versão e atores. |
| SEG-06 | Financeiro/proprietário em aal1 ou MFA sem desafio recente | Ato sensível bloqueado conforme política | Chamada API e ausência de envio. |
| SEG-07 | Browser/anon tenta tabela/RPC financeira | Sem acesso ou escrita direta | Teste dos grants/RLS. |
| SEG-08 | Service role passa por caminho errado | Autorização explícita impede comando indevido | Teste da camada backend privilegiada. |
| SEG-09 | Token webhook errado, API key usada como token ou corpo Meta adulterado | Origem rejeitada; sem efeito | Testes negativos de autenticidade. |
| SEG-10 | Banco falha durante persistência de webhook | Sem HTTP 200 de sucesso; provedor pode reenviar | Falha induzida + inbox ausente. |
| SEG-11 | Crash após commit inbox, antes do processamento | Reentrega não apaga job; processamento recuperável | Inbox pendente e consumidor retomado. |
| SEG-12 | Webhook novo/atrasado | Persistido e tratado/revisado sem regressão | Payload com campos/enums novos. |
| SEG-13 | Callback de autorização desconhecido ou indisponível | Recusa/falha fechada, alerta; sem aprovação por token apenas | Resposta síncrona e estado da operação. |
| SEG-14 | Cancelamento de split por callback sem evento | Consulta/reconciliação detecta motivo | Apenas se essa opção for ativada. |
| SEG-15 | Busca de secrets no bundle/logs/preview | Nenhuma credencial privada exposta | Artefato compilado e amostra de logs. |
| SEG-16 | URL privada expirada ou usuário de outra carteira | Documento negado | Testes de Storage e autorização. |
| SEG-17 | Suporte tenta mover saldo ou ver dados além do escopo | Negação e trilha | Perfil de suporte temporário. |
| SEG-18 | Dois IDs externos de saque com mesmos dados tentam consumir uma aprovação | Apenas um ID pode ser vinculado/aprovado; repetição do mesmo ID mantém decisão | Callbacks concorrentes e constraint de vínculo único. |
| SEG-19 | Usuário tem catalog.manage mas não inventory.manage e envia quantidade inicial maior que zero | Modelo sem entrada pode ser permitido; criar saldo é negado sem grant de estoque | POST inicial e PATCH de quantity negados sem mutação de saldo. |
| SEG-20 | Vendedor consulta custo, DRE, comissão alheia ou tenta alterar regra/baixa | Negação no servidor; próprio extrato só com grant explícito, inclusive exportação/canal de atualização | Requests diretos e canal autorizado. |
| SEG-21 | Cadastro de fornecedor/conta gerencial tenta habilitar saque a terceiro | Cadastro não concede beneficiário financeiro nem chamada bancária; primeira versão só saca para PJ Ninebike | Teste de grants e ausência de operação externa. |
| SEG-22 | SELLER tenta convite/troca de perfil/carteira/beneficiário, preparar saque/refund ou ato fiscal; OWNER tenta remover último dono | Negação no commit, sem autoelevação ou perda do último dono; OWNER sensível mantém MFA/intenção | HTTP/DB real, claims/grants adulterados e corrida de revogação. |
| SEG-23 | SELLER consulta pagamento, operação, busca, exportação, evento ou arquivo com tarifa/split/custo/margem/banco de outro escopo | DTO mínimo no servidor; campo restrito não chega ao browser/canal/Storage, telefone só no atendimento autorizado | Inspeção de respostas/eventos/exports/anexos e IDs diretos. |
| SEG-24 | Automação externa/tokens tentam usar rotas financeiras/fiscais ou antigas portas n8n/inbox | Sem provisionamento/rota de integração IA nem grants humanos; negação e nenhum efeito | Requests negativos, portas fora de escopo e auditoria; workflow atual inalterado. |
| SEG-25 | Observação CRM contém prompt/segredo/dado restrito ou seleção de outro escopo; IA tenta produzir desconto/fato falso | Contexto mínimo filtrado, observação como dado e modelo sem ferramentas; saída bloqueada/base autorizada, sem vazamento, destino inventado, acesso financeiro/fiscal ou texto antigo aprovado sobrescrito | Fixtures sintéticas, requisições diretas e validação de contexto/resultado. |

Não afirmar que o perfil de aplicação impede abuso de administrador de infraestrutura. Acesso privilegiado, mudanças de código e recuperação também precisam de trilha e responsáveis.

## 4. Loja, atendimento e fiscal

Revisão fiscal reaberta com aprovação humana final; LOJ-09–11 e FIS-01–30 são exigências de implementação. Emissor/provedor e integração do destino ainda precisam de confirmação.

| ID | Situação real | Resultado exigido |
| --- | --- | --- |
| LOJ-01 | Formulário reenviado 3 vezes | Uma submissão; histórico preservado e sem oportunidades duplicadas pela mesma submissão. |
| LOJ-02 | Dois contatos parecidos/telefone compartilhado | Não mesclar identidades automaticamente sem critério seguro. |
| LOJ-03 | Kanban movido para ganho | Nenhuma baixa financeira/estoque sem pedido e evidência apropriados. |
| LOJ-04 | Dois vendedores reservam a mesma série ou último acessório | Apenas uma reserva válida; sem quantidade negativa. |
| LOJ-05 | Pagamento chega após vencimento de reserva/cancelamento | Exceção visível; sem tomar unidade de outro cliente. |
| LOJ-06 | Pedido pago mas bike não voltou após cancelamento | Reembolso e retorno físico separados; unidade não disponível. |
| LOJ-07 | Entrega simultânea com estorno/bloqueio | Versão e pré-condições revalidadas; conflito segura a entrega. |
| LOJ-08 | Alteração posterior de preço/custo/cadastro | Histórico da venda não muda. |
| LOJ-09 | Nota aceita pelo provedor, resposta perdida | Consultar referência existente antes de nova emissão. |
| LOJ-10 | Rejeição fiscal/certificado expirado/SEFAZ indisponível | Pendência clara; entrega conforme contingência aprovada pelo contador. |
| LOJ-11 | Cancelamento de nota ou refund isolado | Não presumir automaticamente o outro efeito. |
| LOJ-12 | WhatsApp repete mensagem/status e entrega eventos invertidos | Uma mensagem, histórico de status coerente. |
| LOJ-13 | Mensagem fora da janela ou opt-out | Texto livre bloqueado quando exigido; template válido ou atendimento por outro canal. |
| LOJ-14 | Envio WhatsApp aceito com resposta perdida | Estado incerto visível; sem reenvio cego que duplique atendimento. |
| LOJ-15 | Falta internet na loja | Sem confirmação financeira/estoque offline; operação manual registrada depois com evidência. |
| LOJ-16 | Lead criado apenas com nome e celular | Cadastro e oportunidade válidos; CPF/e-mail/observação nulos sem alerta de incompleto. |
| LOJ-17 | CPF/e-mail opcionais preenchidos inválidos ou omitidos em PATCH | Invalidade preenchida rejeitada; omissão não apaga dado anterior; null explícito limpa quando permitido. |
| LOJ-18 | Loja cadastra modelo e três bikes sem séries iniciais | Três unidades internas e um recebimento; contagem disponível correta, série pode ser completada antes de entrega aplicável. |
| LOJ-19 | Upload/substituição de foto falha ou usuário repete formulário | Modelo/entrada não duplicados; imagem padrão ou anterior preservada, upload rejeitado não fica publicável. |
| LOJ-20 | Recontagem diverge com reservas/compromissos ativos | Ajuste com autor/motivo e divergência; não apagar reserva/venda para forçar quantidade. |
| LOJ-21 | Custo do produto ainda não cadastrado | Margem exibida como não calculável/incompleta; não presumir custo zero. |
| LOJ-22 | Dois vendedores movem card/reordenam; gestor arquiva etapa ocupada ou acesso é revogado durante o gesto | Versões de card/etapas/ordem revalidadas no commit; conflito explícito, sem sobrescrita nem efeito financeiro; arquivamento exige transferência e preserva histórico. |
| LOJ-23 | Mesma pessoa é cliente e fornecedor ou compartilha telefone | Um contato pode ter ambos papéis sem duplicação obrigatória; telefone não mescla pessoas automaticamente. |
| LOJ-24 | Fornecedor PF/PJ sem todos campos fiscais do ERP | Cadastro mínimo role-aware válido; dado efetivamente necessário pedido na etapa apropriada, sem invalidar leads simples. |
| LOJ-25 | Quantidade física inclui reservas/inspeção e estoque mínimo opcional | Físico/reservado/disponível separados; alerta usa disponível/configuração e não altera quantidade. |
| LOJ-26 | Custo catálogo muda ou fornecedor é arquivado após entrada/venda | Custo histórico/CMV e relações preservados; custo por entrada não sobrescrito pelo catálogo. |
| LOJ-27 | Arrastar cards dentro/entre etapas e ordenar colunas, com filtro/paginação e mouse/toque/menu/teclado | Ordem persiste após reload; alvos relativos claros, ocultos preservados, foco/Escape acessíveis, pendência visível; erro conclusivo restaura e timeout consulta antes de repetir. |
| LOJ-28 | Aplicar novamente arquivo/mapping e consumir lote em paralelo | Mesmos IDs/alvos/vínculos; um commit por origem, sem cadastro, estoque, receita ou dívida duplicados. |
| LOJ-29 | Interromper importação antes/depois do commit de uma linha/lote | Progresso confirmado retoma sem pular nem repetir; erro/quarentena permanece contabilizado; lote parcial não é completo. |
| LOJ-30 | Fonte transformada por IA sem referência original; ID/mapping/alvo muda após prévia/corte | Sem comparação/evidência mantém UNVERIFIED e não aplica em operação; hashes/versões invalidam prévia alterada; diferenças resolvidas sem “última linha vence”, merge por nome ou sobrescrita silenciosa. |
| LOJ-31 | Documento/ID com zero inicial/apóstrofo de planilha, telefone ambíguo, célula maliciosa ou contato incompleto | Parser trata tudo como texto/dado, normalização exata por mapping; pendências preservadas sem documento/celular/role/owner fabricados ou uso operacional indevido. |
| LOJ-32 | Atributo/pai/variação sem referência, SKU duplicado ou enum desconhecido | Join por origem normalizada, sem associação por nome; namespace de variação exige prova; colisões/mapeamento ficam explícitos, não há descarte nem promoção silenciosa. |
| LOJ-33 | Migrar catálogo sem quantidade/custo/foto e conferir abertura/histórico | Sem estoque zero presumido, custo zero, nova receita/CMV ou comissão histórica; conferir fonte/corte/IDs/quantidades/valores e bloquear fluxo afetado pelas divergências. Jornada sintética complementa papel/owner e classificação, confirma abertura inclusive zero e habilita uso pelos comandos normais, sem PATCH livre das flags. |
| LOJ-34 | Núcleo em uso com canal de campanha ainda não contratado | CRM/estoque/financeiro/fiscal operam pelos próprios gates; sem inbox ou IA integrados, disparos indisponíveis até fase final. |
| LOJ-35 | Adiar T12 enquanto n8n atende no canal existente | Sem mudança de workflow/sessão/webhook/saída da IA, sem handoff ou dependência do core. |
| LOJ-36 | Status/eco/consulta de disparo repetidos ou fora de ordem | Uma mensagem/operação por destinatário, estados coerentes, sem turno IA/lead/conversa ou efeito financeiro criado. |
| LOJ-37 | Público CRM/WhatsApp/misto, contatos no mesmo número, conteúdo/canal alterados ou sem opt-in | Seleção autorizada e dedup endpoint, identidade ambígua excluída; revisão alterada exige aceite; import/aniversário/diretório não geram consentimento. |
| LOJ-38 | Campanha/regra/master pausados, opt-out ou perfil/atribuição mudam antes de dispatch | Revalidação impede novos despachos; enviados/incertos preservados; retomar não duplica e queued não aparece enviado. |
| LOJ-39 | Evolution aceita envio e resposta se perde, canal desconecta ou não há lookup conclusivo | Operação incerta/pendente e consulta/evidência sem segundo POST cego; sem promessa de entrega ou “anti-ban”. |
| LOJ-40 | Falta lookup/status independente, número não confirmado ou transporte exige capturar canal atual | Disparos permanecem indisponíveis sem interromper atendimento externo ou escolher destinatário por heurística; núcleo não bloqueado. |
| LOJ-41 | Alternar Claro/Escuro/Sistema, reabrir, zoom/teclado, telas comuns e ação financeira sensível | Tema persiste sem secrets, contraste nos dois modos; UX concisa sem textos de taxas, mas débito total/destino/estado corretos e detalhe restrito disponível. |
| LOJ-42 | Lead sem aniversário, dia/mês sem ano, limpar/editar data ou importar CSV sem campo | Cadastro mínimo válido, sem ano/dia inventado, ano ausente não calcula idade e salvar/listar não envia mensagem. |
| LOJ-43 |31/04,29/02, ano futuro, virada de mês/ano e consulta Hoje/mês/período | Calendário validado; ocorrências civis em America/Sao_Paulo;29/02 em ano comum exige política explícita ou fica pendente. |
| LOJ-44 | Duas campanhas/keys, dois consumidores, contato mesclado/telefone alterado ou restore na mesma ocorrência anual | Reserva anual durável impede segunda felicitação por contato/endpoint, inclusive envio incerto; retomar só mesma operação elegível, sem apagar limite. |
| LOJ-45 | SELLER acessa aniversariantes fora da carteira ou tenta mudar regra alheia/master/canal; campanha sem dado/permissão | Escopo/ator atuais validados; vendedor opera só suas campanhas/regras autorizadas, sem poderes financeiros ou novo consentimento fictício. |
| LOJ-46 | SELLER cria campanha com fonte comercial conectada, referência opaca inválida ou contato sem CRM | Fonte/carteira/conta autorizadas no servidor, sem enumerar outro canal, criar lead ou assumir nome/nascimento/consentimento; preview factual do público. |
| LOJ-47 | Gerar mensagens para selecionados com IA on/off, notas ausentes, geração falha/duplicada/obsoleta | Cada mensagem e revisão estável, contexto permitido; preview/base/fallback/exclusão corretos sem aprovação manual por pessoa ou sucesso fictício. |
| LOJ-48 | min>max, faixa inválida, dois consumidores, retry e reconexão do agendador | Rejeitar faixa; sortear/persistir uma vez, respeitar gate/due_at e não antecipar ou dormir no Worker; atraso não é SLA de entrega. |
| LOJ-49 | Disputa pelo 70º/71º destinatário entre usuários/campanhas/birthdays/bindings | Constraint/locks de quota global autorizam no máximo70slots ativos/consumidos/incertos do dia; nova key/usuário/binding não reinicia contador. |
| LOJ-50 | Ligar/desligar aniversário, cron repetido, regra pessoal/geral sobrepostas, nova data ou responsável | Uma execução diária por regra e ocorrência anual única; pessoal precede geral; desligar/alterar/revogar impede não despachados; sem clique diário ou catch-up de dia passado. |
| LOJ-51 | Resposta de envio perdida, lease vencido, virada do dia ou restore contém contador antigo | Mesmo slot/operação mantidos ou revalidação com prova sem dispatch; incerto/aceito não libera budget nem anual; restore bloqueia até contagem comprovada. |
| LOJ-52 | Mais elegíveis que vagas, aniversário ultrapassa data/janela e campanha geral fica pendente | Priorização proposta explícita, birthday expira com motivo, geral pode seguir dia futuro aceito; sem parabéns atrasados ou adiamento silencioso para contornar70. |
| LOJ-53 | Registro de vendas com mais pedidos que uma página, filtros, múltiplos itens/cobranças/documentos e reabertura | Número/data/vendedora e snapshots preservados; ordenação estável, uma linha por pedido e total filtrado do servidor sem multiplicação por joins. Canceladas/devolvidas continuam consultáveis; cobertura/incerteza e retorno físico próprios, ausência/múltiplos documentos fiscais sem escolher o último como resumo. |
| LOJ-54 | SELLER tenta detalhe por URL, filtro de outra vendedora, contagem ou exportação de vendas fora do escopo | Servidor/banco negam sem expor existência ou montante; compartilhamento explícito funciona e OWNER consulta a loja. Resposta comercial não contém custo, margem, tarifas, líquido, split ou bancos. |
| LOJ-55 | Confirmar venda duas vezes, atualizar/reabrir registro e consultar sem PSP habilitado | Mesma confirmação retorna um pedido/referência; nenhum movimento/alocação/obrigação duplicado. Termos comerciais não viram pagamento, saldo, split liquidado, emissão ou entrega; confirmação exige commit íntegro T04/T05 e cobrança externa permanece indisponível. |

## 5. Pix e Koin — gates bloqueantes

**Pix está incluído no escopo financeiro principal**, com tarifa fixa aceita; ativação requer habilitação e testes do percurso. **Koin permanece condicionada** à compatibilidade de QR, split e estorno/crédito. Nenhum item abaixo autoriza teste financeiro real sem autorização específica do titular e condições do provedor.

| Gate | Evidência necessária | Quem resolve |
| --- | --- | --- |
| PIX-01 | Condição comercial de tarifa fixa para subconta, cobrança dinâmica escolhida, split fixo e canal utilizados; franquia/prazo/limites explícitos | Asaas + prestadora + Ninebike |
| PIX-02 | Consulta de taxas aplicável e extrato de piloto confirmando taxa realizada e líquido, com monitoramento de alterações | Engenharia + financeiro |
| PIX-03 | QR fixado à cobrança/pedido, expiração, pagamento tardio, duplicidade e split de 1,5% bruto | Engenharia + Asaas |
| PIX-04 | Meio de saída Pix com tabela/franquia conhecida; proprietário aprova valor mais eventual custo fixo antes do envio | Financeiro + Asaas |
| KOIN-01 | Produto contratado permite atividade da Ninebike e QR dinâmico Asaas específico | Koin + Asaas |
| KOIN-02 | Pagamento quita a mesma cobrança, na subconta correta, pelo valor correto e provoca o split | Piloto conjunto autorizado |
| KOIN-03 | Identidade do originador e vínculo comprador/tomador/entrada/Pix documentados | Koin + Asaas |
| KOIN-04 | Análise, limite/entrada insuficiente, recusa, abandono e QR vencido não concluem venda | Engenharia + piloto |
| KOIN-05 | Devolução total/parcial comprova refund Asaas, reversão de split e ajuste/cancelamento do crédito Koin | Koin + Asaas + financeiro |
| KOIN-06 | Tarifa Pix fixa conforme condição conhecida; juros Koin apresentados separadamente ao comprador e sem inflar receita Ninebike | Contrato + extrato |
| KOIN-07 | Se API direta: endpoint e evidência que pagam a cobrança Asaas, não apenas chave/conta | Koin + Asaas |

Se um gate não puder ser atendido, manter modalidade afetada desabilitada e registrar motivo. Não implementar repasse paralelo para simular split nem registrar cobrança como paga manualmente. Tarifa fixa Pix aceita não dispensa prova da liquidação e do split.

## 6. Infraestrutura e recuperação

| ID | Ensaio | Resultado exigido |
| --- | --- | --- |
| OPS-01 | Erro entre gravar negócio e enfileirar | Rollback integral, sem negócio confirmado sem job. |
| OPS-02 | Worker morto, Cron atrasado ou consumidor sobreposto | Jobs duráveis; retomada respeita lease e operação incerta. |
| OPS-03 | Asaas/Supabase/fiscal/Meta fora do ar | Indisponibilidade/pendência explícita, sem falso sucesso. |
| OPS-04 | Webhook Asaas pausado ou lacuna sem eventos | Alerta, correção/reativação quando aplicável e recuperação por consulta/extrato. |
| OPS-05 | Chave revogada, conta em avaliação/bloqueada | Meio afetado bloqueado; sem trocar para conta principal indevidamente. |
| OPS-06 | Backup restaurado contém saque já realizado fora do banco | Saída permanece bloqueada e não é reenviada. |
| OPS-07 | Objeto/XML apagado e restore do banco | Recuperar objeto da cópia independente e verificar hash, além do metadado. |
| OPS-08 | Rollback de código com schema novo | Compatibilidade demonstrada; nenhum rollback financeiro presumido. |
| OPS-09 | Pico representativo de usuários/jobs | Lotes/limites definidos por medição; sem quebrar invariantes. Volume de teste acordado antes da execução. |
| OPS-10 | Monitoria perde o consumidor ou surge diferença financeira | Alerta chega ao responsável correto; runbook executável. |
| OPS-11 | Atualização de tela perde eventos, expira autorização ou volta após desconexão | Reconsultar fonte autorizada; fallback visível; canal não entrega valores financeiros ou dados de outro funcionário. |
| OPS-12 | Promover código local → PR → staging → homologação → piloto | Cada gate tem commit/schema/cenário/resultado/evidência; banco/Worker reais nos riscos próprios, mock não homologa provedor, falha material bloqueia avanço e CI não usa dados/credenciais de produção. |
| OPS-13 | Habilitar campanhas/IA de composição e rotina diária na etapa final | Homologar canal/diretório/status/gerador/consentimento sem alterar o workflow IA externo; quota 70 vale só para disparos Ninebike, não tráfego n8n independente. |

Medir RPO real, RTO real e completude da recuperação. “Backup habilitado”, HTTP 200 do serviço ou build local passando não provam operação restaurável.

## 7. Condições para primeira produção

- [ ] Conta principal e subconta nos CNPJs corretos, cadastro/regulatório aprovados para valores da loja e modalidade BaaS/gestão de chaves resolvida.
- [ ] Contrato de 1,5% bruto assinado, base/rateio/estornos/perdas/tarifas/responsabilidades definidos.
- [ ] Proprietário, financeiro e substitutos cadastrados; alçadas, beneficiário PJ e aprovação/MFA testados.
- [ ] Pix/cartão/boleto efetivamente habilitados apenas nos percursos homologados; Koin segue desligada se seus gates próprios faltarem.
- [ ] Cobrança, split, estorno, saque e reconciliação demonstrados em sandbox e piloto exigido pelo risco/provedor.
- [ ] Cenários críticos FIN/SEG/OPS cobertos; diferença monetária inesperada em aberto impede liberação do financeiro afetado.
- [ ] UF, regime, documentos fiscais, certificado e política de contingência aprovados pelo contador; emissão necessária disponível.
- [ ] Um único emissor principal, provedor/capacidades, configuração fiscal, alçadas humanas e critérios mensais comprovados antes de habilitar atos fiscais; destino desconhecido não tem importação automática.
- [ ] T12 fica fora da primeira produção do núcleo; sua futura liberação exige transporte/status/consentimento homologados sem alterar a IA externa.
- [ ] Ambiente e credenciais separados; build real Workers validado; restauração de banco e objetos ensaiada.
- [ ] Retenção, orçamento de PITR, janela de perda aceitável, responsáveis por incidentes e rotina de fechamento definidos.
- [ ] Abertura com data de corte, custos/AP/AR/fontes e classificação de resultado conferidos; dashboard informa pendências. Regra da equipe aprovada/testada antes de liberar comissão, sem percentual/gatilho presumido.
- [ ] Evidências e manual operacional entregues; nenhuma capacidade pendente apresentada ao usuário como disponível.

## 8. Limites do que foi verificado nesta revisão

A v2.6 acrescenta auditoria estrutural e relacional local dos CSVs recebidos, sem alterar as fontes ou importar dados no produto. LOJ-27–33 e OPS-12 são novos ensaios futuros. A auditoria de arquivos e o build deste portal não executam esses ensaios. Cobertura de financeiro e fiscal depende das provas de banco, falhas, homologação e piloto descritas em [plan.md](plan.md).

Foram analisadas a proposta, decisões da conversa, documentação oficial e telas autenticadas do ERP Olist em modo somente leitura, além de scripts públicos via REA estático. Nenhum dado/cadastro/lançamento foi salvo no Olist; não houve cobrança, pagamento, estorno ou saque. Não houve implementação do aplicativo, homologação ou teste end-to-end de produto. A análise estática é parcial e não comprova backend/permissões ou todas as regras efetivamente usadas pela loja. A revisão documental descreve o que exigir da implementação; não certifica o sistema que ainda será construído.

## 9. Fiscal com aprovação humana e exportação mensal

Requisitos em [fiscal.md](fiscal.md). Todos são ensaios futuros; leitura do Olist/REA não os executou.

| ID | Situação real | Resultado exigido | Evidência mínima |
| --- | --- | --- | --- |
| FIS-01 | Pagamento, split, pedido ganho, entrega, estoque, fechamento ou Cron executados | Nenhuma emissão, evento ou lançamento fiscal automático | Spy do adaptador mutante e trilha de comandos. |
| FIS-02 | Humano aprova, mas não clica enviar | Aprovação interna registrada, sem transmissão/operação mutante | Aprovação e ausência de dispatch. |
| FIS-03 | Alterar destinatário/itens/tributo/ambiente/configuração após revisão | Aprovação invalidada; envio negado até nova revisão | Snapshot/hash/versões e teste direto HTTP. |
| FIS-04 | Duas abas, duplo clique ou key diferente para mesma intenção | Uma identidade/ação/operação, sem segunda emissão | Concorrência no banco e chamadas ao adaptador. |
| FIS-05 | Queda antes do início de despacho comprovado | Só novo clique pode retomar a mesma intenção com revalidação; Cron não transmite | Estados/lease/geração e execução interrompida. |
| FIS-06 | Provedor pode ter aceitado e resposta se perde | Incerto, consulta da mesma referência; sem reenvio, renumeração ou nota substituta automáticos | Operação e evidências remotas. |
| FIS-07 | HTTP200/lote processado, mas resultado individual pendente/rejeitado | Não autorizar nota por resultado genérico; protocolo/código por documento | Respostas de lote e individuais. |
| FIS-08 | Rejeição conclusiva e correção dos dados | Nova revisão/validação/aprovação/clique, identidade conforme contrato; sem envio em finally | Linha do tempo e chamadas. |
| FIS-09 | Webhooks repetidos/fora de ordem, chave/empresa/ambiente errados | Correlação/dedup; sem regressão ou autorização indevida | Eventos autenticados e casos negativos. |
| FIS-10 | Emissor principal desconhecido ou operação já emitida no software externo | Transmissão bloqueada/identidade vinculada, sem segunda emissão | Configuração e evidência oficial importada. |
| FIS-11 | Série/número/faixa colidem com nota ou operação incerta | Bloqueio sob lock e consulta, sem liberar número por excluir localmente | Identidade/intervalos e concorrência. |
| FIS-12 | Cancelamento solicitado, rejeitado ou incerto | Só confirmação oficial aceita marca cancelamento; nota/artefatos preservados | Ação, aprovação e protocolo. |
| FIS-13 | CC-e para NFC-e ou campo vedado; CC-e válida quando suportada | Modelo/elegibilidade bloqueiam ato indevido; evento próprio aprovado preserva original | Casos por modelo e regras vigentes. |
| FIS-14 | Inutilização de faixa e contingência após queda | Cada ato validado/aprovado/enviado pelo humano; sem nota fictícia/ativação/retransmissão automática | Permissões, faixa, motivo e protocolo. |
| FIS-15 | Imprimir, visualizar, baixar ou exportar nota | Nenhuma alteração de estado oficial, estoque, AP/AR ou cobrança | Comandos/chamadas observadas. |
| FIS-16 | Importar XML de venda já registrada; cancelar nota sem retorno da bike | Dedup/vínculo de origem; sem segunda receita/CMV/estoque/refund/split | Fatos e fontes compartilhadas. |
| FIS-17 | Prévia ou XML sem protocolo; documento divergente do aprovado ou XML/protocolo de outra nota | Não rotular autorizado; conferir mapa tela/snapshot/XML/DANFE, ordem de itens, precisão/totais, schema e vínculo do protocolo; inconsistência explícita | Matriz de campos, XML validado e conferência visual do modelo final, identidade/hashes/estado. |
| FIS-18 | Exportar mês completo com filtro anterior de últimos30dias | Período/eixo/fuso/corte explícitos, sem herança silenciosa; revisão humana | Filtros congelados e manifesto. |
| FIS-19 | Paginação interrompida, XML ausente ou ZIP parcialmente gerado | Pacote PARTIAL/FAILED, faltantes visíveis; sem selo completo | Checkpoint, contagens e hashes. |
| FIS-20 | Cancelamento/CC-e no mês de nota emitida antes dele | Evento e referência original incluídos conforme critério aprovado, sem omissão/duplicata | Fonte e manifesto por evento. |
| FIS-21 | Arquivo baixado novamente, evento tardio, importação repetida | Mesmo pacote imutável; revisão nova explícita; importação dedup sem nova emissão | IDs/versões/identidades. |
| FIS-22 | Vendedor/suporte tenta aprovar/enviar/exportar fora do escopo | Negação no servidor/Storage; grants fiscais não herdados de financeiro | Requests diretos e URLs privadas. |
| FIS-23 | A1 expira/rotaciona, XML/ZIP malicioso ou export tenta conter segredo | Bloquear envio afetado, parser/limites seguros, nenhum A1/senha em artefatos/logs/bundle | Casos negativos e inspeção de artefatos. |
| FIS-24 | Restore após emissão externa ou transição do SHOP Simples | Sem replay; reconciliar antes do clique; conhecer o software/pacote não prova importação e nenhum conector/lançamento externo ocorre | Restore, operação e fronteira do destino. |
| FIS-25 | Upload/pré-análise de XML/dados e leitura em segundo plano | Apenas quarentena/validação/prévia; sem cadastro operacional, numeração, contas, custo, estoque ou transmissão | Spies de portas mutantes e estado dos módulos antes/depois. |
| FIS-26 | Aprovação de incorporação sem confirmação, ou troca de arquivo/vínculo/mapeamento | Nenhuma incorporação antes da confirmação; mudança invalida aprovação; hash/revisão conferidos pelo servidor | Requisições diretas, snapshot e permissão OWNER. |
| FIS-27 | Lote com arquivo repetido, concorrente, divergente ou falha parcial | Uma identidade/efeito por origem, confirmação por item, pendências explícitas; retomada não reaplica confirmados | Manifesto por item, transações e histórico de importação. |
| FIS-28 | Cor/tamanho/quadro/série ou conversão de unidade divergentes do catálogo/estoque | Sugestão sem merge automático; exigir vínculo correto à unidade, preservar posições e XML original; bloquear aplicação incompatível | Mapa nota-item-unidade, artefatos e validação de precisão/quantidade. |
| FIS-29 | Dados legados sem prova de estado; XML autorizado reapresentado; dados pré-emissão confirmados | Desconhecido permanece quarentena sem nova emissão; autorizado só incorpora/vincula; pré-emissão só prepara rascunho após aprovação | Casos com/sem protocolo e confronto de origem/empresa/ambiente/identidade. |
| FIS-30 | Linha legada Recebimento Autorizado ou impressão/DANFE | Exibir situação fiscal com proveniência; não marcar pagamento, lucro, split, entrega, estoque ou baixa como realizados | Projeções financeira/fiscal separadas e nenhuma chamada de pagamento. |

## 10. Escopo de execução dos aceites v2.7

LOJ-42/43 pertencem ao cadastro/lista T02 e não dependem de transporte. LOJ-12–14,37–40,44–52 e OPS-13 são ensaios de disparos somente na etapa final T12; não bloqueiam T14 do núcleo quando a capacidade permanece ausente. LOJ-34/35 verificam precisamente essa independência. Não executar roteiro antigo de inbox/handoff/n8n. IA de composição de campanha e aniversário diário são requisitos novos v2.8 de T12, sem chatbot. Os IDs revisados continuam requisitos futuros, não execuções anteriores aprovadas.
