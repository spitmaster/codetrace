import { useEffect, useState } from "react";
import { api, ApiError, formatCents, OrderSummary } from "../api";

interface Props {
  userId: string;
  onOpenDetail: (orderId: string) => void;
  onNew: () => void;
}

export function OrderListPage({ userId, onOpenDetail, onNew }: Props) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listOrders(userId);
      setOrders(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <>
      <h2>我的订单</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="primary" onClick={onNew}>
          新建订单
        </button>
        <button className="primary" onClick={() => void load()} disabled={loading}>
          {loading ? "加载中..." : "刷新"}
        </button>
        <span className="muted">共 {total} 条</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        {orders.length === 0 && !loading && <p className="muted">没有订单。</p>}
        {orders.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>订单 ID</th>
                <th>状态</th>
                <th>总金额</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => onOpenDetail(o.id)}>
                  <td>{o.id}</td>
                  <td>
                    <span className={`status ${o.status}`}>{o.status}</span>
                  </td>
                  <td>{formatCents(o.totalAmount)}</td>
                  <td>{new Date(o.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
