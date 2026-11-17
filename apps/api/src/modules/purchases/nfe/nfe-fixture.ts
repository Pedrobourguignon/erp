/**
 * NF-e de exemplo para os testes: dois itens, frete e desconto, IPI no item 1,
 * ICMS-ST no item 2 e duas duplicatas. vNF = 185 − 5 + 6 + 18,50 + 4 = 208,50.
 */
export const NFE_ACCESS_KEY = '35261111222333000181550010000012341000012349';

export const NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${NFE_ACCESS_KEY}" versao="4.00">
      <ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-11-10T14:30:00-03:00</dhEmi></ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>DISTRIBUIDORA MODA LTDA</xNome>
        <xFant>Moda Atacado</xFant>
        <enderEmit><xLgr>Rua das Flores</xLgr><nro>10</nro><xMun>São Paulo</xMun><UF>SP</UF><CEP>01001000</CEP><fone>1133334444</fone></enderEmit>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>CAL-001</cProd><cEAN>7891234567895</cEAN><xProd>CALCINHA ALGODAO TRADICIONAL M</xProd>
          <NCM>61081100</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>10.0000</qCom>
          <vUnCom>8.5000000000</vUnCom><vProd>85.00</vProd><cEANTrib>7891234567895</cEANTrib><vDesc>5.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>10.00</vICMS></ICMS00></ICMS>
          <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vIPI>4.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <cProd>CAM-777</cProd><cEAN>SEM GTIN</cEAN><xProd>CAMISETA BASICA GOLA V P</xProd>
          <NCM>61091000</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>5.0000</qCom>
          <vUnCom>20.0000000000</vUnCom><vProd>100.00</vProd><cEANTrib>SEM GTIN</cEANTrib>
        </prod>
        <imposto>
          <ICMS><ICMS10><orig>0</orig><CST>10</CST><vICMSST>6.00</vICMSST></ICMS10></ICMS>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vProd>185.00</vProd><vFrete>18.50</vFrete><vSeg>0.00</vSeg><vDesc>5.00</vDesc>
          <vOutro>0.00</vOutro><vIPI>4.00</vIPI><vST>6.00</vST><vNF>208.50</vNF>
        </ICMSTot>
      </total>
      <cobr>
        <dup><nDup>001</nDup><dVenc>2026-12-10</dVenc><vDup>104.25</vDup></dup>
        <dup><nDup>002</nDup><dVenc>2027-01-09</dVenc><vDup>104.25</vDup></dup>
      </cobr>
    </infNFe>
  </NFe>
</nfeProc>`;
