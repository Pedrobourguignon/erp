# Plano — Leitor de código de barras no balcão

- **Data:** 17/11/2026
- **Status:** fases 1 a 3 implementadas em 17–18/11/2026 (seção 9)

## 1. Como o leitor funciona

O leitor de código de barras comum (USB ou sem fio com receptor USB) se apresenta ao computador
como um **teclado** (modo HID). Ao ler uma etiqueta, ele "digita" os números muito rápido e
aperta **Enter** no fim. Por isso:

- **não precisa de driver nem de programa no computador**, e o navegador recebe o código como
  se alguém tivesse digitado;
- funciona em Windows, macOS e Linux, em qualquer navegador;
- o código vai para **onde o cursor estiver**. Esse é o ponto que o sistema precisa tratar.

Modos que **não** vamos usar: serial/COM (exigiria Web Serial ou um programa local, sem ganho
para o balcão) e Bluetooth no modo SPP (mesmo motivo). Leitores Bluetooth em modo **teclado
(HID)** funcionam como os USB.

### Qual leitor comprar (orientação para o lojista)

| Tipo | Lê | Quando |
|---|---|---|
| **1D (laser ou CCD)** | código de barras comum (EAN-13, EAN-8, Code 128) | o mais barato; atende quem só vende produto com etiqueta de barras |
| **2D (imager)** | o anterior + QR Code, inclusive na tela do celular | recomendado: lê etiqueta amassada, de qualquer ângulo, e serve para QR de cupom/troca no futuro |
| **De mesa (omnidirecional)** | igual ao 2D, sem pegar na mão | caixa com muito movimento |

**Configuração do leitor (vem no manual, lendo códigos de configuração):**

- sufixo **Enter** (CR) depois de cada leitura — a maioria já vem assim;
- **teclado ABNT2** quando houver letras no código. Com o layout errado, um SKU com letras sai
  trocado; números puros (EAN) não são afetados.

## 2. O que o balcão já faz

- Com a busca de produtos aberta (F2), o **Enter do leitor escolhe a primeira opção**, sem
  esperar os 300 ms da busca (VD-18).
- A lista continua aberta e o campo volta limpo e focado, então leituras seguidas não pedem
  clique.
- O mesmo produto lido duas vezes **soma quantidade**.

## 3. Problemas a resolver

1. **A leitura pode pegar o produto errado.** O Enter escolhe o primeiro resultado de uma
   busca por **trecho** de nome, SKU, EAN **ou descrição**. Um código que aparece dentro do EAN
   ou da descrição de outro produto pode levar esse outro produto. Leitura precisa ser
   **correspondência exata**.
2. **O código só funciona com a busca aberta.** Se o cursor estiver na quantidade, no desconto
   ou no valor do pagamento, os números do código são digitados ali e o Enter pode até enviar
   o formulário.
3. **Variações não funcionam no balcão.** O carrinho não guarda `variantId`, e o EAN da
   variação nem é procurado. Ler a etiqueta de uma camiseta M coloca no carrinho o produto pai
   com quantidade vazia e R$ 0,00 (problema já observado). Em loja de roupa, a etiqueta é
   justamente a da variação.
4. **O EAN não é único.** Há só um índice `(tenantId, ean)` no produto e nenhum na variação.
   Dois cadastros com o mesmo código tornam a leitura ambígua.
5. **Sem retorno claro.** Código não cadastrado cai numa lista vazia, sem som e sem mensagem.
   No balcão, o operador está olhando o cliente e o produto, não a tela.

## 4. Como fica

### 4.1 Busca exata pelo código

`GET /products/lookup?code=7891234567895` (permissão `products:read`, que o vendedor já tem):

- procura, nesta ordem e **só por igualdade**:
  1. EAN da variação ativa;
  2. EAN do produto (produto sem variações);
  3. SKU da variação;
  4. SKU do produto;
- devolve um único `{ product, variant | null, price, available }`, ou 404 com
  "Nenhum produto com o código 7891234567895";
- produto pai de variações lido pelo SKU do pai: 409 com "Escolha o tamanho/cor de …",
  e a tela abre a escolha da variação;
- o código é normalizado antes (sem espaços; EAN só dígitos).

### 4.2 Leitura em qualquer lugar da tela do balcão

Um ouvinte de teclado na página reconhece a **rajada do leitor**:

- caracteres chegando a menos de ~30 ms um do outro, com pelo menos 6 caracteres, terminando
  em Enter;
- uma pessoa não digita nesse ritmo. O intervalo é configurável, porque leitores sem fio
  podem ser um pouco mais lentos;
- reconhecida a rajada, o código vai para a busca exata (4.1), **mesmo que o cursor esteja em
  outro campo**: o texto digitado ali é desfeito e o Enter não envia o formulário;
- digitação humana segue normal em todos os campos.

A busca por nome (F2) continua existindo para quem procura sem etiqueta.

### 4.3 Variações no carrinho

- O item do carrinho passa a ter `variantId` e o nome com a variação ("Camiseta Básica — M").
- A mesma variação lida de novo soma quantidade; outra variação do mesmo produto vira outra
  linha.
- Preço e estoque vêm da variação quando ela tem preço próprio.
- A conferência de estoque antes de finalizar (VD-21) passa a olhar a variação.
- Ao escolher pela busca por nome um produto com variações, abre a escolha de tamanho/cor, em
  vez de entrar no carrinho com quantidade vazia (corrige o problema 3).

### 4.4 Retorno para o operador

- **Som:** um bipe curto de sucesso e um tom grave de erro (Web Audio, sem arquivo), com
  opção de desligar.
- **Visual:** a linha adicionada ou somada pisca; o erro aparece num aviso fixo perto do
  carrinho com o código lido ("Código 7891234567895 não cadastrado"), que não some sozinho
  antes da próxima leitura.

### 4.5 Código único

- Cadastro e edição de produto e variação recusam um EAN que já existe em outro produto ou
  variação da mesma empresa, com "O código 789… já está em Camiseta Básica — M".
- Índice único no banco por empresa. Antes de criar o índice, uma consulta lista os EANs
  repetidos de hoje para o lojista resolver; a migration só entra depois disso.
- O EAN continua validado pelo dígito verificador (`isValidGTIN`).

## 5. Onde mais o leitor ajuda (fases seguintes)

| Tela | Uso |
|---|---|
| **Cadastro de produto/variação** | ler a etiqueta preenche o EAN (já funciona, porque o campo recebe o texto; falta só a checagem de duplicidade) |
| **Novo pedido** | o mesmo fluxo do balcão |
| **Troca/devolução** | ler a etiqueta do item novo na troca |
| **Estoque** (entrada, inventário, conferência da nota de compra) | contar lendo |

## 6. Fases

| Fase | Entrega | Tamanho |
|---|---|---|
| **1. Leitura confiável no balcão** | busca exata (4.1); rajada reconhecida em qualquer campo (4.2); variações no carrinho (4.3); som e aviso (4.4); guia do leitor para o lojista. **Só a tela do balcão.** | M |
| **2. Código único** | levantamento dos repetidos; checagem no cadastro; índice único (4.5) | P |
| **3. Outras telas** | novo pedido, troca, estoque (seção 5) | M |
| **Fora do plano** | etiqueta de balança (código que começa com 2, com peso ou preço embutido): exige quantidade com casas decimais, e hoje a quantidade do pedido é inteira. Decidido: não entra. Multiplicador `3*`: decidido que não entra | — |

## 7. Testes

- **API:** busca exata com testes de tabela:
  - EAN de variação vence o do produto;
  - trecho de código nunca encontra nada;
  - código de outra empresa responde 404;
  - produto pai pelo SKU responde 409;
  - produto inativo não aparece.
- **Web:** o reconhecedor de rajada é uma função pura, testada com sequências de teclas e
  tempos:
  - leitor a 5 ms por tecla é reconhecido;
  - pessoa a 150 ms por tecla não é;
  - código curto não é;
  - Enter sem rajada não é.
- **E2E (Playwright digita com `delay` de poucos ms, como o leitor):**
  - com o cursor no campo de desconto, ler um EAN adiciona o produto e o desconto continua
    como estava;
  - ler a etiqueta da variação M adiciona "— M", e finalizar a venda baixa o estoque **da
    variação M** (efeito conferido na outra tela);
  - código desconhecido mostra o aviso e não altera o carrinho.

## 8. Decisões (17/11/2026)

1. **Código não cadastrado:** só avisar ("Código … não cadastrado"). Sem cadastro rápido.
2. **Multiplicador** `3*`: não entra. A quantidade se ajusta na linha do carrinho.
3. **Balança:** não entra.
4. **Escopo da fase 1:** só o balcão. Novo pedido, troca e estoque ficam para a fase 3.

## 9. O que foi feito (17–18/11/2026)

**Fase 1 — balcão**
- `GET /products/lookup?code=` faz a busca exata, nesta ordem: EAN da variação, EAN do produto,
  SKU da variação, SKU do produto.
  - Código desconhecido responde **200 com `kind: "NOT_FOUND"`**, não 404. É um resultado normal
    da leitura, e o navegador registraria um erro a cada etiqueta desconhecida.
  - Dois cadastros no mesmo código respondem 409, com os nomes.
  - `?productId=&variantId=` atualiza preço e estoque de uma linha do carrinho.
- A leitura é reconhecida em qualquer campo pelo ritmo das teclas (`lib/barcode-burst.ts`):
  - média de até 30 ms por tecla, tolerando uma pausa isolada de até 100 ms;
  - mínimo de 6 caracteres, e **8 quando o código só tem números** (EAN-8), para que um pedaço
    de leitura não passe por um código;
  - o tempo usado é o do momento em que a tecla foi gerada (`event.timeStamp`);
  - nenhuma tecla é segurada: o campo em foco volta ao valor de antes quando a leitura é
    reconhecida, no Enter.
- O carrinho guarda a variação. A variação aparece num selo que nunca é cortado. Um produto com
  variações abre a escolha de tamanho/cor, e isso corrigiu o item "pai" com R$ 0,00.
- Som de acerto e de erro, com opção "Som do leitor" (por computador). O aviso de erro fica fixo
  embaixo da busca.
- Guia de instalação: `docs/guia-leitor-codigo-barras.md`.

**Fase 2 — EAN único**
- `common/barcodes/barcode-uniqueness.ts` recusa o código repetido em todos os caminhos que
  gravam EAN:
  - cadastro e edição do produto;
  - variações, que agora também ficam só com dígitos;
  - importação por planilha;
  - entrada de nota de compra.
- `GET /products/barcode-duplicates` e o aviso "códigos de barras repetidos" na lista de
  produtos, com link para cada cadastro.
- Índice único `products(tenantId, ean)` (parcial). A migration **só cria o índice se não houver
  repetidos**; se houver, o deploy segue e o aviso mostra o que corrigir.
  - A variação não tem `tenantId`, então a unicidade entre produto e variação fica no serviço.
  - No banco local havia 1 repetido real, então o índice não foi criado ali.

**Fase 3 — outras telas**
- **Novo pedido:** igual ao balcão (variação no pedido, escolha de tamanho, aviso, som).
- **Troca:**
  - ler a etiqueta preenche o produto e o tamanho novos, e o campo mostra o nome lido;
  - "Outro tamanho" recusa etiqueta de outro produto e indica usar "Outro produto";
  - ler a mesma variação que o cliente devolve também é recusado.
- **Estoque** (entrada, saída, transferência e ajuste):
  - os formulários **não tinham escolha de variação**, então movimentar um produto com tamanhos
    criava saldo fora de qualquer tamanho;
  - agora há o campo Tamanho/cor, obrigatório quando o produto tem variações, e a etiqueta
    preenche produto e tamanho;
  - o saldo atual do ajuste é o da variação escolhida.

**Testes e2e:** `leitor-balcao`, `leitor-pedido-troca`, `leitor-estoque` e `ean-unico`.
- A leitura é simulada como o hardware faz: todas as teclas de uma vez, caindo no campo em foco.
- A digitação do Playwright envia cada tecla só depois que a página processa a anterior, e
  partia a leitura quando a página estava ocupada. Um leitor real não faz isso.

