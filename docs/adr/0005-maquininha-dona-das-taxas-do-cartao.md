# ADR 0005 — A maquininha é a dona das taxas e dos prazos do cartão

- **Status:** aceita
- **Data:** 2026-11-17
- **Substitui:** em parte o ADR 0002 (o prazo e a taxa do cartão deixam de ser da forma de pagamento)

## Contexto

A forma de pagamento guardava uma taxa única (`feePercentage`) e um prazo (`settlementDays`).
No cartão isso não fecha com a realidade da operadora:

- a taxa do crédito muda com o número de parcelas (à vista, 2–6x, 7–12x — ou uma por parcela);
- o crédito é recebido parcela a parcela (a cada 30 dias) **ou** antecipado (tudo de uma vez,
  com taxa maior);
- duas formas de pagamento (débito e crédito) são, na prática, o mesmo contrato.

O ADR 0002 já tinha deixado o gatilho anotado: taxa diferente por parcela é o momento de criar a
entidade da operadora. Pesquisamos Bling (uma forma de pagamento **por parcela** para ter taxas
diferentes), Omie e Conta Azul (taxa acertada à mão na baixa ou na conciliação), Linx e PDVs
(plano de pagamento por operadora e faixa de parcelas).

## Decisão

1. **Nova entidade `CardMachine`** ("Maquininha" na tela). Representa o **contrato** com a
   operadora, não o aparelho: duas máquinas do mesmo contrato são um cadastro só.
   - Débito: taxa e prazo em dias (`0` = cai na hora).
   - Crédito: modo de recebimento (`FLOW` parcela a parcela, `ANTICIPATED` tudo de uma vez),
     prazo (1º repasse ou repasse total) e **tabela de taxas por número de parcelas**
     (`CardMachineRate`), sem buracos de 1x até o máximo.
2. **A taxa cadastrada é a total** de cada número de parcelas, como o app da maquininha mostra
   (já inclui a antecipação). "Taxa da venda + % ao mês de antecipação" fica para depois, sem
   mudar o que já foi cadastrado.
3. **Taxa única por maquininha** — sem diferenciar bandeira por enquanto. O modelo aceita uma
   coluna de bandeira na tabela de taxas no futuro.
4. **Crédito e débito exigem uma maquininha ativa**, vinculada à mão na forma de pagamento.
   Neles a forma de pagamento perde taxa, prazo e máximo de parcelas; continua com conta
   vinculada, baixa automática, autorização e código fiscal. **Boleto, PIX, transferência etc.
   continuam com taxa e prazo no próprio método.**
5. **Um cálculo só**: `planCardReceivables` (`@erp/validators`) recebe a maquininha, o número de
   parcelas e o valor e devolve os títulos (valor e prazo) e a taxa de cada um. A API grava
   exatamente isso; a tela de venda usa o mesmo prazo na prévia.
   - Crédito no fluxo em N vezes: N títulos (prazo, prazo+30, …) e **N taxas**, uma por parcela,
     rateadas em centavos e vencendo junto com ela.
   - Crédito antecipado: 1 título com o valor inteiro e 1 taxa, no prazo.
   - Débito: 1 título e 1 taxa; com prazo 0 o título nasce pago e a conta é creditada na venda.
6. O máximo de parcelas oferecido na venda é a maior linha da tabela da maquininha. A API de
   formas de pagamento já devolve esse número, então quem vende não precisa ler a maquininha
   (`financial:read`) — e não vê as taxas do contrato.

## Consequências

- A migration cria uma maquininha por forma de pagamento de cartão existente, com as mesmas taxas
  e prazos de antes; no dia do deploy nada muda, exceto que as **vendas novas parceladas** passam a
  ter uma taxa por parcela em vez de uma só. O lojista junta as maquininhas do mesmo contrato depois.
- As colunas `feePercentage`, `settlementDays` e `maxInstallments` continuam existindo (servem aos
  métodos que não são cartão); nos de cartão elas são zeradas na edição e ignoradas no cálculo.
- A tela de condições de pagamento já tinha saído da venda (as parcelas são escolhidas na linha
  de pagamento); a API ainda aceita `paymentConditionId` por compatibilidade.
- Fica para depois: taxa por bandeira, "MDR + % ao mês" com cálculo, antecipação avulsa,
  conciliação com o extrato da operadora, integração direta (TEF/API) — esta última se encaixa
  na §16.2 da ARQUITETURA (integração externa instável).
- O mesmo núcleo (recebível de um intermediário + taxa como conta a pagar) servirá aos
  marketplaces, mas **o cadastro não**: a taxa do marketplace vem da API dele, pedido a pedido.
