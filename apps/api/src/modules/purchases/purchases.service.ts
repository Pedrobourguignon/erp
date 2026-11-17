import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { onlyDigits } from '@erp/validators';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import {
  startOfDayInTz,
  toLocalDateKey,
} from '../../common/utils/date-range.util';
import { formatBRL, fromCents } from '../../common/utils/money.util';
import { InventoryService } from '../inventory/inventory.service';
import { CreateMovementDto } from '../inventory/dto/inventory.dto';
import { ConfirmReceiptDto, ReceiptItemDecisionDto } from './dto/receipt.dto';
import {
  computeLandedCosts,
  type LandedCost,
} from './nfe/landed-cost';
import { parseNfeXml, type NfeItem, type ParsedNfe } from './nfe/nfe-parser';
import {
  matchItem,
  type CatalogEntry,
  type ItemMatch,
  type KnownCode,
} from './nfe/product-matcher';
import { assertBarcodesFree } from '../../common/barcodes/barcode-uniqueness';

const FINANCIAL_PERMISSION = 'financial:create';

export interface ReceiptPreview {
  nfe: {
    accessKey: string;
    number: string;
    series: string;
    issuedDate: string;
    totalAmount: number;
    productsAmount: number;
    freight: number;
    discount: number;
  };
  supplier: {
    id: string | null;
    document: string;
    name: string;
    tradeName: string | null;
  };
  alreadyImported: { id: string; receivedAt: string } | null;
  items: {
    line: number;
    code: string;
    ean: string | null;
    description: string;
    ncm: string | null;
    unit: string;
    quantity: number;
    wholeQuantity: boolean;
    listUnitPrice: number;
    unitCost: number;
    totalCost: number;
    costBreakdown: Record<
      'gross' | 'discount' | 'freight' | 'insurance' | 'other' | 'ipi' | 'st',
      number
    >;
    match: ItemMatch;
  }[];
  installments: { number: string; dueDate: string; amount: number }[];
  warnings: string[];
}

export interface ReceiptResult {
  receiptId: string;
  totalAmount: number;
  itemsReceived: number;
  productsCreated: number;
  payablesCreated: number;
}

interface PlannedItem {
  decision: ReceiptItemDecisionDto;
  item: NfeItem;
  quantity: number;
  unitCost: number;
  totalCents: number;
}

const digitsOrNull = (value?: string | null): string | null => {
  const digits = onlyDigits(value ?? '');
  return digits === '' ? null : digits;
};

/** `YYYY-MM-DD` que existe de verdade (2026-02-31 não). */
function isRealDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

function formatDayBR(instant: Date): string {
  const [y, m, d] = toLocalDateKey(instant).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Entrada de mercadoria por nota fiscal (NF-e) — ADR 0004.
 *
 * Duas etapas, de propósito: `previewReceipt` só lê e sugere; nada é gravado
 * até o lojista confirmar item por item (vincular a um produto, criar um novo ou
 * ignorar). `confirmReceipt` então faz tudo numa transação — produtos novos,
 * entradas no estoque, a nota e as contas a pagar — ou nada.
 */
@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // ─── Etapa 1: ler e sugerir ───────────────────────────────────────────

  async previewReceipt(tenantId: string, xml: string): Promise<ReceiptPreview> {
    const nfe = parseNfeXml(xml);
    const costs = computeLandedCosts(nfe);

    const [imported, supplier] = await Promise.all([
      this.prisma.goodsReceipt.findFirst({
        where: { tenantId, accessKey: nfe.accessKey },
        select: { id: true, createdAt: true },
      }),
      this.findSupplier(tenantId, nfe.issuer.document),
    ]);

    const [catalog, known] = await Promise.all([
      this.loadCatalog(tenantId),
      this.loadKnownCodes(tenantId, supplier?.id ?? null),
    ]);

    return {
      nfe: {
        accessKey: nfe.accessKey,
        number: nfe.number,
        series: nfe.series,
        issuedDate: nfe.issuedDate,
        totalAmount: fromCents(nfe.totals.invoiceCents),
        productsAmount: fromCents(nfe.totals.productsCents),
        freight: fromCents(nfe.totals.freightCents),
        discount: fromCents(nfe.totals.discountCents),
      },
      supplier: {
        id: supplier?.id ?? null,
        document: nfe.issuer.document,
        name: nfe.issuer.name,
        tradeName: nfe.issuer.tradeName,
      },
      alreadyImported: imported
        ? { id: imported.id, receivedAt: imported.createdAt.toISOString() }
        : null,
      items: nfe.items.map((item, index) => this.previewItem(item, costs[index], catalog, known)),
      installments: nfe.installments.map((i) => ({
        number: i.number,
        dueDate: i.dueDate,
        amount: fromCents(i.amountCents),
      })),
      warnings: this.warningsOf(nfe, costs),
    };
  }

  private previewItem(
    item: NfeItem,
    cost: LandedCost,
    catalog: CatalogEntry[],
    known: KnownCode[],
  ): ReceiptPreview['items'][number] {
    const b = cost.breakdown;
    return {
      line: item.line,
      code: item.code,
      ean: item.ean,
      description: item.description,
      ncm: item.ncm,
      unit: item.unit,
      quantity: item.quantity,
      wholeQuantity: cost.wholeQuantity,
      listUnitPrice: item.listUnitPrice,
      unitCost: cost.unitCost,
      totalCost: fromCents(cost.totalCents),
      costBreakdown: {
        gross: fromCents(b.grossCents),
        discount: fromCents(b.discountCents),
        freight: fromCents(b.freightCents),
        insurance: fromCents(b.insuranceCents),
        other: fromCents(b.otherCents),
        ipi: fromCents(b.ipiCents),
        st: fromCents(b.stCents),
      },
      match: matchItem(item, catalog, known),
    };
  }

  private warningsOf(nfe: ParsedNfe, costs: LandedCost[]): string[] {
    const warnings: string[] = [];
    costs.forEach((cost, index) => {
      if (!cost.wholeQuantity) {
        warnings.push(
          `Item ${nfe.items[index].line}: quantidade fracionada (${nfe.items[index].quantity}). O estoque é em unidades inteiras: informe a quantidade inteira ao confirmar.`,
        );
      }
    });
    const installmentsTotal = nfe.installments.reduce((sum, i) => sum + i.amountCents, 0);
    if (nfe.installments.length === 0) {
      warnings.push('A nota não traz parcelas: informe os vencimentos se for gerar contas a pagar.');
    } else if (Math.abs(installmentsTotal - nfe.totals.invoiceCents) > 1) {
      warnings.push(
        `As parcelas da nota somam ${formatBRL(fromCents(installmentsTotal))}, e o total da nota é ${formatBRL(fromCents(nfe.totals.invoiceCents))}. Confira os vencimentos.`,
      );
    }
    return warnings;
  }

  // ─── Etapa 2: confirmar e gravar ──────────────────────────────────────

  async confirmReceipt(
    tenantId: string,
    userId: string,
    permissions: string[],
    xml: string,
    dto: ConfirmReceiptDto,
  ): Promise<ReceiptResult> {
    // O XML é a fonte da verdade: quantidades, valores e custos são recalculados
    // aqui, nunca confiados ao que o cliente mandou.
    const nfe = parseNfeXml(xml);
    const plans = this.planItems(nfe, computeLandedCosts(nfe), dto.items);
    const payables = this.validatePayables(nfe, dto, permissions);

    await this.assertWarehouse(tenantId, dto.warehouseId);
    await this.assertNotImported(tenantId, nfe.accessKey);
    const existingSupplier = await this.findSupplier(tenantId, nfe.issuer.document);

    const result = await this.prisma.$transaction(async (tx) => {
      const supplier = existingSupplier ?? (await this.createSupplier(tx, tenantId, nfe));
      const receipt = await this.createReceipt(tx, tenantId, userId, dto, nfe, supplier.id);

      const rows: Prisma.GoodsReceiptItemCreateManyInput[] = [];
      const moved: { productId: string; variantId: string | null }[] = [];

      for (const plan of plans) {
        const target = await this.resolveTarget(tx, tenantId, supplier.id, plan);
        await this.inventory.applyMovement(tx, tenantId, userId, {
          productId: target.productId,
          variantId: target.variantId ?? undefined,
          type: 'ENTRY',
          reason: 'PURCHASE',
          quantity: plan.quantity,
          unitCost: plan.unitCost,
          toWarehouseId: dto.warehouseId,
          referenceType: 'goods_receipt',
          referenceId: receipt.id,
          notes: `NF ${nfe.number} - ${supplier.name}`,
        } as CreateMovementDto);

        await tx.supplierProductCode.upsert({
          where: {
            tenantId_supplierId_supplierCode: {
              tenantId,
              supplierId: supplier.id,
              supplierCode: plan.item.code,
            },
          },
          create: {
            tenantId,
            supplierId: supplier.id,
            supplierCode: plan.item.code,
            productId: target.productId,
            variantId: target.variantId,
          },
          update: { productId: target.productId, variantId: target.variantId },
        });

        rows.push({
          receiptId: receipt.id,
          line: plan.item.line,
          productId: target.productId,
          variantId: target.variantId,
          supplierCode: plan.item.code,
          description: plan.item.description,
          quantity: plan.quantity,
          unitCost: plan.unitCost,
          totalCost: fromCents(plan.totalCents),
          createdProduct: target.created,
        });
        moved.push({ productId: target.productId, variantId: target.variantId });
      }

      await tx.goodsReceiptItem.createMany({ data: rows });
      await this.createPayables(tx, tenantId, supplier, receipt.id, nfe, payables);

      return {
        receiptId: receipt.id,
        totalAmount: fromCents(nfe.totals.invoiceCents),
        itemsReceived: rows.length,
        productsCreated: rows.filter((r) => r.createdProduct).length,
        payablesCreated: payables.length,
        moved,
      };
    });

    // Alertas só depois do commit, e uma falha neles não desfaz a entrada.
    for (const { productId, variantId } of result.moved) {
      try {
        await this.inventory.refreshAlerts(tenantId, productId, variantId, dto.warehouseId);
      } catch (error) {
        this.logger.warn(
          `Alerta de estoque não atualizado (produto ${productId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `NF ${nfe.number} (${nfe.accessKey}) deu entrada: ${result.itemsReceived} item(ns), ${result.productsCreated} produto(s) novo(s), tenant ${tenantId}`,
    );
    const { moved: _moved, ...summary } = result;
    return summary;
  }

  /** Uma decisão por item da nota; quantidade e custo já resolvidos. */
  private planItems(
    nfe: ParsedNfe,
    costs: LandedCost[],
    decisions: ReceiptItemDecisionDto[],
  ): PlannedItem[] {
    const byLine = new Map<number, ReceiptItemDecisionDto>();
    for (const decision of decisions) {
      if (!nfe.items.some((i) => i.line === decision.line)) {
        throw new BadRequestException(`O item ${decision.line} não existe nesta nota.`);
      }
      if (byLine.has(decision.line)) {
        throw new BadRequestException(`O item ${decision.line} foi informado mais de uma vez.`);
      }
      byLine.set(decision.line, decision);
    }
    for (const item of nfe.items) {
      if (!byLine.has(item.line)) {
        throw new BadRequestException(
          `O item ${item.line} da nota não foi decidido: vincule a um produto, crie um novo ou ignore.`,
        );
      }
    }

    const plans: PlannedItem[] = [];
    nfe.items.forEach((item, index) => {
      const decision = byLine.get(item.line) as ReceiptItemDecisionDto;
      if (decision.action === 'SKIP') return;

      const quantity = decision.quantity ?? item.quantity;
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestException(
          `Item ${item.line}: a quantidade (${quantity}) precisa ser um número inteiro. Informe a quantidade inteira.`,
        );
      }

      const hasTypedCost = decision.unitCost !== undefined && decision.unitCost !== null;
      const totalCents = hasTypedCost
        ? Math.round((decision.unitCost as number) * quantity * 100)
        : costs[index].totalCents;
      const unitCost = hasTypedCost
        ? (decision.unitCost as number)
        : Math.round((totalCents / quantity) * 100) / 10000;

      plans.push({ decision, item, quantity, unitCost, totalCents });
    });

    if (plans.length === 0) {
      throw new BadRequestException('Dê entrada em pelo menos um item da nota.');
    }
    return plans;
  }

  private validatePayables(
    nfe: ParsedNfe,
    dto: ConfirmReceiptDto,
    permissions: string[],
  ): NonNullable<ConfirmReceiptDto['payables']> {
    const payables = dto.payables ?? [];
    if (payables.length === 0) return [];

    if (!permissions.includes(FINANCIAL_PERMISSION)) {
      throw new ForbiddenException(
        'Você não tem permissão para lançar contas a pagar. Dê a entrada sem gerar as parcelas.',
      );
    }
    for (const payable of payables) {
      if (!isRealDate(payable.dueDate)) {
        throw new BadRequestException(`Vencimento inválido: ${payable.dueDate}.`);
      }
    }
    const total = payables.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    if (total > nfe.totals.invoiceCents) {
      throw new BadRequestException(
        `As parcelas somam mais do que a nota (${formatBRL(fromCents(total))} contra ${formatBRL(fromCents(nfe.totals.invoiceCents))}).`,
      );
    }
    return payables;
  }

  private async assertWarehouse(tenantId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
      select: { id: true },
    });
    if (!warehouse) {
      throw new NotFoundException('Depósito não encontrado');
    }
  }

  private async assertNotImported(tenantId: string, accessKey: string): Promise<void> {
    const imported = await this.prisma.goodsReceipt.findFirst({
      where: { tenantId, accessKey },
      select: { id: true, createdAt: true },
    });
    if (imported) {
      throw new ConflictException(`Esta nota já deu entrada em ${formatDayBR(imported.createdAt)}.`);
    }
  }

  private findSupplier(tenantId: string, document: string) {
    return this.prisma.supplier.findFirst({
      where: { tenantId, document, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  private createSupplier(tx: Prisma.TransactionClient, tenantId: string, nfe: ParsedNfe) {
    const issuer = nfe.issuer;
    return tx.supplier.create({
      data: {
        tenantId,
        name: issuer.name,
        tradeName: issuer.tradeName,
        document: issuer.document,
        phone: issuer.phone,
        addressStreet: issuer.street,
        addressNumber: issuer.number,
        addressCity: issuer.city,
        addressState: issuer.state,
        addressZipCode: issuer.zipCode,
      },
      select: { id: true, name: true },
    });
  }

  private async createReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: ConfirmReceiptDto,
    nfe: ParsedNfe,
    supplierId: string,
  ) {
    try {
      return await tx.goodsReceipt.create({
        data: {
          tenantId,
          accessKey: nfe.accessKey,
          number: nfe.number,
          series: nfe.series,
          issuedDate: startOfDayInTz(
            isRealDate(nfe.issuedDate) ? nfe.issuedDate : toLocalDateKey(new Date()),
          ),
          supplierId,
          warehouseId: dto.warehouseId,
          totalAmount: fromCents(nfe.totals.invoiceCents),
          createdById: userId,
        },
        select: { id: true },
      });
    } catch (error) {
      // Duas confirmações da mesma nota ao mesmo tempo: a chave única decide.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Esta nota já deu entrada.');
      }
      throw error;
    }
  }

  /** O produto (e variante) que vai receber o item — criando o produto novo. */
  private async resolveTarget(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
    plan: PlannedItem,
  ): Promise<{ productId: string; variantId: string | null; created: boolean }> {
    const { decision, item } = plan;

    if (decision.action === 'LINK') {
      const product = await tx.product.findFirst({
        where: { id: decision.productId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException('Produto não encontrado.');
      }
      const variantId = decision.variantId || null;
      if (variantId) {
        const variant = await tx.productVariant.findFirst({
          where: { id: variantId, productId: product.id },
          select: { id: true },
        });
        if (!variant) {
          throw new BadRequestException('A variante escolhida não pertence ao produto.');
        }
      }
      return { productId: product.id, variantId, created: false };
    }

    const input = decision.product as NonNullable<ReceiptItemDecisionDto['product']>;
    const taken = await tx.product.findFirst({
      where: { tenantId, sku: input.sku, deletedAt: null },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(`Já existe um produto com o SKU "${input.sku}".`);
    }
    // O produto novo não pode nascer com o código de barras de outro: o
    // leitor do balcão passaria a não saber qual dos dois vender.
    await assertBarcodesFree(tx, tenantId, [digitsOrNull(input.ean) ?? item.ean]);
    if (input.categoryId) await this.assertOwned(tx.category, input.categoryId, tenantId, 'Categoria');
    if (input.brandId) await this.assertOwned(tx.brand, input.brandId, tenantId, 'Marca');

    const created = await tx.product.create({
      data: {
        tenantId,
        sku: input.sku,
        name: input.name,
        type: 'SIMPLE',
        status: 'ACTIVE',
        // Dados fiscais vêm da nota, só com dígitos (AE-08/AE-15).
        ean: digitsOrNull(input.ean) ?? item.ean,
        ncm: digitsOrNull(input.ncm) ?? digitsOrNull(item.ncm),
        cfop: digitsOrNull(item.cfop),
        costPrice: plan.unitCost,
        salePrice: input.salePrice,
        categoryId: input.categoryId || null,
        brandId: input.brandId || null,
        supplierId,
      },
      select: { id: true },
    });
    return { productId: created.id, variantId: null, created: true };
  }

  private async assertOwned(
    delegate: { findFirst: (args: { where: { id: string; tenantId: string }; select: { id: true } }) => Promise<unknown> },
    id: string,
    tenantId: string,
    label: string,
  ): Promise<void> {
    const found = await delegate.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) {
      throw new BadRequestException(`${label} não encontrada.`);
    }
  }

  private async createPayables(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplier: { id: string; name: string },
    receiptId: string,
    nfe: ParsedNfe,
    payables: NonNullable<ConfirmReceiptDto['payables']>,
  ): Promise<void> {
    for (const [index, payable] of payables.entries()) {
      await tx.accountsPayable.create({
        data: {
          tenantId,
          supplierId: supplier.id,
          description: `NF ${nfe.number} - ${supplier.name} (${index + 1}/${payables.length})`,
          installment: index + 1,
          totalInstallments: payables.length,
          amount: payable.amount,
          status: 'PENDING',
          // Vencimento é data civil: meia-noite do lojista (FN-02).
          dueDate: startOfDayInTz(payable.dueDate),
          metadata: { kind: 'GOODS_RECEIPT', receiptId, accessKey: nfe.accessKey },
        },
      });
    }
  }

  // ─── Leitura do catálogo ──────────────────────────────────────────────

  private async loadCatalog(tenantId: string): Promise<CatalogEntry[]> {
    const products = await this.prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        ean: true,
        ncm: true,
        variants: { select: { id: true, sku: true, name: true, ean: true } },
      },
    });

    return products.flatMap((product) => [
      {
        productId: product.id,
        variantId: null,
        sku: product.sku,
        name: product.name,
        ean: product.ean,
        ncm: product.ncm,
      },
      ...product.variants.map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        sku: variant.sku,
        name: `${product.name} - ${variant.name}`,
        ean: variant.ean,
        ncm: product.ncm,
      })),
    ]);
  }

  private async loadKnownCodes(
    tenantId: string,
    supplierId: string | null,
  ): Promise<KnownCode[]> {
    if (!supplierId) return [];
    return this.prisma.supplierProductCode.findMany({
      where: { tenantId, supplierId },
      select: { supplierCode: true, productId: true, variantId: true },
    });
  }
}
