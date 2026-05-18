import { useState } from "react";
import { api, ApiError, SEED_PRODUCTS, formatCents } from "../api";

interface Props {
  userId: string;
  onCreated: (orderId: string) => void;
  onCancel: () => void;
}

interface Line {
  productId: string;
  quantity: number;
}

export function CreateOrderPage({ userId, onCreated, onCancel }: Props) {
  const [lines, setLines] = useState<Line[]>([
    { productId: SEED_PRODUCTS[0].id, quantity: 1 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { productId: SEED_PRODUCTS[0].id, quantity: 1 },
    ]);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createOrder(userId, { items: lines });
      onCreated(res.orderId);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const total = lines.reduce((sum, line) => {
    const p = SEED_PRODUCTS.find((x) => x.id === line.productId);
    return sum + (p ? p.price * line.quantity : 0);
  }, 0);

  const canSubmit = !submitting && lines.length > 0 && lines.every((l) => l.quantity > 0);

  return (
    <>
      <h2>新建订单</h2>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="create-form">
          {lines.map((line, i) => (
            <div className="line" key={i}>
              <select
                value={line.productId}
                onChange={(e) => updateLine(i, { productId: e.target.value })}
              >
                {SEED_PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatCents(p.price)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) =>
                  updateLine(i, { quantity: parseInt(e.target.value, 10) || 0 })
                }
              />
              <button
                className="danger"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
              >
                删除
              </button>
            </div>
          ))}
          <button className="primary" onClick={addLine}>
            添加一行
          </button>
        </div>
        <p style={{ marginTop: 12 }}>
          <strong>预计总价(本地估算): {formatCents(total)}</strong>
          <span className="muted"> · 实际总额以后端价格快照为准</span>
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "提交中..." : "提交订单"}
          </button>
          <button className="primary" onClick={onCancel} style={{ background: "#6b7280" }}>
            返回
          </button>
        </div>
      </div>
    </>
  );
}
