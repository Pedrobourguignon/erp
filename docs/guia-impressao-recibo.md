# Guia — Configurar a impressão do recibo

Para quem instala o sistema na loja. O recibo é impresso pelo navegador em qualquer impressora
instalada no computador, térmica ou comum.

## 1. Escolher o papel no sistema

Em **Configurações › Recibo**, escolha a impressora que a loja usa:

| Opção | Para |
|---|---|
| **Térmica 80 mm** (padrão) | impressora de cupom comum (bobina de 80 mm) |
| **Térmica 58 mm** | impressora de cupom pequena ou portátil |
| **Folha A4** | impressora comum |

No mesmo lugar fica o **rodapé** (ex.: política de troca), impresso no fim de todo recibo.

O recibo usa o **nome, CNPJ, endereço e telefone** de **Configurações › Empresa**; confira se
estão preenchidos.

## 2. Instalar a impressora no computador

Instale o driver da impressora térmica (Elgin, Bematech, Epson, Tanca…) como uma impressora
normal do Windows ou do macOS e imprima uma página de teste pelo sistema operacional.

No driver da térmica, ajuste o **tamanho do papel** para a bobina (80 × 297 mm ou "Roll Paper
80 mm"; 58 mm na pequena). Sem isso, o driver pode imprimir em "A4" e cortar o recibo.

## 3. Primeira impressão

1. Abra um pedido e clique em **Imprimir recibo**.
2. No diálogo de impressão do navegador:
   - **Destino:** a impressora da loja.
   - **Margens:** "Nenhuma" (térmica) ou "Padrão" (A4).
   - **Cabeçalhos e rodapés: desligado.** Ligado, o navegador imprime a data e o endereço da
     página por cima do recibo.
3. O Chrome guarda essas escolhas para as próximas impressões.

## 4. Imprimir sem o diálogo (computador do balcão)

O Chrome pode imprimir direto na **impressora padrão**, sem abrir o diálogo, com o modo
`--kiosk-printing`. Use só no computador do balcão, com a térmica definida como impressora
padrão do sistema.

**Windows**

1. Crie um atalho do Chrome na área de trabalho.
2. Botão direito › **Propriedades** › campo **Destino**. No fim, depois das aspas, acrescente:
   ```
    --kiosk-printing
   ```
   Fica assim:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing`
3. Feche **todas** as janelas do Chrome e abra pelo atalho novo. (Se o Chrome já estiver aberto,
   a opção não vale.)

**macOS**

```
open -na "Google Chrome" --args --kiosk-printing
```

Com o modo ligado, **Imprimir recibo** sai direto na impressora padrão. Para escolher outra
impressora, abra o Chrome sem o atalho.

## 5. Problemas comuns

| O que acontece | O que fazer |
|---|---|
| Sai a data e o endereço da página no papel | desligue **Cabeçalhos e rodapés** no diálogo |
| O recibo sai cortado ou muito pequeno | confira o papel em **Configurações › Recibo** e o tamanho do papel no driver |
| Sai uma folha em branco no fim (térmica) | ajuste o papel do driver para bobina contínua (altura automática) |
| O recibo não tem endereço da loja | preencha o endereço em **Configurações › Empresa** |
| Saiu "2ª VIA" | é uma reimpressão: o sistema conta cada recibo emitido do mesmo pedido |

O recibo é um **comprovante não fiscal** e diz isso no papel. Ele não substitui a nota fiscal
(NFC-e) quando a loja é obrigada a emiti-la.
