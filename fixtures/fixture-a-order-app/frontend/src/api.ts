export interface OrderSummary {
  id: string;
  userId: string;
  status: "pending" | "paid" | "cancelled";
  totalAmount: number;
  createdAt: string;
}

export interface OrderItemDetail {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  product: { id: string; name: string; price: number };
}

export interface OrderDetail extends OrderSummary {
  items: OrderItemDetail[];
}

export interface CreateOrderInput {
  items: { productId: string; quantity: number }[];
}

export interface CreateOrderResult {
  orderId: string;
  totalAmount: number;
  status: "pending";
}

export interface ListOrdersResult {
  data: OrderSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function callApi<T>(
  userId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    try {
      const data = await res.json();
      code = data.code ?? code;
      message = data.message ?? message;
    } catch {
      // body wasn't JSON; keep statusText
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  listOrders(userId: string, page = 1, pageSize = 20): Promise<ListOrdersResult> {
    return callApi(userId, "GET", `/api/orders?page=${page}&pageSize=${pageSize}`);
  },
  getOrder(userId: string, id: string): Promise<OrderDetail> {
    return callApi(userId, "GET", `/api/orders/${encodeURIComponent(id)}`);
  },
  createOrder(userId: string, input: CreateOrderInput): Promise<CreateOrderResult> {
    return callApi(userId, "POST", "/api/orders", input);
  },
  cancelOrder(userId: string, id: string): Promise<{ orderId: string; status: "cancelled" }> {
    return callApi(userId, "DELETE", `/api/orders/${encodeURIComponent(id)}`);
  },
};

// Hard-coded seed users + products so the UI matches backend/prisma/seed.ts.
// Keeping these mirrored in code is intentional: the fixture is a *target* of
// codeviz analysis, so its UI should not require a separate config-loading flow
// that would obscure the otherwise-straightforward request topology.
export const SEED_USERS = [
  { id: "user_alice", label: "Alice" },
  { id: "user_bob", label: "Bob" },
  { id: "user_carol", label: "Carol" },
];

export const SEED_PRODUCTS = [
  { id: "prod_book", name: "Book", price: 4500 },
  { id: "prod_mug", name: "Mug", price: 1200 },
  { id: "prod_keyboard", name: "Keyboard", price: 9800 },
  { id: "prod_notebook", name: "Notebook", price: 800 },
  { id: "prod_pen", name: "Pen", price: 300 },
];

export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
