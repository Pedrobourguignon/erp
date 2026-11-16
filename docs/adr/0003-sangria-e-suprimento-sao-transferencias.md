# ADR 0003 — Sangria, suprimento e fundo de abertura são transferências entre a gaveta e outra conta

- **Status:** aceita
- **Data:** 2026-11-15

## Contexto

A conta financeira de um caixa é a gaveta: o dinheiro só muda de lugar e nunca é
criado nem destruído. A abertura compara o valor declarado com o saldo que a conta
já tem, e o fechamento transfere o excedente para uma conta de destino.

Três operações quebravam essa regra:

- a **sangria** só debitava a gaveta. Os R$ 500 levados ao cofre saíam do caixa e não
  entravam em lugar nenhum;
- o **suprimento** só creditava a gaveta. Os R$ 200 de troco nasciam do nada, e o
  cofre de onde eles saíram continuava acusando o valor antigo;
- a **abertura** creditava do nada o que o operador declarava acima do saldo da conta
  (o "suprimento de abertura").

Nos três casos o saldo total da empresa mudava sem venda nem despesa que explicasse,
e uma diferença entre a gaveta e o cofre não aparecia em conferência nenhuma.

Em ERP com financeiro integrado, sangria e suprimento são transferências: gaveta →
cofre/tesouraria/banco e o caminho inverso. Pagar algo com dinheiro da gaveta é
**despesa**, e receber um pagamento em dinheiro é **receita**. Essas duas são outra
operação, com categoria e DRE.

## Decisão

1. **Sangria e suprimento são transferências** (`applyTransfer`, a mesma função do
   fechamento). A sangria leva da gaveta para a conta de destino; o suprimento leva da
   conta de origem para a gaveta. Cada uma acontece numa transação só.
2. **A outra conta é obrigatória.** Ela vem da requisição (`destinationAccountId` na
   sangria, `sourceAccountId` no suprimento) ou, se ela não trouxer, do **cofre do
   caixa** (`CashRegister.vaultAccountId`), que vale para os dois sentidos e é
   configurável. Sem nenhum dos dois, a API recusa.
3. **A outra conta precisa ser da empresa do token, ativa, não excluída e diferente
   da própria gaveta.** A mesma trava vale no cadastro e na edição do cofre, venha a
   mudança do lado da gaveta ou do lado do cofre.
4. **A origem do suprimento segue a regra da transferência manual:** uma conta do tipo
   Caixa (o cofre) não fica negativa. Uma conta bancária pode, porque o saldo do banco
   no sistema costuma estar atrasado em relação ao extrato até a conciliação.
5. **O movimento da gaveta guarda a outra conta e a transferência**
   (`CashRegisterMovement.counterpartAccountId` e `transferId`, que é o `referenceId`
   das duas `FinancialTransaction`).
6. **A abertura traz do cofre só o que falta.** O fundo declarado que já está na conta
   da gaveta não se move. O excedente é transferido da conta de origem (`sourceAccountId`
   na abertura ou o cofre do caixa) para a gaveta, com a mesma regra de saldo do item 4.
   Ele não vira movimento de suprimento na sessão, porque já está no `openingBalance`;
   registrar como movimento contaria o mesmo dinheiro duas vezes. Abrir declarando
   exatamente o saldo da conta não pede origem nenhuma.
7. **Pagamento e recebimento em dinheiro não são sangria nem suprimento.** Eles
   continuam sendo título + baixa pela conta do caixa (`mirrorSettlementInDrawer`), que
   já registra o movimento na gaveta. Não há um segundo mecanismo para o mesmo efeito.

## Consequências

- Sangria e suprimento não alteram o saldo total da empresa. O cofre vira uma conta
  conferível.
- A tela do caixa só chama de "Sangria"/"Suprimento" o movimento que tem a outra
  conta. Um movimento sem ela aparece como "Saída"/"Entrada": é baixa feita pelo caixa
  ou registro anterior a esta decisão.
- Os movimentos antigos continuam como estavam. Não há como saber, depois do fato, de
  onde veio ou para onde foi aquele dinheiro, então nada foi migrado.
- O lojista precisa ter uma conta de cofre (ou usar o banco). O onboarding ainda não
  cria essa conta.
- Fora a venda e a baixa de títulos, só uma coisa ainda cria ou destrói dinheiro na gaveta:
  a **sobra ou falta contada no fechamento**. Ali isso é correto, porque é a diferença
  real entre o que o sistema esperava e o que estava na gaveta.
