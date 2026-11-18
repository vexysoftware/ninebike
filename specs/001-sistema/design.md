# NINEBIKE OS — design do produto v2.10.0

**Atualização v2.10.0 — 26/10/2026:** implementação suspensa por pedido do responsável; provedor financeiro em revisão (recebimento integral D+1, condições comerciais em revisão privada). O fiscal reúne Olist e SHOP Simples com aprovação/confirmação humanas; o responsável confirmou que os dados saem pendentes do Olist e são aprovados/emitidos no SHOP; arquivo/layout e homologação ainda precisam de validação. As referências financeiras anteriores não representam fornecedor atualmente escolhido. Ver [decisões atuais](../../README.md) e [fluxo fiscal](fiscal.md).

26/10/2026. Instruções para construir as telas do sistema operacional. Complementa [escopo](spec.md), [fiscal](fiscal.md), [tarefas](tasks.md) e [aceite](acceptance.md). Este documento define o acabamento esperado; não declara interface implementada ou conformidade já testada.

## 1. Direção visual e decisões preservadas

Criar um ambiente de trabalho limpo, conciso e confortável para uso diário na loja, com temas **Claro e Escuro** equivalentes. Usar superfícies neutras, hierarquia legível e lima em poucos pontos de ação e orientação; grafite profundo no escuro e branco com cinza suave no claro. A bicicleta aparece em fotos de produto, não como decoração competindo com os dados.

Esta identidade é provisória até chegarem as referências do responsável. Os dois temas são requisito do **produto futuro**; o portal de planejamento mantém seu tema escuro. O Olist orienta os módulos operacionais e aniversariantes; campanhas ficam para a etapa final T12, com Deskcomm apenas como referência de ideias. A IA opcional compõe mensagens das campanhas; inbox, chatbot e integração do atendimento continuam fora do produto. Usar essas referências funcionais sem copiar a interface nem presumir funcionalidades não aprovadas.

- Dar destaque à tarefa corrente, ao valor e à situação; reduzir molduras e cartões sem função.
- Manter uma ação primária por contexto. Usar texto explícito: “Salvar cliente”, “Solicitar aprovação”, “Enviar nota aprovada”.
- Usar brilho, gradiente e sombra com contenção. Nada de neon sobre texto longo, animação decorativa ou vidro que prejudique leitura.
- Preservar CRM simples: nome e celular obrigatórios; CPF, e-mail e observação opcionais. A etapa fiscal pede dados adicionais quando necessários.
- Exibir só os papéis humanos **Vendedor** e **Proprietário**. A IA opcional personaliza campanhas, não cria um terceiro papel humano. Navegação, ações e dados seguem a matriz de acesso do escopo.
- Nas telas comuns, priorizar dados e ações. Não acrescentar banners, etiquetas, percentuais ou textos didáticos sobre tarifas, taxas, split ou comissão do software. A composição financeira fica no extrato detalhado do proprietário, conforme seção 6; cálculo, registro e aprovação permanecem íntegros.
- Aparência não altera cálculo, permissão, aprovação, titularidade, status do provedor ou regra fiscal.

## 2. Tokens iniciais para implementação

Centralizar estes valores no CSS do aplicativo. Componentes consomem os tokens; novas cores exigem finalidade e verificação de contraste. Fonte do sistema evita dependência externa e atraso para começar a trabalhar.

```css
:root {
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --text-xs: .75rem;
  --text-sm: .875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-sm: 6px;
  --radius: 10px;
  --radius-lg: 14px;
  --control-height: 44px;
  --motion: 160ms ease;
}

:root,
[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f8f4;
  --surface: #ffffff;
  --raised: #f0f3ed;
  --hover: #e7edde;
  --line: #dce3d6;
  --control-border: #667260;
  --text: #192216;
  --muted: #4d5948;
  --subtle: #5b6756;
  --accent: #c3f85c;
  --accent-hover: #b4eb47;
  --accent-ink: #162009;
  --accent-text: #496313;
  --focus: #4b6612;
  --info: #225789;
  --warning: #785115;
  --danger: #9c3027;
  --success: #365b14;
  --selection: #e2f1c4;
  --selection-text: #243512;
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b0e0c;
  --surface: #111612;
  --raised: #171d18;
  --hover: #1e2620;
  --line: #29312b;
  --control-border: #748276;
  --text: #edf0e9;
  --muted: #a5afa6;
  --subtle: #849087;
  --accent: #c3f85c;
  --accent-hover: #d2ff82;
  --accent-ink: #162009;
  --accent-text: #c3f85c;
  --focus: #c3f85c;
  --info: #a8c8ec;
  --warning: #e8c78e;
  --danger: #f0aaa1;
  --success: #c3f85c;
  --selection: #26351c;
  --selection-text: #edf0e9;
}
```

Preferência em configurações: **Claro / Escuro / Sistema**, com Sistema como padrão. Resolver `prefers-color-scheme` para `data-theme="light"` ou `"dark"` antes de exibir o aplicativo e acompanhar mudanças do sistema quando essa opção estiver ativa. Guardar somente a preferência visual no navegador; não guardar contato, conversa, documento, sessão ou dado financeiro junto dela. Se o armazenamento estiver indisponível, a escolha ainda funciona na sessão atual. Trocar tema preserva conteúdo, layout, filtros, foco, rascunho e posição; não muda permissões ou estado da operação.

Botão primário usa `--accent` com `--accent-ink`; link e ícone acionável usam `--accent-text`, nunca lima clara sobre branco. Hover de superfícies usa `--hover`; seleção usa `--selection` com `--selection-text`. Cores semânticas são texto/ícone sobre as superfícies de trabalho, não fundos preenchidos sem par validado. Não inverter fotos, PDFs, QR codes ou artefatos oficiais por filtro CSS.

Texto de formulário em 16px; tabelas em 14px; metadados em 12px sem carregar informação financeira essencial. Pesos 400/500/600/700, entrelinha de texto 1,5 e títulos 1,2. Limitar parágrafos extensos a aproximadamente 72 caracteres por linha; títulos de tela em 24–32px, sem escala de landing page dentro do ERP.

Valores monetários ficam alinhados à direita com `font-variant-numeric: tabular-nums`. Datas, unidades e documentos mantêm formato consistente. Mostrar BRL/R$ e sinal por extenso quando necessário; não abreviar o valor em revisão, pagamento ou aprovação. Documento mascarado na lista e revelado somente com permissão.

## 3. Contraste e acessibilidade

Meta de implementação: WCAG 2.2 AA nas jornadas entregues. Para texto comum, exigir contraste mínimo de 4,5:1; para elementos visuais necessários a identificar controles/estados, 3:1 conforme o critério aplicável. Referências: [W3C — contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) e [contraste não textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Contrastes calculados em 18/10/2026 com Python stdlib pela luminância relativa sRGB, em cores opacas. A tabela usa o menor contraste de cada token sobre `--bg`, `--surface`, `--raised` e `--hover`:

| Par/uso | Claro | Escuro |
| --- | --- | --- |
| `--text` / superfícies | 13,71:1 | 13,48:1 |
| `--muted` / superfícies | 6,19:1 | 6,86:1 |
| `--subtle` / superfícies | 4,99:1 | 4,67:1 |
| `--accent-text` / superfícies | 5,71:1 | 12,49:1 |
| Menor entre info, warning, danger e success / superfícies | 5,88:1 | 8,11:1 |
| `--control-border` / superfícies | 4,24:1 | 3,84:1 |
| `--focus` / superfícies | 5,47:1 | 12,49:1 |
| `--accent-ink` / `--accent` | 13,58:1 | 13,58:1 |
| `--accent-ink` / `--accent-hover` | 11,98:1 | 14,76:1 |
| `--selection-text` / `--selection` | 11,06:1 | 11,34:1 |

Esses pares passaram nos limiares de 4,5:1 para texto e 3:1 para borda/foco contra essas superfícies. São verificação dos tokens, não certificação da tela pronta. Recalcular combinações renderizadas, inclusive transparência, elementos sobre seleção, gráfico e erro; o contorno de foco precisa permanecer distinto das cores adjacentes.

- `--line` separa grupos decorativos; não identifica sozinho um campo ou controle necessário. Usar a borda de controle, rótulo ou outra indicação suficiente.
- Alvo de interação de 44 × 44px é regra de conforto deste produto, inclusive ícones e botões de linha; não é uma afirmação de mínimo universal WCAG AA.
- Toda função deve funcionar pelo teclado. Foco visível com contorno de 2px em `--focus` e afastamento de 3px sobre a superfície; não remover o foco nativo sem substituto equivalente.
- Campos possuem `label` persistente, ajuda e erro associados. Placeholder é exemplo, nunca substituto do rótulo; marcar “opcional” onde houver dúvida.
- Status combina palavra, símbolo e cor. “Aguardando confirmação” não depende de amarelo; valores negativos exibem sinal e descrição.
- Modal possui título acessível, foco contido e retorno ao acionador. Escape fecha preparação cancelável; despacho iniciado continua rastreável após fechar.
- Respeitar `prefers-reduced-motion`; dispensar transições de posição. Alterações de status usam anúncio discreto, sem reler a tabela inteira.
- Verificar zoom de 200%, teclado e leitor de tela nas jornadas críticas **nos dois temas**, inclusive seletor de tema e aniversariantes; campanhas apenas na etapa final; ferramenta automática sozinha não comprova acessibilidade.

## 4. Estrutura, navegação e componentes

Desktop: navegação lateral de 240px, barra superior de aproximadamente 64px e conteúdo com respiro de 24–32px. O menu contém as áreas autorizadas: visão geral, CRM, catálogo/estoque, vendas, financeiro, equipe/comissões, fiscal e configurações; campanhas entram apenas na etapa final T12. O mesmo layout atende Claro e Escuro. Não mostrar opção operável sem capacidade contratada ou permissão; indicar motivo no contexto quando a indisponibilidade precisa ser compreendida.

Cabeçalho da tela: título, ação primária e filtros pertinentes; descrição só quando resolve uma dúvida real. Usar rótulos curtos, respiro e divisórias discretas, sem cartões ou avisos repetindo informação da própria tela. Filtros aplicados ficam visíveis, com remoção e “Limpar filtros”; preservar busca ao abrir e voltar de um registro. Barra de ações em lote aparece só com seleção e informa quantidade e escopo exatos.

Construir somente componentes reutilizados pelas jornadas: botão, campo/erro, seletor, busca/filtro, badge, aviso persistente, tabela, diálogo, painel de detalhe e estrutura de página. Preferir controles HTML e semântica nativa; extrair composição compartilhada quando aparecer uso real. Não criar biblioteca genérica ou dependência só para aparência.

Tabelas: cabeçalhos claros, linhas com pelo menos 48px, separação sutil, hover discreto e ações com nome acessível. Clique na linha não substitui link/botão. Ordenação indica direção; seleção não muda quando o filtro amplia o conjunto. Identificador, situação e valor aparecem próximos, sem a pessoa precisar cruzar extremos da tela.

Formulários: uma coluna no celular e até duas quando a relação dos campos permitir; endereço e itens podem ocupar largura completa. Mostrar erro junto do campo e resumo no topo após tentativa inválida. Preservar o preenchimento recuperável sem guardar segredos no navegador; salvar rascunho é diferente de enviar comando financeiro ou fiscal.

## 5. Diretrizes por área

| Área | Organização e hierarquia | Proteção visível |
| --- | --- | --- |
| Visão geral | Resumo operacional e financeiro já previsto no escopo; período, fonte e instante de atualização junto dos números. Pendências acionáveis levam ao registro. | Sem metas, rankings, tendências ou KPIs inventados; dado indisponível aparece como indisponível. |
| Clientes/fornecedores | Lista pesquisável por nome/celular/documento autorizado; detalhe com papéis, responsável, histórico e dados progressivos. | Cliente e fornecedor podem ser a mesma pessoa; esse papel não concede direito de transferência. |
| CRM/pipeline | Colunas com etapa, quantidade e cartões compactos com nome, responsável e próximo contato. Abrir negociação mostra atividades e proposta vinculada. | Arrastar tem alternativa de menu “Mover para”; ganho comercial não vira pagamento, baixa de estoque ou emissão. |
| Campanhas — etapa final T12 | Público → mensagem com IA opcional → prévia/início; nome/telefone, origem, agenda, estado e contagens reais. Vendedor opera a carteira autorizada; proprietário, a loja. | Limite compartilhado fixo de 70 pessoas/dia; intervalo aleatório configurável, elegibilidade e interrupção seguem o escopo; aceite HTTP não é entrega. |
| Produtos | Foto limpa em proporção 4:3, nome/modelo, variante/SKU, preço e disponibilidade. Tela de edição separa cadastro, imagens e movimentos. | Quantidade inicial e entradas seguem o fluxo de estoque; não permitir editar saldo como número solto. |
| Estoque | Físico, reservado, disponível e localização identificados; unidades de bike com ID e série quando preenchida. Linha do tempo de entradas/saídas com motivo. | Custo ausente aparece “Não informado”; vendedor sem grant não recebe custo/margem nem por tooltip/exportação. |
| Registro de vendas | Lista de número, data, cliente, vendedora, produtos, total e situação comercial; filtros recolhíveis de período/responsável/produto/estados, busca e paginação. Abrir linha leva ao mesmo pedido com itens, condições e histórico. | Pagamento, entrega e nota separados; canceladas/devolvidas preservadas. SELLER não recebe custos, margem, taxas, split ou bancos. Referência comercial não parece número fiscal. |
| Venda/entrega | Itens e totais legíveis, desconto/alçada, proposta aceita, reserva e pagamento em blocos próximos, cada um com estado próprio. | Entrega bloqueada explica a pendência; o botão não sugere que comprovante enviado equivale a recebido. |
| Financeiro | Navegação separa caixa, contas a pagar/receber, despesas, conciliação e resultado. Período, regime e filtros acompanham o total. | Saldo disponível Asaas, previsto, bloqueado, transferido e saldo de banco externo não se misturam. |
| Equipe/comissões | Regra/vigência, funcionário, extrato e situação de previsão, reconhecimento, liberação e pagamento, conforme acesso de Vendedor/Proprietário. | Regra pendente aparece “Não configurada”; não mostrar zero como cálculo válido nem usar a regra do software como regra da equipe. |
| Fiscal | Lista, preparação por grupos, pendências, revisão completa e histórico; situação interna, oficial e arquivos são dimensões distintas. | Aprovação humana e clique final explícito; prévia não autorizada não se apresenta como nota autorizada. |

Catálogo aceita foto ausente com moldura neutra e texto; não usar imagem de outro modelo. Redimensionar imagens no armazenamento, definir dimensões e carregar sob demanda fora da primeira tela. Foto não deve deslocar preço ou botão durante o carregamento.

No financeiro, identificar o número com rótulo curto: “Caixa realizado”, “Resultado parcial” ou “Disponível no Asaas”. Exibir “Atualizado às…” e pendências de conciliação/completude quando pertinentes. Falha de atualização conserva o último dado conhecido com aviso e instante; não substitui por zero nem mantém selo “Em tempo real”.

Resultado usa receita, custo de mercadorias, despesas e resultado rastreáveis, conforme modelo financeiro. Tarifas e comissão do software entram nos cálculos corretos; sua composição nominal fica no extrato detalhado do proprietário, sem blocos explicativos nas telas diárias. Compra de estoque, retirada e pagamento de obrigação não ganham aparência de despesa nova por estarem no extrato. Gráfico é complementar; oferecer valores em tabela e nunca depender de hover para revelar o total.

O Kanban permite arrastar cards dentro/entre colunas e, para o proprietário autorizado, reordenar colunas. Mostrar alça, alvo e estado “Salvando”; persistência confirmada remove a pendência. Não usar sucesso antecipado, nem esconder erro de gravação. Esc/soltar fora cancela antes do envio. Falha conclusiva retorna à ordem confirmada; timeout e conflito reconsultam a origem sem perder filtros. Em filtros/paginação, mostrar a referência de posição e distinguir fim da página de fim da etapa. Alças de toque preservam rolagem; menu clicável de mover/posicionar e controles de teclado equivalentes preservam foco e anunciam a mudança. Respeitar movimento reduzido. Essas regras também valem para ordenar colunas.

Importação apresenta arquivo/esquema, contagens, prévia de mapeamento, progresso e exceções por campo, com acesso restrito. Cadastro histórico incompleto não aparece como cliente pronto para cobrança; estoque não informado não aparece como zero conferido. Mostrar pendências acionáveis e permitir resolver só as exceções. Navegação contato → negociação → proposta → pedido → financeiro/fiscal usa referências visíveis e volta ao contexto, sem abrir formulários vazios para dados já conhecidos.

### 5.1. Aniversariantes e envio diário automático na etapa final

No contato, “Aniversário” é opcional e recolhido nos detalhes: dia/mês e ano opcional. Campo vazio não gera alerta de cadastro incompleto. Lista “Aniversariantes” mostra Hoje, mês ou período visível, nome, dia/mês e celular permitido; sem idade inventada. SELLER só a carteira e OWNER a loja inteira. Sem número/data elegíveis, explicar a pendência de forma curta, sem informação financeira.

Na etapa final T12, o proprietário dispõe do interruptor geral **“Aniversário automático”** para a loja. Vendedor configura/ativa/pausa somente suas próprias regras e destinatários autorizados, subordinados ao interruptor geral; não altera regras de outro vendedor ou a configuração global. Mostrar de quem é a regra e se está ativa, pausada ou impedida pela configuração da loja, com deduplicação e limite diário compartilhados.

Configurar a regra uma vez: público, mensagem ou instrução de IA opcional, horário e intervalo; prévia permite conferir os textos e ativar. Depois de ativada explicitamente, a regra busca os aniversariantes elegíveis e executa diariamente, sem pedir aprovação manual a cada mensagem ou dia. Cadastro de aniversário sozinho não ativa envio. Lista mensal não significa envio de todos no mesmo dia: mostrar a ocorrência correta de cada pessoa; nome e dados conhecidos podem personalizar o texto, sem inventar idade ou benefício comercial.

Exibir vagas do dia e ocorrências pendentes. Aniversário fora de sua janela válida aparece **“Expirado” (`EXPIRED`)**, com motivo e data, em vez de transferir a felicitação automaticamente para amanhã; campanha comum adiada pelo limite aparece separadamente como “Próximo dia elegível”. Opt-out, data/número ausentes e 29/02 sem política aplicável são exclusões visíveis. Desligar/pausar bloqueia despachos ainda não iniciados, preserva histórico/auditoria e identifica os que já estavam em voo; não apresenta a ação como recolhimento de mensagem enviada. Sem cupom/regra de desconto automática por felicitação.

Não renderizar inbox vazio, botões de “Assumir IA”, chat/nota interna, configuração n8n ou novo agente. O atendimento atual continua fora do Ninebike. Esta remoção não muda os temas/controles de acesso, nem transforma suporte a disparos em migração do WhatsApp existente.

### 5.2. Campanhas simples, com personalização opcional

T12 permanece após o aceite do núcleo. Vendedor e proprietário usam **público → mensagem → prévia/início**, com uma ação primária por passo, sem criar um editor de automação. Escolher contatos da base disponibilizada pela conta WhatsApp conectada, dentro do acesso autorizado, ou do CRM. Lista mostra seleção, nome conhecido, telefone e origem **“CRM”** / **“WhatsApp conectado”** conforme evidência real; contato de canal não ganha nome, anotação ou cadastro CRM fictício. Mostrar origem indisponível/desatualizada quando aplicável, sem simular acesso à agenda completa do WhatsApp. Busca e seleção preservam contagens de elegíveis, excluídos e selecionados, com deduplicação.

Em “Mensagem”, oferecer texto base e interruptor **“Personalizar com IA”**; ligado, revela uma instrução curta para gerar um texto por destinatário usando somente nome e observações comerciais do CRM conhecidas e autorizadas para esse fim. Excluir notas privadas, dados sensíveis e instruções internas do contexto de geração; não revelar observações internas literalmente ao destinatário. Dados insuficientes não viram fatos inventados. A prévia mostra um exemplo representativo com nome/telefone e permite percorrer **cada mensagem gerada**; conteúdo indisponível ou falha de geração aparece como pendência, com texto base alternativo visível quando aplicável, nunca como personalização concluída. Sem contexto CRM suficiente, identificar a alternativa genérica na prévia. Iniciar aprova a revisão da campanha; não exigir cliques individuais para cada texto. Alterações materiais posteriores seguem a revisão do escopo.

Manter o intervalo em um único grupo **“Intervalo entre envios”**: resumo do padrão com a faixa aleatória mínima–máxima; “Ajustar” revela os dois limites avançados, com unidade e erro associado; não criar controles de automação adicionais. A agenda sorteia um intervalo dentro da faixa válida da campanha, sem prometer prevenção de bloqueio pelo canal. **Proposta de padrão de UX, ainda não confirmada pelo responsável:** IA desligada e faixa sugerida preenchida; valores numéricos do intervalo permanecem a definir/homologar, sem tratá-los como regra aprovada.

O limite **“70 pessoas por dia”** é fixo e não editável, compartilhado pela loja entre vendedores, campanhas comuns e aniversários. Mostrar “Vagas hoje”, reservas/pendências que ocupam capacidade, quantidade prevista hoje e restante no próximo dia elegível, conforme informação confirmada do servidor e fuso da loja. Intervalo não contorna o teto diário; aniversário que perdeu a janela continua Expirado. Prévia resume público, texto/IA, conta, programação, intervalo e capacidade antes de “Iniciar campanha” ou “Agendar”.

Acompanhamento mantém nome, estado e contagens reais de aguardando, enviadas, entregues, lidas e falhas quando disponíveis; entregues/lidas podem ser subconjuntos das enviadas, sem somá-las como destinatários novos. Estado desconhecido não vira zero. “Pausar”, “Retomar” e “Cancelar” dependem de permissão e confirmação: mostrar solicitação pendente/resultado incerto com referência para consulta. Enfileiramento ou aceite HTTP não comprovam envio, entrega ou leitura. Mostrar motivos de exclusão/adiamento/expiração sem textos de tarifas e sem recuperar inbox, chatbot ou configuração n8n.

## 6. Revisão fiscal e ações de dinheiro

Unificar a jornada dos dois programas na área Fiscal. Lista inicial enxuta: número/modelo, data, cliente/fornecedor, valor e situação, com busca e filtros progressivos; detalhe reúne itens, unidade/bike, observações pertinentes, vínculos, arquivos e linha do tempo. Não repetir toda a grade horizontal do legado. A coluna Situação fiscal não se chama Recebido: Autorizada pela SEFAZ é diferente de pagamento recebido.

Importação/transição tem três passos visíveis: Selecionar → Conferir → Confirmar incorporação. Arquivos ficam em quarentena na pré-análise; mostrar apenas pendências e resumo, com acesso a todos os campos relevantes. Botões descrevem o efeito: Salvar rascunho, Incorporar documento ou Emitir NF-e. A aprovação vincula arquivo/hash, revisão e mapeamentos; sem efeitos operacionais ocultos. Resultado parcial informa itens confirmados e pendentes. Vincular documento já autorizado não oferece segunda emissão da mesma operação; certificado inválido, origem incerta ou status sem prova têm explicação acionável.

**Divulgação progressiva:** telas diárias de CRM, venda, atendimento, campanha e visão financeira mostram o valor operacional necessário e ações curtas. Não exibir banner de taxas, rótulo de split, percentual de comissão do software ou texto ensinando a composição da cobrança. Em **Financeiro → Extrato → Detalhes**, somente o proprietário consulta a composição real, origem, valores e vínculos dos lançamentos, inclusive custos e comissão do software, quando precisar conciliá-los. Não mascarar custos como outra categoria, zerar deduções ou alterar totais para simplificar a apresentação. Cálculo e auditoria imutável preservam todos os componentes previstos no escopo, independentemente do tema ou da seção aberta.

A revisão fiscal usa a sequência de [fiscal.md, seção 4.1](fiscal.md): operação/emitente → destinatário → itens → tributos/totais → transporte → pagamento fiscal → complementares → revisão/aprovação → envio. Mostrar os valores e textos efetivamente congelados, inclusive derivados; não ocultar divergência em seção recolhida sem indicador.

Em desktop, permitir resumo e prévia lado a lado quando legíveis. No celular, alternar “Dados para revisão” e “Prévia” com navegação preservada; aprovação depende do conteúdo completo, não de rolar um PDF minúsculo. Lista de itens conserva sua ordem. Mudança relevante destaca a aprovação invalidada e exige revisão nova.

Prévia tem marca textual “Prévia — sem autorização fiscal”. DANFE/documento autorizado usa os artefatos e padrões do percurso homologado, com conferência tela/snapshot/XML/protocolo. Não redesenhar campos oficiais para combinar com o tema. Não usar impressão como gatilho de emissão, contas ou estoque.

Confirmação de estorno, saque ou evento fiscal apresenta alvo, valor/escopo, beneficiário/emitente, ambiente, consequência e revisão aprovada. Na ação financeira, deixar explícitos **valor solicitado, débito total, destino e valor líquido ao destino quando aplicável**, já com os custos reais incluídos. A tela pode ser concisa sem ocultar o impacto que a pessoa aprova; composição detalhada continua disponível ao proprietário no extrato. Diferença nos valores decisivos invalida a revisão anterior. Tributos e campos obrigatórios da revisão fiscal/documento oficial continuam completos. Exibir ação exata, sem botão genérico “OK”. Duplo clique fica bloqueado durante envio; a identidade durável e a permissão continuam sendo garantias do servidor.

Depois do envio, manter tela de acompanhamento com referência e resultado conhecido. Timeout exibe “Resultado ainda não confirmado” e opção de consultar, sem convidar a repetir. Toast “Enviado” não pode comunicar “Pago”, “Transferido”, “Autorizado” ou “Cancelado” antes da evidência oficial correspondente.

## 7. Estados obrigatórios dos componentes

| Estado | Comportamento de apresentação e recuperação |
| --- | --- |
| Carregando | Esqueleto leve ou texto de carregamento; manter contexto e tamanho reservado. Não piscar totais fictícios. |
| Vazio | Distinguir nenhum cadastro, filtro sem resultado e ausência de acesso. Oferecer próxima ação permitida e pertinente. |
| Erro de validação | Explicar o campo e a correção possível, preservar dados e levar foco ao resumo/primeiro erro. |
| Falha de serviço | Informar o que não foi atualizado, último instante conhecido e consulta segura; referência de suporte sem segredo técnico. |
| Pendente | Mostrar qual confirmação/aprovação/arquivo falta, origem e próxima ação autorizada. Pendente não é erro definitivo. |
| Incerto | Aviso persistente, operação identificada e repetição bloqueada; consulta/reconciliação sem criar outra intenção. |
| Bloqueado por permissão | Explicar a capacidade necessária quando útil; nenhuma fuga por atalho, URL, exportação ou ação em lote. |
| Sucesso confirmado | Mensagem corresponde ao fato persistido ou confirmado; histórico continua acessível sem depender de toast temporário. |

Desabilitar ação relevante sempre acompanha motivo legível, fora de tooltip inacessível. Avisos críticos não desaparecem por tempo. Atualização assíncrona não rouba foco, não altera linha selecionada silenciosamente e não troca o conteúdo já aprovado.

## 8. Telas pequenas, impressão e desempenho

Validar larguras de 360, 390, 768 e 1280px nos dois temas. Até 767px, menu lateral vira painel com foco controlado; formulários em coluna; filtros podem recolher com resumo visível. Em 768px, priorizar a tarefa e recolher navegação se faltar espaço. Em 1280px, usar o espaço para dados relacionados, sem esticar textos por toda a tela.

Não gerar rolagem horizontal da página. Tabela realmente larga tem contêiner próprio rotulado e acesso por teclado; ou vira lista de registros com rótulos explícitos. Preservar identidade, situação, valor, vencimento e ações críticas; campos complementares podem abrir no detalhe. Barra fixa não encobre teclado, erro, foco nem última linha.

Exportação e impressão usam fundo branco, tinta escura, cabeçalhos repetidos, moeda/unidade e quebra de página legível. PDF/DANFE oficial conserva padrão homologado. Documento provisório continua marcado como provisório também em impressão; filtros/período, emissão do relatório e situação de completude seguem visíveis.

Interface não deve esperar download de fonte, imagem decorativa ou animação para funcionar. Paginar consultas/listas conforme o contrato existente; não carregar toda a base para filtrar no cliente. Não introduzir virtualização, biblioteca de gráficos ou animações sem necessidade demonstrada na jornada.

## 9. Execução, referências futuras e acabamento

Aplicar estas instruções dentro das tarefas existentes: T01 monta estrutura/temas/tokens/controles e segurança de sessão; T02 CRM e contatos; T03 catálogo/estoque; T04 venda/entrega; T07 pagamentos; T10 financeiro/completude; T11 fiscal/revisão; T16 comissões. Campanhas seguem T12 somente na etapa final, sem tela de atendimento integrado em [tasks.md](tasks.md). Não criar um plano paralelo de redesenho que adie os fluxos necessários; este documento especifica o produto, sem declarar suas telas implementadas no portal.

Quando chegarem referências, registrar o que muda em paleta, tipografia, densidade, fotografia e composição; atualizar tokens e um fluxo representativo antes de propagar. Referência visual não muda contratos de dinheiro, autorização, unicidade, ordem fiscal homologada ou aprovação humana. Qualquer alteração funcional segue a revisão do escopo.

Antes de considerar uma tela concluída, exigir evidências proporcionais à sua função:

1. Mesmos tokens e componentes em Claro/Escuro, sem estilos locais contraditórios; hierarquia clara em lista, detalhe e formulário. Sistema acompanha o dispositivo; escolha explícita persiste sem dados sensíveis e sem perder contexto.
2. Jornada principal e estados vazio, erro, pendente e bloqueado demonstrados; incerto também nas operações financeiras/fiscais.
3. Larguras previstas, zoom de 200%, teclado/foco e leitor de tela conferidos nas jornadas críticas dos dois temas; nenhum controle essencial inacessível, inclusive seletor de tema e aniversariantes, e interrupção de campanha quando T12 existir.
4. Contrastes dos pares efetivamente renderizados verificados; não validar apenas o arquivo de tokens.
5. Revisão financeira/fiscal exibe todos os dados decisivos, invalida aprovação alterada e distingue envio de resultado confirmado.
6. Capturas e roteiros usam pessoas, documentos e valores fictícios claramente identificados; nenhum dado de cliente, funcionário, credencial ou nota real em evidências públicas.
7. Evidência registra tela, viewport, papel, estado, ação e resultado observado. “Não testado” permanece explícito; aprovação visual não substitui testes de regras e permissões.
8. Nas telas comuns, ausência dos banners/rótulos/textos de tarifas, split e comissão do software; no extrato do proprietário, composição verdadeira e rastreável. Aprovação sensível mantém valor solicitado, débito total, destino e líquido aplicável; vendedor não obtém detalhes restritos por rota, resposta da API ou exportação.
9. Aniversariantes demonstra carteira/data real ou desconhecida e filtros sem exigir ano; não envia ao salvar. Na etapa final T12, Vendedor/Proprietário demonstram o fluxo curto, fonte real do contato, nome/telefone, IA opcional por destinatário e prévia navegável sem expor notas privadas. Intervalo mínimo/máximo e teto compartilhado não editável de 70 pessoas/dia mostram vagas/adiamento; aniversário expirado tem motivo próprio. Regra de aniversário ativada uma vez executa diariamente sem aprovação repetida, respeita o interruptor geral do proprietário e o escopo do vendedor, pausa pendentes e preserva auditoria/estados reais. Nada de inbox, chatbot ou handoff IA; atendimento/n8n externos permanecem inalterados.

Aceite visual é condição adicional ao [aceite funcional](acceptance.md). Identidade final aguarda referências; regra de comissão da equipe, provedor/configuração/mapeamento fiscal e futura integração do outro software continuam nas pendências próprias, sem serem resolvidos por decisões de interface.
