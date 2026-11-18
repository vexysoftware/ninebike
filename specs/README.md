# NINEBIKE OS — planejamento consolidado v2.10.0

Criado em 14/10/2026; atualizado em 26/10/2026. Planejamento para implementação futura; nenhum ERP ou integração operacional foi homologado. Existe somente rascunho local de fundação, sem validação. **A implementação está suspensa por pedido do responsável.** O portal publicado apresenta o planejamento.

## Atualizações que prevalecem — 23/10

- **Fiscal unificado:** os dois vídeos identificam SHOP Simples / Nota Fácil (Alterdata), além do Olist. Incorporar a conferência/gestão fiscal no Ninebike, com pré-análise sem lançamentos, revisão, aprovação e confirmação humanas. Documento já autorizado só é vinculado/arquivado; dados pré-emissão só preparam rascunho. O responsável confirmou que a saída do Olist é pendente e a aprovação/emissão ocorre no SHOP. Essa confirmação define o fluxo; os vídeos não mostram a passagem completa e o arquivo/layout continuam pendentes de validação. [Fluxo e limites da análise](specs/001-sistema/fiscal.md).
- **Financeiro em revisão:** recebimento integral em D+1 e comissão da prestadora de 1,5% bruto. Volumes, taxas atuais e metas comerciais ficam na análise privada, sem publicação de condições da loja. As referências Asaas/Koin abaixo são a proposta anterior, sem escolha/homologação atual do provedor.
- Não retomar implementação nem ativar pagamentos, emissão, lançamentos ou disparos por esta revisão documental.

## Decisões confirmadas

**Prontidão de desenvolvimento — 26/10/2026:** há especificação suficiente para começar o núcleo por etapas, após orientação explícita de execução. Deixar pendente a contratação/integração do PSP não significa adiar despesas, contas gerenciais, cálculos exatos e controles de integridade. [Recorte de construção sem PSP](specs/001-sistema/build-guide.md). Os 175 cenários são requisitos futuros, não testes aprovados do aplicativo; esta revisão não retoma a implementação.

- Uma única Ninebike usuária, com marca própria e perfis de acesso; bikes aproximadamente de R$ 4 mil a R$ 15 mil. Tráfego esperado baixo não significa faturamento baixo; dimensionar pelo uso efetivo sem publicar condições comerciais privadas.
- Provedor financeiro, hierarquia de contas/recebedores e integração de split/saque permanecem pendentes. Ninebike é titular de suas vendas/recebimentos no próprio CNPJ; a prestadora recebe sua remuneração. A estrutura Asaas/subconta nos detalhes históricos é a proposta anterior, não fornecedor contratado nem caminho a implementar automaticamente.
- Comissão inicial **1,5% do bruto**, antes das taxas do provedor, calculada em centavos. A forma exata de enviá-la no split e a responsabilidade pelas tarifas dependem do contrato homologado; não substituir pela porcentagem sobre o líquido.
- **Tarifa fixa de recebimento Pix aceita**, inclusive no percurso Koin compatível. A antiga restrição de gratuidade foi substituída. Tarifa percentual de recebimento Pix não está aceita.
- CRM simples: **nome e celular obrigatórios; CPF, e-mail e observação opcionais**. Dados adicionais são solicitados somente na etapa em que cobrança/fiscal efetivamente os exigirem.
- A própria loja cadastra modelos, fotos e quantidades. Movimentos auditados e reservas geram disponibilidade, sem saldo livremente editável ou custo desconhecido tratado como zero.
- Cloudflare + Supabase, monólito modular hexagonal, sem infraestrutura de escala especulativa.

## Direção de produto e início suspenso

**Decisão de 18/10/2026:** primeira versão reproduz a utilidade das áreas selecionadas do Olist — contatos, produtos/estoque, comercial, financeiro e notas — em um sistema próprio Ninebike, com interface melhor, rastreabilidade e controles de acesso. Isso não significa clonar todos os módulos do ERP ou afirmar que seu backend foi auditado. As decisões específicas da Ninebike prevalecem: split do software de 1,5% bruto, Pix de tarifa fixa e fiscal com aprovação/clique humanos.

Os vídeos do SHOP Simples agora complementam o desenho fiscal. O fluxo proposto elimina a transferência entre dois programas nas vendas novas, sem inventar API do legado ou chamar importação de uma nova emissão. A transição exige validar arquivo/layout e vínculos; o estado pendente na saída do Olist foi confirmado pelo responsável. O Ninebike usará um provedor fiscal homologado; nenhum nome/configuração/numeração foi escolhido só pela filmagem. O início da implementação permanece suspenso por orientação posterior do responsável.

Começar pelo [roteiro de construção até o lançamento](specs/001-sistema/build-guide.md), executar as [tarefas T00–T16](specs/001-sistema/tasks.md) e aplicar as [regras de design](specs/001-sistema/design.md). As referências visuais futuras refinam a identidade e as telas, sem alterar permissões, cálculos, estados ou aprovação fiscal. As escolhas visuais iniciais são propostas, não identidade final aprovada.

O desenvolvimento pode começar com capacidades externas desligadas e dados fictícios em teste. Este roteiro não declara cobrança, saque, emissão, publicação da aplicação operacional ou desativação do Olist já realizados. A entrada em produção segue os testes e o corte definidos no guia. Cada capacidade só é habilitada com evidência; não mostrar dado simulado como saldo real nem simular integração ausente.

## Escopo completo da entrega

**Revisão v2.5 antes do código:** pipeline com ordem persistida de cards/colunas e alternativas acessíveis; contratos de reserva em grupo e vínculos entre módulos; importação privada, versionada e retomável dos três CSVs; cadeia local → PR → staging → homologação → piloto. Detalhes dos arquivos e faltantes no [guia de migração](specs/001-sistema/build-guide.md), testes em [plan.md](specs/001-sistema/plan.md) e [175 cenários futuros](specs/001-sistema/acceptance.md). São melhorias da especificação; nenhum teste do ERP, importação real ou integração foi executado nesta revisão.

| Área | Incluído |
| --- | --- |
| Contatos e CRM | Cadastro simples/captura/WhatsApp, contato com papéis cliente/fornecedor, PF/PJ/dados sob demanda, histórico/carteira/origem/notas; fornecedor não autoriza transferência. |
| Comercial | Pipeline Kanban/lista configurável, vendedores, atividades humanas, propostas/descontos, pedidos e pagamento misto. |
| Catálogo e estoque | Modelo/nome/foto/preço, quantidade inicial, unidades internas de bikes, chassi quando aplicável, acessórios, entradas/reservas/ajustes/inspeção e devolução. |
| Pagamentos | Pix com tarifa fixa, boleto, cartão hospedado à vista/parcelado nos percursos homologados, split de 1,5% bruto e estados separados. |
| Financeiro | Contas/AP/AR, gastos/categorias/competência/baixas parciais, caixa e DRE gerencial, CMV/margem/resultado com completude, saldos de abertura/fechamento versionado, Asaas/split, estornos/disputas/saques/conciliação. |
| Equipe | Regra própria versionada, previsão/reconhecimento/liberação, obrigação, pagamentos parciais externos comprovados, ajustes e extrato por funcionário; taxa/base/gatilhos ainda pendentes. |
| Crédito Koin | Modalidade condicionada a pagar a cobrança Asaas específica e comprovar split e devolução coordenada do crédito. |
| Comunicação final | Campanhas SELLER/OWNER, fonte CRM/canal autorizada, IA de composição opcional, intervalo aleatório,70/dia compartilhados e aniversário diário ativável; sem inbox ou integração da IA n8n. |
| Fiscal humano | Preparo Olist e conferência/gestão do SHOP Simples no mesmo fluxo: pré-análise em quarentena, revisão/aprovação/confirmação da incorporação, rascunho/emissão separados, eventos/arquivos/pacote mensal. Saída pendente no Olist e aprovação/emissão no SHOP confirmadas; arquivo/layout e provedor ainda pendentes. |
| Administração | Convites, perfis/grants/alçadas, suporte temporário, beneficiários, auditoria, configurações e capacidades de integração. |
| Operação | Fila durável, webhooks, tratamento de incerteza, alertas, backup de banco/objetos, restore sem replay e guia de homologação. |

## Documentos normativos

1. [Especificação funcional](specs/001-sistema/spec.md): regras comerciais/financeiras, campos CRM, pipeline, telas, estoque e permissões.
2. [Arquitetura técnica](specs/001-sistema/architecture.md): fronteiras hexagonais, transações, fila, webhooks, segurança e recuperação.
3. [Modelo de dados](specs/001-sistema/data-model.md): entidades, campos, cardinalidades, constraints e commits.
4. [Contratos da API](specs/001-sistema/contracts/api.md): rotas, schemas, autenticação, versões, idempotência e erros.
5. [Plano de implementação](specs/001-sistema/plan.md): stack, arquivos, dependências, parâmetros e estratégia de verificação.
6. [Tarefas executáveis](specs/001-sistema/tasks.md): T00–T16, ownership, passos e evidências de cada entrega.
7. [Aceite e falhas reais](specs/001-sistema/acceptance.md): cenários verificáveis e gates de implantação.
8. [Guia de validação e operação](specs/001-sistema/quickstart.md): jornada de loja, financeiro, segurança e restauração.
9. [Fiscal com aprovação humana](specs/001-sistema/fiscal.md): engenharia reversa, campos, atos, numeração, protocolos e exportação mensal supervisionada.
10. [Do primeiro commit ao lançamento](specs/001-sistema/build-guide.md): ordem das entregas, dependências, homologação, migração, publicação e recuperação.
11. [Design do produto](specs/001-sistema/design.md): fundamentos visuais, componentes, telas, estados, acessibilidade e critérios de acabamento.

Uma única pasta `specs/001-sistema` segue a organização do Spec Kit; não há plano paralelo. O CLI do Spec Kit não foi executado; existe um rascunho separado do aplicativo, sem validação e com execução suspensa. Na implementação, importar estes documentos no repositório real e reutilizar ferramentas/convenções existentes.

## Caminho do dinheiro

```text
Pedido Ninebike → cobrança da subconta Asaas → recebimento oficial
               → tarifa efetiva + split prestadora + líquido Ninebike
               → saque autorizado do saldo disponível ao banco PJ
```

Exemplo de referência: R$ 8.000 − R$ 1,99 de Pix − R$ 120 de comissão = **R$ 7.878,01 para a Ninebike**, antes de eventual tarifa de saque. A tarifa real vem da condição da subconta, com vigência e evidência; não é hardcoded. Koin, se homologada, precisa pagar essa mesma cobrança, não apenas enviar um repasse genérico à conta.

## Fechamento e condições de implantação

O escopo e os mecanismos de integridade estão definidos. As escolhas técnicas do planejamento estão registradas; parâmetros comerciais da loja têm configuração obrigatória com bloqueio seguro quando ausentes. Aprovação Asaas/BaaS, condições de perdas, percurso parcelado, Koin, contador/UF/regime, canal de disparos apenas na etapa final e orçamento/retenção de recuperação dependem de evidências externas e responsáveis.

Essas condições não serão presumidas resolvidas por uma tela pronta. Pix pertence à primeira entrega financeira; Koin só é ativada após seus gates. Não há garantia de erro/risco zero: operações incertas, reversões e diferenças devem ser detectadas, preservadas e resolvidas sem duplicar dinheiro.

## Evolução a partir do Olist — 17/10/2026

Inspeção autorizada, somente leitura, das áreas indicadas. Os rótulos abaixo são observações da interface; disponibilidade não comprova que a loja use cada opção. Nenhum cliente, documento, nome de funcionário, saldo ou valor real foi copiado para o portal. Não houve cadastro salvo, baixa, pagamento, transferência ou exportação no Olist.

| Área observada | O que apareceu | Como entra no Ninebike |
| --- | --- | --- |
| Clientes e fornecedores | Papéis de contato; dados gerais/complementares, anexos e observações; identidade PF/PJ, telefone/celular/e-mail/endereço, vendedor/status CRM | Um contato com papéis, cadastro de lead continua nome+celular, dados adicionais por necessidade e dedup assistida. Fornecedor vincula produtos/despesas. |
| Produtos | Nome/SKU/unidade/preço/custo, imagens, marca/categoria, fornecedor, garantia, quantidade física/disponível, mínimo e localização | Cadastro enxuto com foto/quantidade, custo histórico por entrada/unidade, variantes simples, reserva e movimentos auditados; sem alterar saldo livremente. |
| Caixa | Categoria, entrada/saída/saldo, data, valor, histórico e cliente/fornecedor no formulário vazio | Contas gerenciais e movimentos referenciados; abertura documentada, saldos derivados, nenhum botão genérico para corrigir saldo oficial. |
| Contas | AP: aberto/emitidas/pagas/atrasadas/canceladas; AR: aberto/recebidas/atrasadas/canceladas | Obrigação e baixas parciais com evidência; recebido oficial Asaas separado de registro externo administrativo. Os formulários AP/AR não abriram durante a inspeção; sua validação não foi confirmada. |
| Relatórios | Balancete de entradas/saídas, fluxo de caixa projetado, entradas/saídas por categoria, AP/AR | Caixa realizado e contas futuras separados; acrescentar DRE gerencial/custos/completude para responder gastos e lucro. Projeção futura não é saldo disponível. |
| Comissões | Saldo anterior, comissão do mês, vencidas, devoluções, outros créditos/débitos, pagamentos, pendentes e saldo por vendedor/mês | Extrato rastreável próprio da equipe; regra/vigência/snapshot, previsto separado de obrigação, liberação e pagamento. Não copiar fórmula que não foi observada. |

**REA usado de fato:** análise estática inerte de 9 scripts públicos observados na aba: 2 de comissões e 7 complementares de contatos/produtos/AP/AR. Parsing sem falhas nas amostras; grafo semântico parcial, com limite de resultado em produtos. A inspeção visual corroborou campos/fluxos. Não houve endpoint CDP disponível; não se analisou execução autenticada ou backend, nem se provaram permissões, tarifas ou regras de negócio do Olist.

As fórmulas/configurações atuais da equipe, significado exato de “comissões vencidas”, classificações contábeis e saldos de migração precisam de confirmação. O novo sistema usa termos definidos, não herda ambiguidades de rótulo.

Não ampliar para produção industrial, kits, anúncios, SEO, transportadoras ou outros módulos que não foram pedidos. A inspeção fiscal de 18/10 está consolidada em [fiscal.md](specs/001-sistema/fiscal.md). Nenhuma nota/rascunho real foi criado, alterado, autorizado ou exportado. Preparação XML/planilha e campos do DOM foram examinados; ações potencialmente mutantes permaneceram apenas mapeadas.

## Verificação da documentação

A baseline anterior verificou links, exemplos e aritmética de software/rateio/estornos com 10.000 casos gerados. Nesta revisão há doze fontes, 175 cenários de aceite e 17 tarefas T00–T16. As verificações documentais e do portal são registradas no relatório desta versão; os cenários de produto continuam pendentes de implementação.

Uma revisão independente cruzou escopo, arquitetura, modelo, API e tarefas. Foram corrigidos alvo inequívoco de estorno por cobrança/parcela, persistência de meio/número de parcelas, permissões de solicitação versus execução e limite da cotação local de tarifa. Essa foi a revisão anterior. A v2.2 acrescenta a separação entre reconhecimento e pagamento das despesas/comissões, contatos/fornecedores e novas exigências de aceite.

Esses resultados comprovam a consistência documental e os cálculos exercitados. Testes de aplicativo, integração, segurança em runtime, piloto e restauração continuam pendentes até implementação; não foram substituídos por esta verificação.

Histórico decisório: v1.0 era a proposta recebida; v2.0 registrava Pix apenas gratuito; v2.1 aceitou tarifa fixa e cadastros simples; v2.2 acrescenta os fluxos observados do Olist, gastos/resultado e comissão da equipe, com regras remuneratórias pendentes e fiscal mensal adiado. A v2.3 reabre fiscal após inspeção seletiva completa das superfícies acessíveis, com aprovação humana final e integração de destino pendente. A v2.4 fixa Olist como referência da primeira versão, adia o outro software para evolução e explicita construção até produção e design inicial. Não reutilizar a restrição antiga em implementação futura.

A v2.5 audita os layouts/formatos/vínculos dos três CSVs autorizados localmente, sem importar ou publicar suas linhas. Acrescenta persistência de arraste, reserva em grupo, cadastros legados incompletos, origem de migração, gates de CI/testes e separação do aceite integrado de entrega T04. Não presume que arquivos de catálogo contenham estoque/custo/fotos ou que `tipo` distinga cliente/fornecedor. Ausência de bugs, completude da migração e capacidade de produção continuam dependendo dos ensaios do aplicativo.

## Revisão v2.10: registro de vendas e handoff para implementação

Registro de vendas explícito na seção 5.7 do escopo: lista/detalhe sobre os mesmos pedidos, número/data/vendedora, filtros, snapshots e vínculos com CRM, estoque, cobrança e fiscal. Pagamento/entrega/nota mantêm estados separados; SELLER consulta sua carteira e OWNER a loja. Contratos, dados, design e T04 alinhados; LOJ-53–55 são ensaios futuros de consulta/acesso/idempotência.

O guia de construção é a entrada única do Codex, com primeira entrega T01, fatias completas, publicação progressiva Cloudflare/Supabase, migração/restore e limites sem PSP. A cópia no repositório do aplicativo deve registrar commit e hashes desta baseline; código parcial não validado não significa tarefa concluída. Financeiro interno segue no escopo, contratação/homologação externa permanece pendente e execução do aplicativo continua suspensa.

## Revisão v2.8: disparos para vendedores, IA de texto e aniversário automático

Decisão de 19/10/2026: manter comunicação na etapa final; permitir campanhas e aniversário a SELLER no escopo e OWNER loja; fonte CRM/base comercial WhatsApp, IA opcional que compõe cada texto usando nome/observação comercial permitidos, faixa aleatória e limite fixo compartilhado 70 destinatários/dia. Configurar uma vez e esconder complexidade técnica; não instalar inbox/chatbot/handoff ou alterar a IA n8n existente.

Aniversário diário passa a ser requisito: pessoa habilita/pausa sua regra de carteira; OWNER mantém regra geral/master. Ativação autoriza rotina diária sem clique diário, com calendário/consentimento/limite anual e quota 70. Defaults de horário/faixa/AI off são propostas operacionais, não decisões comerciais já dadas. Limite70 controla apenas campanhas Ninebike; não promete controlar tráfego externo do bot n8n.

Foi inspecionado o ERP real em Cadastros → Clientes e Fornecedores → Ações → listar aniversariantes: período do mês/do dia/intervalo e imprimir/cancelar. REA analisou de forma inerte 2 scripts públicos/111.184 bytes sem falhas de parsing; semântica parcial/unknown. O relatório usa dataNascimento e colunas Nome/Cidade/Telefone/Celular/E-mail/Data de nasc. Nenhum relatório foi impresso/baixado, cadastro salvo ou mensagem enviada. Editor completo de data e backend/casos-limite não foram comprovados. A organização do dado e filtro foi observada; disparo diário/IA/quota são extensões próprias Ninebike.

Mantidos dois perfis humanos, temas clean, financeiro/fiscal seguro, fontes CSV verificáveis e arquitetura Cloudflare/Supabase. A fonte oficial e-commerce Olist de aniversário por e-mail é referência complementar distinta, sem ser confundida com WhatsApp desta conta. [Fonte Olist](https://ajuda.olist.com/promocoes-segmentadas-e-por-canal/promocao-de-aniversario).

São 175 cenários futuros e 17 tarefas, não testes funcionais aprovados. REA/UI/build comprovam somente suas superfícies observadas; aplicativo, IA de composição, transporte, quotas e rotina diária ainda serão construídos e homologados.
