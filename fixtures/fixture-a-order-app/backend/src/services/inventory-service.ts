import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";

export interface ReserveRequestItem {
  productId: string;
  quantity: number;
}

export interface ReservedLine {
  productId: string;
  quantity: number;
  unitPrice: number;
}

// reserveStock: for each requested item, fetch the product inside the same
// transaction, assert stock >= quantity, then decrement the counter.
//
// Inventory invariant: Product.stock must never go negative.
// Enforcement strategy: read-modify-write inside a Prisma interactive
// transaction, with an explicit pre-check that throws ConflictError when
// the requested quantity exceeds available stock. SQLite serializes the
// transactions, so a race that double-spends the last unit cannot occur.
//
// Returns the price snapshots so the caller can compute totalAmount and
// write OrderItem.unitPrice without re-reading the products.
export async function reserveStock(
  tx: Prisma.TransactionClient,
  items: ReserveRequestItem[]
): Promise<ReservedLine[]> {
  if (!items.length) {
    throw new ValidationError("items must be a non-empty array");
  }

  const reserved: ReservedLine[] = [];

  for (const item of items) {
    if (!item.productId || typeof item.productId !== "string") {
      throw new ValidationError("each item must include productId (string)");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError(
        `quantity for product ${item.productId} must be a positive integer`
      );
    }

    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) {
      throw new NotFoundError(`product ${item.productId}`);
    }
    if (product.stock < item.quantity) {
      throw new ConflictError(
        `insufficient stock for product ${product.id}: requested ${item.quantity}, available ${product.stock}`
      );
    }

    await tx.product.update({
      where: { id: product.id },
      data: { stock: { decrement: item.quantity } },
    });

    reserved.push({
      productId: product.id,
      quantity: item.quantity,
      unitPrice: product.price,
    });
  }

  return reserved;
}

// restoreStock: reverse the effect of reserveStock when an order is cancelled.
// Each line's quantity is added back to Product.stock. No upper bound check —
// stock has no maximum.
export async function restoreStock(
  tx: Prisma.TransactionClient,
  items: { productId: string; quantity: number }[]
): Promise<void> {
  for (const item of items) {
    await tx.product.update({
      where: { id: item.productId },
      data: { stock: { increment: item.quantity } },
    });
  }
}
