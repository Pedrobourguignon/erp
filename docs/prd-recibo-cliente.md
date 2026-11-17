# Plano — Impressão de recibo para o cliente

- **Data:** 17/11/2026
- **Status:** fase 1 implementada em 17/11/2026 (seção 9); decisões na seção 8

## 1. O que existe hoje

- **Nenhuma impressão no sistema:** não há `window.print`, CSS de impressão nem biblioteca de PDF.
- **Venda no balcão:** ao finalizar, mostra o toast "Venda finalizada. Troco: R$ X" e abre o pedido.
- **O troco se perde.** Só o valor cobrado é gravado no pagamento; o valor que o cliente entregou
  não fica em lugar nenhum. Um recibo que mostre "Recebido R$ 100,00 · Troco R$ 12,50" precisa
  disso gravado.
- **Endereço e telefone da empresa já existiam** em Configurações › Empresa. (A primeira versão
  deste plano dizia o contrário; a leitura do schema tinha parado antes dessas colunas.)
- **O pedido já tem o que o corpo do recibo precisa:** número, data, vendedor, caixa, cliente,
  itens com desconto, frete e pagamentos com parcelas.

## 2. Recibo não é nota fiscal

O recibo é um **comprovante não fiscal**. Ele não substitui a NFC-e quando o lojista é obrigado a
emiti-la; a Sefaz cruza as vendas com os extratos de maquininha e PIX. Por isso:

- todo recibo traz, em destaque, **"NÃO É DOCUMENTO FISCAL"**;
- com o módulo Fiscal ativo e uma NFC-e autorizada, o balcão imprime o **DANFE NFC-e**, que já é
  o comprovante, e o recibo vira opcional;
- a mesma página de impressão térmica serve ao DANFE NFC-e da fase 2 do Fiscal, então o trabalho
  é aproveitado.

## 3. O que imprimir

| Documento | Quando | Conteúdo |
|---|---|---|
| **Recibo de venda** | ao finalizar no balcão e a qualquer momento no pedido | loja (nome, CNPJ, endereço, telefone); pedido, data e hora, vendedor e caixa; cliente (se houver); itens (qtd × preço, desconto, total); subtotal, descontos, frete e total; pagamentos ("Crédito 3x de R$ 100,00", "Dinheiro · recebido R$ 100,00 · troco R$ 12,50"); rodapé configurável (política de troca); "NÃO É DOCUMENTO FISCAL" |
| **2ª via** | reimpressão | o mesmo recibo com a marca "2ª VIA" e a data e hora da reimpressão |
| **Recibo de troca/devolução** | ao concluir um ajuste de item, e depois pela lista de ajustes do pedido | itens devolvidos e recebidos, diferença, reembolso e forma |

Recibo de pagamento de título (crediário) **fica fora** por decisão do usuário.

**Dados pessoais (LGPD):** o CPF/CNPJ só sai **quando está no cadastro do cliente** do pedido;
venda sem cliente, ou cliente sem documento, não mostra a linha. O CPF sai mascarado
(`***.456.789-**`); o CNPJ, que é dado de empresa, sai inteiro. Nada de endereço do cliente no
recibo.

## 4. Como imprimir

**HTML com CSS de impressão, sem PDF no servidor.** É o que funciona com qualquer impressora
instalada no computador, térmica ou comum:

- página própria `/imprimir/recibo/[pedido]`, fora do layout do painel (sem menu nem barra);
- três formatos com `@page`: **80 mm** (térmica padrão), **58 mm** (térmica pequena) e **A4**;
- impressão por um **iframe oculto**, para o vendedor não sair da tela de venda;
- configurações da página com margem zero; a instrução para desligar "cabeçalhos e rodapés" do
  navegador fica no guia de configuração (senão a URL e a data saem no papel).

**O diálogo de impressão do navegador aparece a cada recibo.** Para o computador do balcão, o
Chrome tem o modo `--kiosk-printing`, que imprime direto na impressora padrão sem perguntar.
É gratuito e só precisa de um atalho configurado na máquina. Fica documentado no guia.

**Fica para depois:** abrir a gaveta, cortar o papel e imprimir sem diálogo em qualquer máquina.
Isso exige mandar comandos ESC/POS direto para a impressora por um programa local (QZ Tray ou um
agente próprio). Só vale se o cliente pedir.

## 5. Arquitetura

**API**

- `GET /orders/:id/receipt` devolve um **DTO de recibo** pronto para imprimir: os dados da loja,
  o pedido, os itens, os pagamentos com o troco e o rodapé.
  - exige `orders:read`, a mesma permissão de ver o pedido. **O vendedor não precisa de
    `settings:read`** para ler o cabeçalho da loja; a resposta só traz o que vai no papel;
  - não traz custo, margem, IDs internos nem dados do cliente além do nome e do CPF mascarado;
  - é sempre filtrado pela empresa do token; um pedido de outra empresa responde 404;
  - dinheiro em centavos, somado com `money.util`, e o texto das parcelas sai de
    `splitInstallments`, o mesmo cálculo da venda.
- **Troco gravado:** um campo `amountTendered` no pagamento em dinheiro (o valor que o cliente
  entregou). O troco é calculado (`entregue − cobrado`), nunca guardado em separado, e o
  financeiro não muda, porque o troco já não era receita.
- **Contador de impressões:** `receiptPrintCount` no pedido e na troca, para marcar a 2ª via.
  Cada impressão grava no log de auditoria quem imprimiu qual via. Não vai para o histórico do
  pedido, porque ele só guarda mudanças de status.

**Configurações da empresa** (em Configurações › Geral)

- endereço, telefone e logo (o MinIO já existe), compartilhados com o Fiscal;
- **formato do recibo**: o lojista escolhe entre 80 mm, 58 mm e A4, conforme a impressora que
  usa (padrão 80 mm);
- texto do rodapé (ex.: política de troca).

**Web**

- componente `<Receipt>` puro: recebe o DTO e renderiza em qualquer formato;
- **a impressão só acontece quando o vendedor clica**:
  - "Imprimir recibo" na confirmação da venda do balcão e na página do pedido;
  - "Imprimir comprovante" ao concluir uma troca/devolução e em cada ajuste da lista.

## 6. Fases

| Fase | Entrega | Tamanho |
|---|---|---|
| **1. Recibos de venda e troca** | dados da loja e formato (80 mm, 58 mm, A4) em Configurações › Geral; troco gravado; endpoints dos dois recibos; página de impressão nos três formatos; botões no balcão, no pedido e na troca; 2ª via; guia do `--kiosk-printing` | M |
| **2. Logo e envio sem papel** | logo da loja; "Enviar por WhatsApp" e e-mail, com link assinado e com validade (o cliente abre sem login, e o link expira) — só se pedirem | P |
| **3. Gaveta e impressão silenciosa** | ESC/POS por programa local (abrir gaveta, guilhotina) — só se pedirem | M |

## 7. Testes

- **API:**
  - DTO com valores exatos (`toBe`, nunca `toBeCloseTo`): total, desconto rateado, R$ 100,00
    em 3x como "2x de R$ 33,33 + 1x de R$ 33,34", troco;
  - vendedor sem `settings:read` consegue imprimir;
  - empresa B recebe 404;
  - a resposta não traz custo, IDs nem CPF completo.
- **Web:**
  - `<Receipt>` mostra "NÃO É DOCUMENTO FISCAL", os itens, o troco e "2ª VIA" quando
    reimpresso;
  - o formato escolhido aplica o `@page` certo;
  - nome de produto de 255 caracteres sem espaço quebra a linha em vez de vazar no papel de 58 mm.
- **E2E**, conferindo o efeito em outra tela, como manda a regra:
  - vender no balcão com dinheiro acima do total e abrir o recibo: mostra o valor recebido e o
    troco;
  - reimprimir pelo pedido: o servidor conta a via e o papel sai com "2ª VIA".
  - trocar um item e imprimir o comprovante: mostra o item devolvido, o recebido e a diferença
    que o pedido registrou;
  - cliente sem documento: o recibo não tem a linha de CPF; com CPF: aparece mascarado.

## 8. Decisões (17/11/2026)

1. **Recibos:** venda e troca/devolução. Pagamento de título fica fora.
2. **Impressora:** o lojista escolhe o formato nas configurações, entre 80 mm, 58 mm e A4.
3. **Impressão:** só quando o vendedor clica. Não há impressão automática.
4. **CPF/CNPJ:** só quando está no cadastro do cliente do pedido.

## 9. Fase 1 implementada (17/11/2026)

- **Configurações › Recibo:** papel da impressora (80 mm, 58 mm ou A4) e rodapé
  (`Tenant.receiptFormat`, `Tenant.receiptFooter`).
- **Troco gravado:** `OrderPayment.amountTendered`, só em dinheiro e nunca abaixo do cobrado.
  O balcão envia o valor quando houve troco.
- **API:**
  - `POST /orders/:id/receipt` e `POST /orders/:id/adjustments/:adjustmentId/receipt`, com a
    permissão `orders:read`;
  - cada chamada emite uma via, por isso é POST;
  - pedido cancelado não tem recibo (400).
- **Web:**
  - botão "Imprimir recibo" no cabeçalho do pedido, para onde o balcão leva ao finalizar;
  - "Imprimir comprovante" em cada troca da lista;
  - a impressão sai por um iframe oculto, com o `@page` do formato.
- **Guia de instalação:** `docs/guia-impressao-recibo.md`, com o `--kiosk-printing`.
- **E2E:** `e2e/recibo.spec.ts` (RC-01 a RC-03).

**Encontrado e corrigido durante a fase:** no balcão, com uma linha só de pagamento, o campo
"Valor Recebido" voltava sozinho para o total a cada tecla que deixava o valor abaixo dele. Só
dava para acrescentar dígitos (R$ 100,00 → R$ 1.000,00). Agora a linha só acompanha o total
quando o carrinho ou o número de linhas muda. O rótulo do campo passou a apontar para ele com
`htmlFor`.

## Fontes

- Cupom de 80 mm pelo navegador (`@page`, cabeçalhos do navegador, iframe oculto): <https://free-invoice-generator-504.pages.dev/blog/how-to-print-80mm-thermal-receipt-from-browser>
- MDN — impressão com CSS: <https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Printing>
- QZ Tray como ponte navegador–impressora: <https://ajuda.cardapioweb.com/gestao/impressora/pedidos-nao-imprimem-o-que-fazer>
- ESC/POS direto na porta da impressora (ACBrLibPosPrinter): <https://projetoacbr.com.br/pro/downloads/acbrlibposprinter/>
- Venda ao consumidor exige documento fiscal; o DANFE NFC-e sai em impressora comum: <https://jornalcontabil.com.br/noticia/usar-nfc-e-ou-nf-e-na-venda-presencial-evite-a-rejeicao-que-trava-seu-faturamento/amp/>, <https://focusnfe.com.br/blog/nfce/>
