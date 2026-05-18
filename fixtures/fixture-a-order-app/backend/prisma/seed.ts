import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic IDs so smoke tests and ground-truth fixtures can hardcode them
// without re-reading the DB on every run.
const USERS = [
  { id: "user_alice", email: "alice@example.com", name: "Alice" },
  { id: "user_bob", email: "bob@example.com", name: "Bob" },
  { id: "user_carol", email: "carol@example.com", name: "Carol" },
];

const PRODUCTS = [
  { id: "prod_book", name: "Pragmatic Programmer", price: 4500, stock: 20 },
  { id: "prod_mug", name: "Coffee Mug", price: 1200, stock: 50 },
  { id: "prod_keyboard", name: "Mechanical Keyboard", price: 9800, stock: 8 },
  { id: "prod_notebook", name: "A5 Notebook", price: 800, stock: 100 },
  { id: "prod_pen", name: "Gel Pen Pack", price: 300, stock: 200 },
];

async function main() {
  // Reset: wipe everything, then reinsert. SQLite + onDelete: Cascade keeps
  // OrderItem clean when we drop Orders.
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({ data: USERS });
  await prisma.product.createMany({ data: PRODUCTS });

  // Sample order #1 — Alice buys 1 book + 2 mugs (pending).
  // This is the canonical happy-path order referenced by ground-truth files.
  const order1 = await prisma.order.create({
    data: {
      id: "order_sample_1",
      userId: "user_alice",
      status: "pending",
      totalAmount: 4500 * 1 + 1200 * 2,
      items: {
        create: [
          { productId: "prod_book", quantity: 1, unitPrice: 4500 },
          { productId: "prod_mug", quantity: 2, unitPrice: 1200 },
        ],
      },
    },
  });
  // Reflect the seeded order in product stock counters.
  await prisma.product.update({ where: { id: "prod_book" }, data: { stock: { decrement: 1 } } });
  await prisma.product.update({ where: { id: "prod_mug" }, data: { stock: { decrement: 2 } } });

  // Sample order #2 — Bob bought a keyboard, already cancelled.
  // Used to verify that cancelled orders are visible in list view.
  const order2 = await prisma.order.create({
    data: {
      id: "order_sample_2",
      userId: "user_bob",
      status: "cancelled",
      totalAmount: 9800,
      items: {
        create: [{ productId: "prod_keyboard", quantity: 1, unitPrice: 9800 }],
      },
    },
  });
  // order_sample_2 is already cancelled, so stock is NOT decremented (it was
  // already restored at cancel-time, which we are modelling by skipping here).

  // eslint-disable-next-line no-console
  console.log("[seed] inserted", {
    users: USERS.length,
    products: PRODUCTS.length,
    orders: [order1.id, order2.id],
  });
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
