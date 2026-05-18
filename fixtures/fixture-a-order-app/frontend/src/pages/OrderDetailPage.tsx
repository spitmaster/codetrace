import { useEffect, useState } from "react";
import { api, ApiError, formatCents, OrderDetail } from "../api";

interface Props {
  userId: string;
  orderId: string;
  onBack: () => void;
}

export function OrderDetailPage({ userId, orderId, onBack }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getOrder(userId, orderId);
      setOrder(res);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function doCancel() {
    if (!order) return;
    setCancelling(true);
    setError(null);
    try {
      await api.cancelOrder(userId, order.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, orderId]);

  return (
    <>
      <h2>订单详情</h2>
      <button className="primary" onClick={onBack} style={{ background: "#6b7280", marginBottom: 12 }}>
        返回列表
      </button>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">加载中...</p>}
      {order && (
        <div className="card">
          <p>
            <strong>订单 ID:</strong> {order.id}
          </p>
          <p>
            <strong>状态:</strong>{" "}
            <span className={`status ${order.status}`}>{order.status}</span>
          </p>
          <p>
            <strong>总金额:</strong> {formatCents(order.totalAmount)}
          </p>
          <p>
            <strong>创建时间:</strong> {new Date(order.createdAt).toLocaleString()}
          </p>
          <h3>订单行</h3>
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>数量</th>
                <th>下单时单价</th>
                <th>当前价格</th>
                <th>小计</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.product.name}</td>
                  <td>{it.quantity}</td>
                  <td>{formatCents(it.unitPrice)}</td>
                  <td>{formatCents(it.product.price)}</td>
                  <td>{formatCents(it.unitPrice * it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.status === "pending" && (
            <div style={{ marginTop: 16 }}>
              <button className="danger" onClick={() => void doCancel()} disabled={cancelling}>
                {cancelling ? "取消中..." : "取消订单"}
              </button>
              <span className="muted" style={{ marginLeft: 8 }}>
                取消后库存会被退回
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
