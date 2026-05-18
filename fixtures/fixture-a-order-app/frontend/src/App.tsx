import { useState } from "react";
import { OrderListPage } from "./pages/OrderListPage";
import { CreateOrderPage } from "./pages/CreateOrderPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { SEED_USERS } from "./api";

type Page =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; orderId: string };

export function App() {
  const [userId, setUserId] = useState<string>(SEED_USERS[0].id);
  const [page, setPage] = useState<Page>({ kind: "list" });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Fixture-A 订单后台</h1>
        <div className="user-picker">
          <label htmlFor="userPicker">当前用户(x-user-id)</label>
          <select
            id="userPicker"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPage({ kind: "list" });
            }}
          >
            {SEED_USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} ({u.id})
              </option>
            ))}
          </select>
        </div>
        <nav>
          <button
            className={page.kind === "list" ? "active" : ""}
            onClick={() => setPage({ kind: "list" })}
          >
            我的订单
          </button>
          <button
            className={page.kind === "create" ? "active" : ""}
            onClick={() => setPage({ kind: "create" })}
          >
            新建订单
          </button>
        </nav>
      </aside>

      <main className="main">
        {page.kind === "list" && (
          <OrderListPage
            userId={userId}
            onOpenDetail={(orderId) => setPage({ kind: "detail", orderId })}
            onNew={() => setPage({ kind: "create" })}
          />
        )}
        {page.kind === "create" && (
          <CreateOrderPage
            userId={userId}
            onCreated={(orderId) => setPage({ kind: "detail", orderId })}
            onCancel={() => setPage({ kind: "list" })}
          />
        )}
        {page.kind === "detail" && (
          <OrderDetailPage
            userId={userId}
            orderId={page.orderId}
            onBack={() => setPage({ kind: "list" })}
          />
        )}
      </main>
    </div>
  );
}
