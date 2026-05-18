# Todo — feature/codeviz-m1 (当前: M1.1 测试夹具就位)

> 服务于 [milestones/feature_codeviz-m1.md → M1.1](../milestones/feature_codeviz-m1.md) 的可勾选清单。
> **M1.1 完结后,本文件整段清空,重写为 M1.2 内容** (按全局 `~/.claude/CLAUDE.md` §2.2)。
> 真相源: [SPEC.md](../../SPEC.md), [agents/codeviz-overview.md](../agents/codeviz-overview.md), [agents/fixture-validator.md](../agents/fixture-validator.md)

---

## M1.1: 测试夹具就位

### 上下文

**为什么 M1.1 是夹具,不是 CLI?**
Fixture-A 是 M1.2 – M1.5 四个子里程碑的「测试地基」。所有 agent 都对着它跑、对着它出 ground-truth、对着它做回归。先做 CLI 再回头补夹具会陷入「CLI 在玩具上跑通了,真实场景一塌糊涂」的陷阱。
负责 agent: **fixture-validator**

**Fixture-A 的设计标准:**
- ✅ 麻雀虽小五脏俱全 (4+ 表 + 复合业务规则)
- ✅ 真实可跑 (curl 能调通 4 个 endpoints,前端能从列表→创建→详情走完一遍)
- ❌ 不能玩具到 LLM 翻译没难度 (要有「扣库存」「订单状态机」这种业务规则)
- ❌ 不能复杂到 80% 准确率不可能 (单 endpoint 调用链深度 ≤ 8)

### 任务清单

#### 阶段 A — 后端骨架 (Express + Prisma)

- [ ] **T1** 在 `fixtures/fixture-a-order-app/backend/` 初始化 Node 18 + TypeScript + Express + Prisma + SQLite
- [ ] **T2** 设计 Prisma schema (`prisma/schema.prisma`):
  - `User` (id / email / name)
  - `Product` (id / name / price / stock)
  - `Order` (id / userId / status: pending/paid/cancelled / totalAmount / createdAt)
  - `OrderItem` (id / orderId / productId / quantity / unitPrice)
- [ ] **T3** 实现 `POST /api/orders` (创建订单):验入参 → 查产品库存 → 扣库存(事务)→ 写 Order → 写 OrderItem → 返回 orderId
- [ ] **T4** 实现 `GET /api/orders` (列订单):鉴权(假实现,从 header 取 userId)→ 按 userId 分页查询
- [ ] **T5** 实现 `GET /api/orders/:id` (订单详情):查 Order + 关联展开 OrderItem + Product
- [ ] **T6** 实现 `DELETE /api/orders/:id` (取消订单):查状态 → 仅 pending 可取消 → 事务:回滚库存 + 改 status=cancelled
- [ ] **T7** 在 backend README 标注每个 endpoint 的「业务意图」中文描述 (这就是 BusinessAnnotations 的 ground-truth 来源)
- [ ] **T8** seed 脚本:插 3 个用户 + 5 个产品 + 2 个示例订单

#### 阶段 B — 前端骨架 (M1 仅作目标项目存在,本身不被 codeviz 分析)

- [ ] **T9** 在 `fixtures/fixture-a-order-app/frontend/` 初始化 Vite + React 18 + TypeScript
- [ ] **T10** 最小订单页:列表 + 创建按钮 + 详情;调用 backend 4 个 API
- [ ] **T11** README 写明 `npm run dev` 启动方式 (前后端两边)

> ⚠️ M1 阶段 codeviz 只分析 backend,frontend 入口识别推到 M2

#### 阶段 C — Ground-Truth (人工产出,这是夹具的灵魂)

- [ ] **T12** 写 `ground-truth/symbol-graph.expected.json`:覆盖关键 symbols(全部 Controller / Service / Prisma 调用 + 关键调用边)
- [ ] **T13** 写 `ground-truth/io-entry-registry.expected.json`:4 个 HTTP endpoints
- [ ] **T14** 写 `ground-truth/flow-graph-POST_api_orders.expected.json`:创建订单完整数据流(节点至少包含 OrderController.create / OrderService.create / InventoryService.reserve / prisma.order.create / prisma.orderItem.createMany / orders 表 / orderItems 表 / products 表)
- [ ] **T15** 写 `ground-truth/business-annotations-POST_api_orders.expected.json`:中文 narrative 标准答案 + 节点级 businessLabel + evidence 来源
- [ ] **T16** (可选,加分项) 为另外 3 个 endpoints 各出一份 ground-truth → 提升 M1.2-M1.5 的回归覆盖率

#### 阶段 D — Fixture 自我健康检查

- [ ] **T17** 写 `fixtures/fixture-a-order-app/scripts/health-check.sh`:启 backend → curl 4 个 endpoints → 断言响应 → 关掉
- [ ] **T18** 在仓库根 `package.json` 加 `"fixture:health": "bash fixtures/fixture-a-order-app/scripts/health-check.sh"`

#### 阶段 E — Schema 沉淀

- [ ] **T19** 在 `cli/src/schemas/` 用 **zod** 实现 4 个 schema 的运行时校验(SymbolGraph / IOEntryRegistry / FlowGraph / BusinessAnnotations,版本 0.1.0)
- [ ] **T20** 用上述 zod schema 校验 4 份 ground-truth 文件,确保它们结构合法 — 这是 M1.2 起所有 agent 输出格式的"参考答案"

### M1.1 验收

- [ ] 全部 T1 – T20 勾选 (T16 可选)
- [ ] backend 可启动 + curl 4 个 endpoints 拿到正确数据
- [ ] frontend 可启动 + 走通"创建订单 → 列表 → 详情"
- [ ] `npm run fixture:health` 通过
- [ ] 全部 ground-truth/*.json 通过 zod schema 校验
- [ ] codeviz-orchestrator 审阅通过 (跨层契约对齐 + 没改用户原始代码)

### M1.1 完结操作

完结时按 `~/.claude/CLAUDE.md` §2.2:

1. **本文件整段清空**,重写为 M1.2 内容 (静态分析 + IO 入口识别 的可勾选清单)
2. 在 [milestones/feature_codeviz-m1.md 子里程碑表](../milestones/feature_codeviz-m1.md#子里程碑) 把 M1.1 行从 ⏳ 改 ✅,加 commit 哈希 + 日期
3. 启动 M1.2 — 由 codeviz-orchestrator 调度 static-code-analyzer 和 io-entry-mapper

---

## 不在 M1.1 范围 (避免范围蔓延)

显式标注以下事项 **本子里程碑不做**:

- ❌ 写 CLI 任何代码 (那是 M1.2 起)
- ❌ 实现 tree-sitter 解析逻辑
- ❌ 实现 LLM 翻译逻辑
- ❌ 实现浏览器前端
- ❌ 给 fixture 加身份认证 / 权限系统 (假实现即可,业务复杂度不在这里堆)
- ❌ 优化 fixture 性能 (M1 不关心 fixture 自身性能)
