import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Unidades que saem do estoque para o cliente numa troca. */
interface IssuedLine {
  productId: string;
  variantId: string | null;
  stock: { id: string; warehouseId: string };
}

/** Unidades que voltam do cliente para o estoque. */
interface ReturnedLine {
  productId: string;
  variantId: string | null;
}

export async function issueReplacementStock(
  tx: Tx,
  tenantId: string,
  orderId: string,
  userId: string,
  replacement: IssuedLine,
  quantity: number,
) {
  await tx.inventoryItem.update({
    where: { id: replacement.stock.id },
    data: { quantity: { decrement: quantity }, available: { decrement: quantity } },
  });
  await tx.inventoryMovement.create({
    data: {
      tenantId,
      productId: replacement.productId,
      variantId: replacement.variantId,
      type: 'EXIT',
      reason: 'SALE',
      quantity,
      fromWarehouseId: replacement.stock.warehouseId,
      referenceType: 'order_exchange',
      referenceId: orderId,
      notes: 'Troca - saída do novo item',
      userId,
    },
  });
}

export async function returnItemToStock(
  tx: Tx,
  tenantId: string,
  orderId: string,
  userId: string,
  item: ReturnedLine,
  quantity: number,
  warehouseId: string,
  referenceType: string,
) {
  const existing = await tx.inventoryItem.findFirst({
    where: { tenantId, productId: item.productId, variantId: item.variantId, warehouseId },
    select: { id: true },
  });

  if (existing) {
    await tx.inventoryItem.update({
      where: { id: existing.id },
      data: { quantity: { increment: quantity }, available: { increment: quantity } },
    });
  } else {
    await tx.inventoryItem.create({
      data: {
        tenantId,
        productId: item.productId,
        variantId: item.variantId,
        warehouseId,
        quantity,
        available: quantity,
        reserved: 0,
      },
    });
  }

  await tx.inventoryMovement.create({
    data: {
      tenantId,
      productId: item.productId,
      variantId: item.variantId,
      type: 'RETURN',
      reason: 'RETURN_CUSTOMER',
      quantity,
      toWarehouseId: warehouseId,
      referenceType,
      referenceId: orderId,
      notes:
        referenceType === 'order_exchange'
          ? 'Troca - retorno do item devolvido'
          : 'Devolução de item - retorno ao estoque',
      userId,
    },
  });
}
