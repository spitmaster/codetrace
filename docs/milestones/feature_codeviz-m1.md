# Milestone — feature/codeviz-m1

> **M1: 主链路验证** — 在 TS+React+Express+Prisma 夹具上证明 "AI 业务翻译 + 数据流追踪 + IO 入口驱动" 三件套主链路可用
> 进入条件: SPEC.md / roadmap.md / 本文件 三份就位
> 完成条件: 全部子里程碑 ✅ 且 [SPEC.md §7](../../SPEC.md#7-验收标准) M1 验收清单勾完
> 真相源: [SPEC.md](../../SPEC.md) (产品) + [docs/agents/codeviz-overview.md](../agents/codeviz-overview.md) (技术)

---

## 状态

🚧 **进行中** — M1.1 阶段 A / C / D / E(共 13/20 任务,T1-T8 + T12-T15 + T17-T20)于 2026-05-18 完成。**阶段 B(前端骨架 T9-T11)与可选 T16 仍未做**;`npm run fixture:health` 9/9 断言通过、4 份 ground-truth 全部通过 zod schema 校验。

## 子里程碑

按依赖顺序排列。状态: `⏳ 未开始 / 🚧 进行中 / ✅ 已完成`。

| ID | 主题 | 负责 agent | 依赖 | 状态 | 主要交付物 |
|---|---|---|---|---|---|
| **M1.1** | 测试夹具就位 | fixture-validator | — | 🚧 | `fixtures/fixture-a-order-app/*` + ground-truth |
| **M1.2** | 静态分析 + IO 入口识别 | static-code-analyzer + io-entry-mapper | M1.1 | ⏳ | `cli/src/analyzer/*` + `cli/src/io-mapper/*`,产出 SymbolGraph + IOEntryRegistry |
| **M1.3** | 数据流追踪 | dataflow-tracer | M1.2 | ⏳ | `cli/src/tracer/*`,产出 FlowGraph |
| **M1.4** | 业务翻译 + LLM Provider 抽象 | business-translator | M1.3 | ⏳ | `cli/src/translator/*`,Provider 至少 Claude + Ollama |
| **M1.5** | 2D 浏览器展示 + 端到端回归 | 3d-rendering-engineer (2D 模式) + 3d-interaction-designer + fixture-validator | M1.4 | ⏳ | `web/*` 应用,一键回归脚本,准确率报告 |

## 当前活动的子里程碑

→ **M1.1** (即将启动,详情见 [todo/feature_codeviz-m1.md](../todo/feature_codeviz-m1.md))

## 子里程碑交付清单 (高层)

### M1.1: 测试夹具就位

> 详细任务级清单在 [todo/feature_codeviz-m1.md](../todo/feature_codeviz-m1.md);本节只列里程碑级交付物。

- [ ] `fixtures/fixture-a-order-app/frontend/` (React 最小订单系统 UI) — **Stage B 待做**
- [x] `fixtures/fixture-a-order-app/backend/` (Express + Prisma 订单 API,4 个 endpoints)
- [x] `fixtures/fixture-a-order-app/backend/prisma/schema.prisma` (User/Order/OrderItem/Product 4 表)
- [x] `fixtures/fixture-a-order-app/ground-truth/symbol-graph.expected.json`
- [x] `fixtures/fixture-a-order-app/ground-truth/io-entry-registry.expected.json`
- [x] `fixtures/fixture-a-order-app/ground-truth/flow-graph-POST_api_orders.expected.json`
- [x] `fixtures/fixture-a-order-app/ground-truth/business-annotations-POST_api_orders.expected.json`
- [x] `fixtures/fixture-a-order-app/backend/README.md` (覆盖场景说明 + 业务意图清单)
- [x] `fixtures/fixture-a-order-app/scripts/health-check.sh` + 仓库根 `npm run fixture:health`
- [x] `cli/src/schemas/*.ts` (4 个 zod schema,版本 0.1.0) + `npm run validate:ground-truth`

### M1.2 — M1.5

> M1.1 完结、夹具固定后再展开;届时回到本文件追加每个子 M 的交付清单。**这是有意为之的延迟**,避免在 ground-truth 都没建好时空写后续 M 的交付,容易跑偏。

## 退出条件 (M1 整体)

- [ ] 全部 M1.1 – M1.5 子里程碑标 ✅
- [ ] [SPEC.md §7 M1 完成标准](../../SPEC.md#m1-完成标准-全部勾完--m1-验收通过) 全部勾完
- [ ] 准确率报告: SymbolGraph 召回 ≥ 80% / IOEntryRegistry 100% / FlowGraph 主路径 ≥ 80% / BusinessAnnotations ≥ 80%
- [ ] [agents/codeviz-overview.md 支持矩阵](../agents/codeviz-overview.md#codeviz-当前支持矩阵初始) M1 范围标 ✅
- [ ] [roadmap.md](../roadmap.md) M1 行从 🚧 改 ✅
- [ ] PR 合并 (本分支 → main)

## 修订日志

| 日期 | commit | 修订 |
|---|---|---|
| 2026-05-18 | (待提交) | M1.1 阶段 C / D / E 完成(T12-T15 + T17-T20):4 份 ground-truth JSON + 4 个 zod schema + 一键 `fixture:health`(9 断言)+ `validate:ground-truth`(4/4 通过)。M1.1 进度 8/20 → 13/20,Stage B(前端 T9-T11)仍 pending |
| 2026-05-18 | 7e7ec2b / cb14140 | M1.1 阶段 A(后端骨架 T1-T8)完成,状态从 ⏳ 改 🚧;`fixtures/fixture-a-order-app/backend/` 4 endpoints + seed + README 业务意图就位 |
| 2026-05-18 | (创建) | 初稿。5 个子里程碑 + 高层交付物 + 退出条件 |
