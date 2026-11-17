import { BadRequestException } from '@nestjs/common';

import { NFE_ACCESS_KEY, NFE_XML } from './nfe-fixture';
import { parseNfeXml } from './nfe-parser';

describe('parseNfeXml', () => {
  const nfe = () => parseNfeXml(NFE_XML);

  it('reads the access key, number, series and issue date', () => {
    expect(nfe()).toMatchObject({
      accessKey: NFE_ACCESS_KEY,
      number: '1234',
      series: '1',
      // o dia da emissão como o emitente o escreveu (BRT), sem conversão de fuso
      issuedDate: '2026-11-10',
    });
  });

  it('reads the issuer (the supplier), keeping the CNPJ as digits', () => {
    expect(nfe().issuer).toMatchObject({
      document: '11222333000181',
      name: 'DISTRIBUIDORA MODA LTDA',
      tradeName: 'Moda Atacado',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01001000',
      phone: '1133334444',
    });
  });

  it('reads each item with its codes, quantity and money in cents', () => {
    const [first, second] = nfe().items;

    expect(first).toMatchObject({
      line: 1,
      code: 'CAL-001',
      ean: '7891234567895',
      description: 'CALCINHA ALGODAO TRADICIONAL M',
      ncm: '61081100',
      unit: 'UN',
      quantity: 10,
      grossCents: 8500,
      discountCents: 500,
      ipiCents: 400,
      stCents: 0,
    });
    expect(second).toMatchObject({ line: 2, code: 'CAM-777', quantity: 5, grossCents: 10000, stCents: 600 });
  });

  it('treats "SEM GTIN" as no EAN', () => {
    expect(nfe().items[1].ean).toBeNull();
  });

  it('reads the invoice totals in cents', () => {
    expect(nfe().totals).toEqual({
      productsCents: 18500,
      freightCents: 1850,
      insuranceCents: 0,
      discountCents: 500,
      otherCents: 0,
      ipiCents: 400,
      stCents: 600,
      invoiceCents: 20850,
    });
  });

  it('reads the installments (duplicatas)', () => {
    expect(nfe().installments).toEqual([
      { number: '001', dueDate: '2026-12-10', amountCents: 10425 },
      { number: '002', dueDate: '2027-01-09', amountCents: 10425 },
    ]);
  });

  it('accepts a single item and an invoice without installments', () => {
    const xml = NFE_XML
      .replace(/<det nItem="2">[\s\S]*?<\/det>/, '')
      .replace(/<cobr>[\s\S]*?<\/cobr>/, '');

    const parsed = parseNfeXml(xml);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.installments).toEqual([]);
  });

  it('accepts a bare <NFe> without the nfeProc envelope', () => {
    const bare = NFE_XML.replace(/<\/?nfeProc[^>]*>/g, '');

    expect(parseNfeXml(bare).accessKey).toBe(NFE_ACCESS_KEY);
  });

  it('keeps a fractional quantity so the caller can flag it', () => {
    const xml = NFE_XML.replace('<qCom>10.0000</qCom>', '<qCom>2.5000</qCom>');

    expect(parseNfeXml(xml).items[0].quantity).toBe(2.5);
  });

  it.each([
    ['text that is not XML', 'isto não é xml'],
    ['an XML that is not an NF-e', '<?xml version="1.0"?><pedido><item/></pedido>'],
    ['an empty file', ''],
    ['a cancellation event', '<procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>'],
  ])('refuses %s, in Portuguese', (_label, xml) => {
    expect(() => parseNfeXml(xml)).toThrow(BadRequestException);
    expect(() => parseNfeXml(xml)).toThrow(/NF-e/);
  });

  it('refuses an invoice with no items', () => {
    const xml = NFE_XML.replace(/<det nItem="\d">[\s\S]*?<\/det>/g, '');

    expect(() => parseNfeXml(xml)).toThrow('A nota não tem itens.');
  });

  it('refuses an access key that is not 44 digits', () => {
    const xml = NFE_XML.replace(`Id="NFe${NFE_ACCESS_KEY}"`, 'Id="NFe123"');

    expect(() => parseNfeXml(xml)).toThrow(/chave de acesso/i);
  });
});
