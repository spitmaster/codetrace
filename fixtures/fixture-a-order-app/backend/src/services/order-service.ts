import { prisma } from "../lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { reserveStock, restoreStock, ReserveRequestItem } from "./inventory-service";

export interface CreateOrderInput {
  userId: string;
  items: ReserveRequestItem[];
}

export interface ListOrdersOptions {
  userId: string;
  page: number;
  pageSize: number;
}

// createOrder: atomic order creation with inventory deduction.
// Steps inside one transaction:
//   1. assert User exists (FK guard with a friendlier error than Prisma's)
//   2. reserveStock: per-item stock check + decrement; returns price snapshots
//   3. compute totalAmount from snapshots
//   4. insert Order (status="pending")
//   5. bulk-insert OrderItems carrying snapshot unitPrice
// On any failure, the transaction rolls back and stock is untouched.
export async function createOrder(input: CreateOrderInput) {
  if (!input.userId) {
    throw new ValidationError("userId is required");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new NotFoundError(`user ${input.userId}`);
    }

    const reserved = await reserveStock(tx, input.items);
    const totalAmount = reserved.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0
    );

    const order = await tx.order.create({
      data: {
        userId: input.userId,
        status: "pending",
        totalAmount,
      },
    });

    await tx.orderItem.createMany({
      data: reserved.map((line) => ({
        orderId: order.id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    });

    return { orderId: order.id, totalAmount, status: order.status };
  });
}

// listOrders: paginate orders for the current buyer, newest first.
// Authorization scope: only the caller's own orders are returned (we filter
// by req.userId; there is no admin view in M1).
export async function listOrders(opts: ListOrdersOptions) {
  const page = Math.max(1, opts.page);
  const pageSize = Math.min(Math.max(1, opts.pageSize), 100);
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId: opts.userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.order.count({ where: { userId: opts.userId } }),
  ]);

  return { data, page, pageSize, total };
}

// getOrderDetail: order header + expanded line items with product info.
// Authorization: the order must belong to the caller; otherwise 404 to avoid
// leaking existence to non-owners.
export async function getOrderDetail(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, price: true } },
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError(`order ${orderId}`);
  }
  return order;
}

// cancelOrder: only pending orders may be cancelled.
// On cancel we restore the stock of every line item and flip status to
// "cancelled". Idempotency note: a second DELETE on the same id will see
// status="cancelled" and return 409 (intentional — not idempotent).
export async function cancelOrder(userId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundError(`order ${orderId}`);
    }
    if (order.status !== "pending") {
      throw new ConflictError(
        `order ${order.id} cannot be cancelled in status "${order.status}"`
      );
    }

    await restoreStock(
      tx,
      order.items.map((it) => ({ productId: it.productId, quantity: it.quantity }))
    );

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: "cancelled" },
    });
    return { orderId: updated.id, status: updated.status };
  });
}
