# Plano — Módulos Fiscal e Contabilidade

- **Data:** 17/11/2026
- **Status:** proposta; emissão direta na Sefaz decidida (3.4); faltam as decisões 1, 2 e 4 da seção 9
- **Motivo:** um cliente precisa emitir nota fiscal e mandar os documentos à contabilidade.

## 1. O que o mercado faz

| ERP | Emissão | Regras de imposto | Contabilidade |
|---|---|---|---|
| **Bling** | NF-e, NFC-e e NFS-e a partir do pedido | **Natureza de operação**: cada uma tem regras de ICMS/IPI/PIS/COFINS e, desde a reforma, o "de-para" de IBS/CBS (CST + cClassTrib). A regra pode valer para um produto ou um grupo de produtos | "Meu Contador": compartilha documentos e relatórios, com envio programado |
| **Omie** | NF-e, NFC-e, NFS-e | por produto e operação | **Painel do Contador**: gera lançamentos contábeis em mais de 80 layouts (Domínio, Contmatic, Fortes…) e integra por API com a Domínio (Onvio), SCI, Fortes e outros |
| **Conta Azul** | NF-e, NFS-e | por produto/serviço | **Contador convidado** vê lançamentos e notas; captura notas emitidas e recebidas direto da Sefaz e das prefeituras (certificado A1); exporta para mais de 25 sistemas contábeis, com envio automático para Domínio, SCI e Alterdata. Tem plano em que o escritório opera tudo (BPO) |

Padrões que se repetem:

1. **Ninguém fala direto com cada Sefaz e cada prefeitura** num ERP deste porte. Ou usam um
   provedor de API fiscal, ou mantêm uma equipe só para isso. O motivo: são 27 Sefaz, milhares de
   prefeituras, certificado, contingência e uma nota técnica nova a cada poucos meses.
2. **A regra de imposto vive na natureza de operação**, não no produto. O produto guarda a
   classificação (NCM, CEST, origem); a operação (venda, devolução, bonificação…) decide CFOP,
   CST/CSOSN e alíquotas.
3. **O contador é um usuário de fora** com acesso restrito, e o valor está em **não precisar pedir
   nada ao lojista**: o XML do mês e os lançamentos chegam sozinhos.

## 2. O calendário que manda no plano

- **IBS/CBS na NF-e e na NFC-e (NT 2025.002):** o regime normal já é obrigado desde 03/08/2026.
  A rejeição automática 1115 ("IBS/CBS não informado") está suspensa por ato da RFB/CGIBS.
  **Simples Nacional e MEI ficam obrigados a partir de 01/01/2027.** Portanto **o módulo já nasce
  com o grupo IBS/CBS**; fazer sem ele seria construir algo vencido em seis semanas.
- **NFS-e padrão nacional:** é obrigatória para ME/EPP do Simples desde 01/09/2026, e os
  municípios estão migrando para o emissor nacional. Isso facilita muito a NFS-e, porque passa a
  ser um padrão só em vez de um por prefeitura.

Datas e versões das notas técnicas mudam com frequência. Confirmar no Portal da NF-e e com o
Portal da NF-e antes de cada fase.

## 3. Arquitetura

### 3.1 Dois módulos, dois itens do plano

| Módulo | Chave | O que faz | Sem ele |
|---|---|---|---|
| **Fiscal** | `fiscal` | emite, cancela e corrige notas; guarda XML e DANFE; mostra as notas recebidas | as telas fiscais somem e o produto não pede os campos fiscais (já previsto na §5 da ARQUITETURA) |
| **Contabilidade** | `accounting` | dá acesso ao contador, envia o fechamento do mês e exporta lançamentos | o lojista baixa os XMLs à mão na tela do Fiscal |

**Contabilidade depende de Fiscal** para enviar notas, mas a exportação de lançamentos
financeiros funciona sem ele. Um cliente pode ter Fiscal sem Contabilidade, ou os dois.

**Pré-requisito: o controle de módulos contratados ainda não existe.** O token não leva
`modules`, e o plano hoje é o enum `TenantPlan` (TRIAL/STARTER…), sem guard. Proposta mínima,
compatível com o passo 7 do roteiro:

- tabela `tenant_modules (tenantId, module, enabledAt, expiresAt)`, que a platform passa a ser
  dona quando existir;
- um guard `@RequireModule('fiscal')` no servidor, que responde 403 com "Seu plano não inclui o
  módulo Fiscal";
- a lista de módulos ativos vai na sessão, para o menu esconder o que não está no plano;
- a chave do módulo fica em `@erp/constants`, ao lado das permissões.

### 3.2 Onde mora

**Módulo do `erp-api`**, conforme a §16.1. As chamadas à Sefaz rodam
**em fila** (BullMQ, que já existe), o que tira da API o risco de "integração externa instável"
(§16.2). Um ADR registra esse ponto.

```
modules/fiscal/
├── fiscal.module.ts / fiscal.service.ts   porta de entrada pública
├── fiscal.controller.ts                   @RequireModule('fiscal') + fiscal:*
├── providers/                             FiscalProvider (interface) + adaptador (NFeWizard)
├── tax/                                   motor de impostos: natureza + regras → valores por item
├── use-cases/                             emitir, cancelar, carta de correção, inutilizar, consultar
├── jobs/                                  envio/consulta à Sefaz em fila, teste noturno em homologação
└── events/                                escuta order.*, emite invoice.authorized / cancelled
modules/accounting/
├── fechamento mensal, acesso do contador, exportadores de layout
```

### 3.3 Dono de cada dado

- **A nota é do Fiscal.** Ela guarda uma **cópia** (snapshot) do emitente, do destinatário, dos
  itens e dos impostos do momento da emissão. Se o cadastro mudar depois, a nota não muda.
- O Fiscal lê pedido, cliente e produto **pelos serviços** desses módulos, sem `include` que
  atravesse a fronteira. A relação `Invoice.order` que hoje existe no Prisma passa a ser só
  `orderId`.
- Pedido e financeiro **não mudam** por causa da nota. A nota não cria título; quem cria é a
  venda. O pedido só recebe o evento `invoice.authorized` e mostra "Faturado (NF 123)".

### 3.4 Provedor de emissão

Uma interface `FiscalProvider` (emitir, consultar, cancelar, CC-e, inutilizar, DANFE, certificado)
e um adaptador por biblioteca ou provedor, para que a troca não toque no resto do módulo.

**Decisão (17/11/2026): emitir direto na Sefaz, sem provedor pago.** Os webservices da NF-e e da
NFC-e e a API da NFS-e nacional são gratuitos; o único custo obrigatório é o certificado A1, que é
do lojista.

O primeiro adaptador usa uma biblioteca Node open source: **NFeWizard** (`nfewizard-io`), que
cobre NF-e, NFC-e, eventos, distribuição DF-e e NFS-e. Alternativas, se ela falhar: `node-dfe`,
ACBrMonitor num container ao lado (TCP) ou sped-nfe (PHP) como serviço. A NFS-e no padrão nacional
pode chamar a API do emissor nacional direto.

**Antes de assumir a fase 1, um teste de 2 a 3 dias em homologação na UF do cliente** precisa
passar:

- emitir uma NF-e com o grupo IBS/CBS;
- cancelar e fazer uma carta de correção;
- inutilizar uma numeração;
- gerar o DANFE;
- se houver balcão, emitir uma NFC-e com QR Code/CSC.

Se a biblioteca falhar em algo essencial, o plano B é um provedor pago (Focus NFe é a referência:
cerca de R$ 90/mês com 100 documentos e R$ 0,10 por nota extra; Nuvem Fiscal, PlugNotas e NFE.io
também servem), entrando como outro adaptador.

Emitir direto põe sob nossa responsabilidade o que o provedor faria:

- assinatura XML (xmldsig) e validação nos schemas;
- o endereço do webservice de cada UF;
- a contingência (SVC-AN/SVC-RS e NFC-e offline);
- o DANFE;
- **acompanhar cada nota técnica** no Portal da NF-e. A da reforma tributária mudou várias vezes
  em 2026; um job no CI noturno emitindo em homologação avisa quando algo quebra.

**Certificado A1 (fica com a gente):**

- o `.pfx` e a senha ficam **criptografados** (AES-256-GCM), com a chave em variável de ambiente
  e nunca no banco;
- são lidos só pelo módulo Fiscal, no momento de assinar, e nunca vão para log nem para resposta
  de API;
- aviso de vencimento 30 e 7 dias antes;
- a decisão vira um ADR de segurança.

### 3.5 Motor de impostos

O mesmo modelo dos outros ERPs, aproveitando o `TaxRule` que já existe no schema:

- **Natureza de operação** (`FiscalOperation`): nome, tipo (saída/entrada), finalidade (normal,
  devolução, complementar, ajuste), modelo de nota, CFOP dentro e fora do estado, consumidor
  final, informações complementares padrão. Vem com as mais comuns prontas: Venda, Venda
  balcão, Devolução de venda, Bonificação e Remessa.
- **Regras da natureza** (`TaxRule`, ampliado): valem para todos os produtos, para um grupo, para
  um NCM ou para uma UF de destino, com prioridade. Cada regra traz CST/CSOSN, alíquotas
  (ICMS, ST/MVA, FCP, IPI, PIS, COFINS), cBenef e **IBS/CBS (CST + cClassTrib)**.
- **Simples Nacional primeiro:** é o que quase todo lojista pequeno é. CSOSN 101/102/500, PIS e
  COFINS sem destaque, crédito de ICMS quando houver. O **regime normal** funciona com regras
  digitadas pelo contador. O cálculo automático de ST e DIFAL a partir de tabelas fica para depois.
- **Simular antes de emitir:** `POST /fiscal/invoices/preview` mostra os impostos de cada item,
  para o lojista (ou o contador) conferir.

### 3.6 Ciclo da nota

```
RASCUNHO → PROCESSANDO → AUTORIZADA → (CANCELADA | corrigida por CC-e)
                     ↘ REJEITADA (motivo da Sefaz em pt-BR, botão "corrigir e reenviar")
                     ↘ CONTINGÊNCIA (NFC-e offline) → AUTORIZADA ao voltar
```

- **A numeração é nossa:** um índice único em `(tenantId, modelo, série, número)` e o próximo
  número tirado com lock. Um buraco na numeração gera inutilização com um clique.
- **Emissão assíncrona:** a tela mostra "Enviando para a Sefaz…"; um job na fila envia o lote e
  consulta o recibo até a Sefaz responder, com retentativa e contingência quando ela cai.
- **XML e PDF** guardados no MinIO (que já existe), **por 5 anos**, o prazo legal.
- **Ambiente** por empresa: homologação para os testes e produção depois que o lojista conferir.
  As notas de homologação ficam marcadas e nunca vão para o contador.

## 4. O que falta nos cadastros

| Onde | Campo | Para quê |
|---|---|---|
| Empresa | código IBGE do município, IE, IM, CNAE, CRT, série padrão, CSC/ID token da NFC-e | emitente da nota (endereço, telefone e `taxRegime` já existem no `Tenant`) |
| Cliente | IE, indicador de IE (contribuinte, isento, não contribuinte), código IBGE no endereço | destinatário |
| Produto | origem da mercadoria (0–8), unidade comercial e tributável, grupo fiscal, cBenef, cClassTrib | itens da nota (NCM, CEST, CFOP e EAN já existem e já são validados) |
| Forma de pagamento | `fiscalCode` (tPag) já existe; falta validar contra a tabela da Sefaz | grupo de pagamento da nota |
| `InvoiceItem` | quantidade decimal (hoje é `Int`), grupo IBS/CBS, ST, FCP, origem, unidade | layout atual |

Os campos novos no produto e no cliente só aparecem com o módulo Fiscal ativo.

## 5. Contabilidade: os dois tipos de plano

| | Sem Contabilidade | Com Contabilidade |
|---|---|---|
| XML das notas | o lojista baixa um ZIP por período na tela do Fiscal | **enviado automaticamente** todo dia X ao e-mail do contador, com link para baixar |
| Acesso do contador | não tem | **papel Contador** (já existe na §6.4): vê notas, financeiro e relatórios, só leitura e exportação, com validade |
| Fechamento do mês | não tem | um pacote com XMLs emitidos (autorizados, cancelados, CC-e, inutilizações), XMLs de entrada (compras), vendas por CFOP/CST, faturamento para o DAS e resumo financeiro; o contador marca "recebido/fechado" |
| Lançamentos contábeis | não tem | **de-para** das categorias financeiras e contas para o plano de contas do escritório, exportado em CSV genérico e no layout da Domínio (TXT); depois, API da Domínio (Onvio) e outros layouts sob demanda |
| Notas recebidas | importa o XML à mão (já existe em Compras) | captura automática pela distribuição DF-e da Sefaz, com manifestação do destinatário, alimentando Compras |

## 6. Fases

Os tamanhos são relativos (P, M, G) e assumem uma pessoa com o mesmo ritmo das últimas entregas.

| Fase | Entrega | Tamanho |
|---|---|---|
| **0. Fundamentos** | módulos contratados + guard; dados fiscais da empresa, do cliente e do produto; teste da NFeWizard em homologação + ADR; certificado A1 criptografado com aviso de vencimento; homologação ligada | M |
| **1. NF-e de venda** | naturezas e regras (Simples primeiro, já com IBS/CBS); simulação; "Emitir NF-e" no pedido; fila e webhook; DANFE e XML; e-mail ao cliente; cancelamento, CC-e e inutilização; lista de notas com filtros | G |
| **2. NFC-e no balcão** | emissão ao concluir a venda (automática ou por botão, configurável); CSC; contingência offline; DANFE NFC-e para impressora térmica (80 mm) | M |
| **3. Contabilidade** | papel Contador com escopo e validade; envio automático do mês; pacote de fechamento; de-para do plano de contas; exportação CSV e Domínio | M |
| **4. Devolução e troca** | NF-e de devolução referenciando a nota original, ligada ao fluxo de troca e devolução que já existe; nota complementar | M |
| **5. NFS-e** (se o cliente vende serviço) | padrão nacional; cadastro de serviço (código de tributação nacional, ISS) | M |
| **6. Notas recebidas** | distribuição DF-e + manifestação; entrada em Compras sem upload | M |
| **7. Regime normal completo** | ST/MVA e DIFAL por tabela, FCP por UF, relatórios de apuração | G |

**Mínimo para o cliente que pediu:** fases 0 e 1, mais a 2 se ele vende no balcão e a 3 se ele
contratar Contabilidade.

## 7. Testes

- **Motor de impostos:** testes de tabela (`it.each`) por regime, CSOSN/CST, UF de origem e
  destino, com valores exatos em centavos. É onde mora o risco de multa.
- **Provedor:** testes do adaptador contra respostas gravadas do sandbox (autorizada, rejeitada,
  contingência) e um teste de contrato rodando contra a homologação no CI noturno.
- **E2E:** emitir uma NF-e em homologação a partir de um pedido e conferir em outra tela, como
  manda a regra do projeto: o pedido fica "Faturado", a nota aparece na lista com chave de 44
  dígitos e o XML baixa. Para o Contabilidade: o pacote do mês contém essa nota.
- **Isolamento:** a empresa A nunca vê nem numera notas da empresa B, e um módulo não contratado
  responde 403 mesmo para o Dono.

## 8. Riscos

- **Responsabilidade fiscal:** imposto errado é multa para o lojista. Mitigação: começar pelo
  Simples, ter o contador do cliente validando as naturezas em homologação antes de virar a chave,
  e não prometer cálculo automático de ST na primeira versão.
- **Mudança de layout:** a reforma tributária publica notas técnicas a cada poucos meses. Sem
  provedor, somos nós que atualizamos a biblioteca e os schemas; o teste noturno em homologação
  avisa antes do cliente.
- **Dependência de biblioteca de uma pessoa só:** a interface `FiscalProvider` permite trocar
  por outra biblioteca ou por um provedor pago sem mexer no resto.
- **Vazamento do certificado:** permite assinar notas em nome do cliente. Por isso a
  criptografia, a chave fora do banco e o acesso restrito ao módulo (3.4).
- **Certificado vencido trava a emissão:** aviso 30 e 7 dias antes, e bloqueio com mensagem clara.

## 9. Decisões que preciso de você

1. **Que notas o cliente precisa emitir** (NF-e, NFC-e no balcão, NFS-e)? Qual é o **regime
   tributário** dele e de qual **UF**?
2. **"Plano com contabilidade"** quer dizer: (a) o lojista tem o próprio contador e o módulo
   automatiza a troca com ele (é o que este plano assume); ou (b) a HubScale vende a contabilidade
   junto, com um escritório parceiro operando um painel de várias empresas (como o Conta Azul
   BPO)? A (b) acrescenta um painel multiempresa do escritório.
3. ~~Provedor~~ — **decidido em 17/11/2026:** emitir direto, sem provedor pago (3.4).
4. **NFC-e no balcão:** emitir automaticamente toda venda ou só quando o vendedor pedir?

## Fontes

- Bling — naturezas de operação, regras de tributação e IBS/CBS: <https://ajuda.bling.com.br/hc/pt-br/articles/15921613163927>, <https://ajuda.bling.com.br/hc/pt-br/articles/35705278410775>
- Omie — Painel do Contador e layouts contábeis: <https://www.omie.com.br/funcionalidades/painel-do-contador/>, <https://ajuda.omie.com.br/pt-BR/articles/1852450-passo-3-integracao-contabil-a-layout-e-sistema-contabil>, <https://ajuda.omie.com.br/pt-BR/articles/12051153-configurando-a-integracao-com-a-dominio-via-api>
- Conta Azul — conexão com o contador e captura de notas: <https://contaazul.com/funcionalidades/conexao-contador/>, <https://contaazul.com/contadores/buscador-de-notas-fiscais/>
- NT 2025.002 (IBS/CBS) e rejeição 1115: <https://blog.tecnospeed.com.br/nota-tecnica-reforma-tributaria-nfe-nfce/>, <https://taxcel.com.br/ibs-cbs-nota-fiscal-2026-obrigatorio-rejeicao>, <https://blog.nfemais.com.br/ibs-cbs-nota-fiscal/>
- NFS-e padrão nacional: <https://simplifique.contmatic.com.br/blogs/nfse-nacional-obrigatoria-setembro-2026>, <https://fenacon.org.br/reforma-tributaria/nota-fiscal-de-servico-eletronica-nfs-e-sera-obrigatoria-a-partir-de-janeiro-de-2026/>
- Provedores e preços: <https://focusnfe.com.br/precos/>, <https://www.notaas.com.br/blog/post/comparativo-apis-emissao-nfe-nfse-nfce/>
