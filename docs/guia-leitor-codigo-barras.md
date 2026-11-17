# Guia — Leitor de código de barras no balcão

Para quem instala o sistema na loja.

## 1. Qual leitor

Qualquer leitor que funcione como **teclado** (modo HID / "USB keyboard"), USB ou sem fio com
receptor USB. Não precisa de driver nem de programa.

| Tipo | Lê | Quando |
|---|---|---|
| **1D (laser ou CCD)** | código de barras comum (EAN-13, EAN-8, Code 128) | o mais barato |
| **2D (imager)** — recomendado | o anterior + QR Code, inclusive na tela do celular | lê etiqueta amassada e de qualquer ângulo |
| **De mesa** | igual ao 2D, sem pegar na mão | caixa com muito movimento |

Leitores Bluetooth funcionam se estiverem no modo **teclado (HID)**.

## 2. Configurar o leitor

O manual do leitor traz páginas de códigos de configuração; leia com o próprio leitor:

- **Sufixo Enter** (CR / "Carriage Return") depois de cada leitura. A maioria já vem assim.
- **Teclado ABNT2** (ou "Brazil") quando houver letras no código. Com o layout errado, um SKU com
  letras sai trocado; códigos só com números (EAN) não são afetados.

Teste: abra o Bloco de Notas e leia uma etiqueta. Tem de aparecer o número inteiro e o cursor
pular para a linha de baixo.

## 3. No sistema

1. Cadastre o **código de barras (EAN)** no produto — ou em cada tamanho/cor, quando o produto
   tem variações. A etiqueta da camiseta M é a da variação M.
2. Na **Venda no Balcão**, é só ler. Não precisa clicar na busca: a leitura entra no carrinho
   **com o cursor em qualquer campo**, sem mexer no que estava digitado nele.
3. Ler o mesmo item de novo soma 1 na quantidade. Outro tamanho do mesmo produto entra em outra
   linha.
4. Etiqueta do produto "pai" (sem tamanho) abre a escolha do tamanho/cor; **Enter** escolhe o
   primeiro, **Tab** passa para o próximo.
5. Código não cadastrado: aparece o aviso em vermelho embaixo da busca, com um bipe grave. O
   carrinho não muda.

O som do leitor (bipe agudo ao adicionar, grave no erro) pode ser desligado em **Som do leitor**,
no painel de atalhos à direita. A escolha vale para aquele computador.

## 4. Outras telas

- **Nova Venda (pedido):** igual ao balcão.
- **Troca no pedido:** com o diálogo de troca aberto, leia a etiqueta do que o cliente vai levar.
  Em "Outro tamanho/cor" só vale etiqueta do mesmo produto; para trocar por outro produto, escolha
  "Outro produto" e leia.
- **Estoque › Movimentações:** com o formulário aberto, leia a etiqueta para escolher produto e
  tamanho. Produto com tamanhos só movimenta estoque com o tamanho escolhido.
- **Produtos:** se aparecer o aviso "códigos de barras repetidos", abra cada cadastro da lista e
  deixe o código em um só.

## 5. Problemas comuns

| O que acontece | O que fazer |
|---|---|
| Nada acontece ao ler | teste no Bloco de Notas; se lá também não sai nada, é o leitor ou o cabo |
| Sai o número mas não entra no carrinho | o leitor está sem o **sufixo Enter**: configure pelo manual |
| "Nenhum produto com o código …" | cadastre o EAN no produto ou na variação |
| "O código … está em mais de um produto" | dois cadastros com o mesmo EAN: corrija um deles |
| Letras trocadas no código | configure o leitor para teclado ABNT2 |
| Leitor sem fio às vezes não lê o código inteiro | aproxime do receptor ou troque a bateria |
