# Fixture-A Backend — Order System

> **角色**:codeviz M1 主链路验证的**目标项目**(target),不是 codeviz 本身。
> **技术栈**:Node 18 + TypeScript + Express 4 + Prisma 5 + SQLite。
> **范围**:4 张表 + 4 个 HTTP endpoints + 1 条核心业务规则(库存扣减不能为负)。
>
> 本文件 §"业务意图清单" 是 **BusinessAnnotations 的 ground-truth 来源** —
> ground-truth/business-annotations-*.expected.json 中的中文 narrative 应当与本节描述一致。

---

## 1. 快速启动

```bash
cd fixtures/fixture-a-order-app/backend

# 装依赖(首次)
npm install

# 生成 Prisma client + 初始化 SQLite
cp .env.example .env
npx prisma migrate dev --name init

# 灌种子数据(3 用户 + 5 产品 + 2 示例订单)
npm run seed

# 启动开发服务器(默认 http://localhost:4000)
npm run dev
```

## 2. 数据模型

| 表 | 角色 | 关键字段 |
|---|---|---|
| `User` | 买家身份 | `email`, `name` |
| `Product` | 商品 + 库存 | `price`(分,Int 避免浮点)、`stock`(库存计数器,**不可为负**) |
| `Order` | 订单头 | `userId`、`status`(`pending`/`paid`/`cancelled`)、`totalAmount`(分) |
| `OrderItem` | 订单行 | `quantity`、`unitPrice`(下单时的价格快照,与 `Product.price` 解耦) |

**关键不变量**:
1. **库存不可为负** — `Product.stock` 任何时刻都 ≥ 0。在事务内通过"先校验后 decrement"实现,SQLite 串行化事务规避并发竞争。
2. **价格快照** — `OrderItem.unitPrice` 在下单瞬间从 `Product.price` 拷贝,后续 Product 改价不影响历史订单。
3. **订单状态机** — `pending` 是初始态;只有 `pending` 可被 `DELETE` 取消变为 `cancelled`;`paid` 转换不在 M1 范围。

## 3. HTTP API

所有受保护接口要求 `x-user-id` header(M1 假鉴权,真实项目这里会是 JWT 解析)。

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查,无需鉴权 |
| POST | `/api/orders` | 创建订单 |
| GET | `/api/orders` | 列当前用户订单(分页) |
| GET | `/api/orders/:id` | 订单详情(含 items + product) |
| DELETE | `/api/orders/:id` | 取消订单(仅 pending) |

### 3.1 POST `/api/orders` — 创建订单

请求:
```http
POST /api/orders
x-user-id: user_alice
Content-Type: application/json

{ "items": [{ "productId": "prod_book", "quantity": 1 }, { "productId": "prod_mug", "quantity": 2 }] }
```

成功响应 `201`:
```json
{ "orderId": "ckxxxx...", "totalAmount": 6900, "status": "pending" }
```

错误码:
- `400 VALIDATION_ERROR` — items 缺失 / quantity 不合法 / userId 缺失
- `401 UNAUTHORIZED` — `x-user-id` header 缺失
- `404 NOT_FOUND` — 指定的 user 或 product 不存在
- `409 CONFLICT` — 任一商品库存不足

### 3.2 GET `/api/orders?page=1&pageSize=20` — 列订单

按 `createdAt desc` 倒序,只返回当前 `x-user-id` 的订单。响应:
```json
{ "data": [Order, ...], "page": 1, "pageSize": 20, "total": 3 }
```

### 3.3 GET `/api/orders/:id` — 订单详情

仅当订单 `userId === x-user-id` 时返回(避免向非所有者泄漏存在性,不存在 → 一律 `404`)。响应展开 `items` 与 `product`。

### 3.4 DELETE `/api/orders/:id` — 取消订单

仅 `pending` 可取消。取消时在事务内回滚所有 OrderItem 的 `quantity` 到 `Product.stock`。

错误码:
- `404 NOT_FOUND` — 订单不存在或不属于当前用户
- `409 CONFLICT` — 订单已 `paid` 或 `cancelled`

---

## 4. 业务意图清单(BusinessAnnotations ground-truth 来源)

这一节是 LLM 业务翻译的"参考答案"。每个 endpoint 列出:
- **业务标签**(Chinese narrative 短句,适合作节点 label)
- **业务 narrative**(适合作 flow-level 中文描述)
- **关键 evidence 锚点**(代码符号,LLM 必须基于这些才允许写出标签,evidence 为空就只能标 `confidence=low`)

### POST `/api/orders` — 创建订单

- **业务标签**:`下单`
- **业务 narrative**:用户提交购物清单 → 后端校验库存充足 → 在事务中扣减各商品库存并创建订单与订单行(价格快照)→ 返回订单 ID 与总金额。
- **关键 evidence 锚点**:
  - `ordersRouter.post("/")` → `createOrder()` (route → service 入口)
  - `createOrder()` → `prisma.$transaction(...)` (事务边界)
  - `reserveStock()` → `tx.product.findUnique` + `tx.product.update({ stock: decrement })` (扣库存)
  - `tx.order.create` + `tx.orderItem.createMany` (持久化)
  - 库存不足时抛 `ConflictError` (业务规则)

### GET `/api/orders` — 列我的订单

- **业务标签**:`查看我的订单列表`
- **业务 narrative**:当前用户从 header 解析身份 → 按用户 ID 过滤订单,按创建时间倒序分页返回。
- **关键 evidence 锚点**:
  - `requireUser` 中间件解析 `x-user-id`
  - `listOrders()` → `prisma.order.findMany({ where: { userId } })`
  - `prisma.order.count` (分页总数)

### GET `/api/orders/:id` — 订单详情

- **业务标签**:`查看订单详情`
- **业务 narrative**:校验订单归属当前用户(不属于则视同不存在)→ 关联展开订单行与商品信息,一次返回。
- **关键 evidence 锚点**:
  - `getOrderDetail()` 的 `where: { id, userId }` 同时条件(归属校验)
  - `include: { items: { include: { product } } }` (关联展开)

### DELETE `/api/orders/:id` — 取消订单

- **业务标签**:`取消订单`
- **业务 narrative**:校验订单属于当前用户且仍为 `pending` → 在事务中把每个订单行的数量加回到对应商品库存 → 将订单状态翻为 `cancelled`。
- **关键 evidence 锚点**:
  - `cancelOrder()` 中 `order.status !== "pending"` 拒绝 → `ConflictError`
  - `restoreStock()` → `tx.product.update({ stock: increment })` (回滚库存)
  - `tx.order.update({ status: "cancelled" })` (状态翻转)

---

## 5. 种子数据(供 ground-truth 引用)

| 表 | 行数 | 关键 ID |
|---|---|---|
| User | 3 | `user_alice`, `user_bob`, `user_carol` |
| Product | 5 | `prod_book` ¥45, `prod_mug` ¥12, `prod_keyboard` ¥98, `prod_notebook` ¥8, `prod_pen` ¥3 |
| Order | 2 | `order_sample_1` (Alice / pending), `order_sample_2` (Bob / cancelled) |

价格单位是**分**,响应里 `totalAmount` / `price` / `unitPrice` 都是 Int。

---

## 6. 与 codeviz M1 的对齐

| codeviz 概念 | 在 fixture-A 中的对应 |
|---|---|
| IOEntryRegistry | 上面 §3 表的 4 行 + `/health` |
| SymbolGraph | `src/routes/*` / `src/services/*` / `src/lib/*` 的函数与调用边 |
| FlowGraph | 4 个 endpoints 的数据流(POST 是最丰富的,作为 ground-truth 首选) |
| BusinessAnnotations | §4 各 endpoint 的"业务标签 + narrative + evidence 锚点" |

> 改动本文件 §4 时,记得同步 `ground-truth/business-annotations-*.expected.json`。
> 改动 `src/` 函数命名 / 拓扑时,记得同步 `ground-truth/symbol-graph.expected.json`、`ground-truth/flow-graph-*.expected.json` 与本文件 §4 的 evidence 锚点(三者必须一致,否则 fixture-validator 会报告冲突)。
