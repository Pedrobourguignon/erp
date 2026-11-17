# ADR 0002 — Baixa automática no prazo de liquidação da forma de pagamento

- **Status:** aceita — prazo e taxa do cartão substituídos pelo [ADR 0005](0005-maquininha-dona-das-taxas-do-cartao.md)
- **Data:** 2026-11-12

## Contexto

O lojista combina com a operadora da maquininha em quantos dias o dinheiro cai
(inclusive um prazo antecipado). A forma de pagamento já guardava esse prazo em
`settlementDays` ("Liquidação (dias)") e a taxa em `feePercentage`, e o título a
receber já nasce vencendo nesse dia. Mas a baixa era sempre manual: o título ficava
em aberto até alguém dar baixa.

Chegamos a modelar a antecipação como um campo à parte (`anticipationDays`, mais uma
taxa própria). Foi descartado: o prazo antecipado é só um valor de `settlementDays`,
e duplicar o campo criava dois caminhos para o mesmo efeito.

## Decisão

1. **O prazo é `settlementDays`.** Para antecipar, o lojista põe nele os dias
   combinados. Nenhum campo novo de prazo.
2. **`autoSettle` (novo, na forma de pagamento): um job diário (06:00, fuso do
   lojista) baixa sozinho** os títulos vencidos da forma — o recebível e a taxa da
   operadora —, usando o mesmo `FinancialSettlementsService.settle` da baixa manual.
   A baixa leva a data de vencimento, não a do dia em que o job rodou.
3. **A API recusa a baixa automática sem conta financeira vinculada**, avaliando o
   método *resultante* da edição: sem conta, a baixa falharia em silêncio todo dia.
4. **A taxa de antecipação fica para depois.** Por ora vale só a taxa do cadastro.

## Consequências

- A baixa manual e a automática são o mesmo caminho de código; estornar continua igual.
- Se a baixa de um título falhar (conta removida, por exemplo), o job registra um
  aviso e segue; o título continua em aberto na tela.
- O prazo `settlementDays` vale para um pagamento à vista no cartão (1x). Numa venda
  parcelada, as parcelas seguem o intervalo da condição de pagamento, não o prazo da
  forma.
- A baixa automática não espelha o valor na gaveta de um caixa aberto (não há usuário
  na baixa do job); isso só importa quando a conta da forma é a de um caixa.
- Quando entrar a taxa de antecipação, se a operadora cobrar valores diferentes por
  parcela ou bandeira, o próximo passo é a entidade "operadora" — esse é o gatilho para
  criá-la (ARQUITETURA §14).
