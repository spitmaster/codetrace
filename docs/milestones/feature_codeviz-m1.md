# Milestone — feature/codeviz-m1

> **M1: 主链路验证** — 在 TS+React+Express+Prisma 夹具上证明 "AI 业务翻译 + 数据流追踪 + IO 入口驱动" 三件套主链路可用
> 进入条件: SPEC.md / roadmap.md / 本文件 三份就位
> 完成条件: 全部子里程碑 ✅ 且 [SPEC.md §7](../../SPEC.md#7-验收标准) M1 验收清单勾完
> 真相源: [SPEC.md](../../SPEC.md) (产品) + [docs/agents/codeviz-overview.md](../agents/codeviz-overview.md) (技术)

---

## 状态

🚧 **进行中** — **M1.1 / M1.2 / M1.3 / M1.4 / M1.5 全部 MVP 就位(2026-05-19)**;M1 退出条件最后一步 = 用户签收 commit/push + 真实 LLM(Claude / Ollama)端到端跑一次确认 ≥ 80% 业务翻译质量。

## 子里程碑

按依赖顺序排列。状态: `⏳ 未开始 / 🚧 进行中 / ✅ 已完成`。

| ID | 主题 | 负责 agent | 依赖 | 状态 | 主要交付物 |
|---|---|---|---|---|---|
| **M1.1** | 测试夹具就位 | fixture-validator | — | ✅ | `fixtures/fixture-a-order-app/*` + ground-truth(2026-05-18 完结,commits `e1cbc63 / 803427d / bcf4313`) |
| **M1.2** | 静态分析 + IO 入口识别 | static-code-analyzer + io-entry-mapper | M1.1 | ✅ | `cli/src/analyzer/*` + `cli/src/io-mapper/*`,SymbolGraph 召回 100%(19/19),IOEntryRegistry 100% 一致(2026-05-19,commits `7c4d771 / 7cd376a`) |
| **M1.3** | 数据流追踪 | dataflow-tracer | M1.2 | ✅ | `cli/src/tracer/*`,4 个 FlowGraph 平均 nodeCoverage 100% + edgeCoverage 91%,table-ops 100%(2026-05-19,commits `7c4d771 / 7cd376a`) |
| **M1.4** | 业务翻译 + LLM Provider 抽象 | business-translator | M1.3 | ✅ | `cli/src/translator/*`,3 个 Provider(mock / claude / ollama)+ prompt 模板 + translate CLI 子命令 + 12 个 vitest 单测(2026-05-19,commit 待提交) |
| **M1.5** | 2D 浏览器展示 + 端到端回归 | 3d-rendering-engineer (2D 模式) + 3d-interaction-designer + fixture-validator | M1.4 | ✅ | `web/*`(Vite + React 18 + xyflow + dagre)+ `cli/src/eval/*` 评估器 + `npm run e2e:m1` 一键回归 + `reports/m1-accuracy.md`(2026-05-19,commit 待提交) |

## 当前活动的子里程碑

→ **M1 退出条件最后一步**:用户签收 commit / push + 实跑一次 ClaudeProvider 验证业务翻译 ≥ 80% 质量。其它 hard requirement 均已 PASS,见 [reports/m1-accuracy.md](../../reports/m1-accuracy.md)。

## 子里程碑交付清单 (高层)

### M1.1: 测试夹具就位

> 详细任务级清单在已清空的 todo;本节只列里程碑级交付物。

- [x] `fixtures/fixture-a-order-app/frontend/` (Vite + React 18 最小订单系统 UI,M1 不被 codeviz 分析,M2 起作为前端入口识别 fixture)
- [x] `fixtures/fixture-a-order-app/backend/` (Express + Prisma 订单 API,4 个 endpoints)
- [x] `fixtures/fixture-a-order-app/backend/prisma/schema.prisma` (User/Order/OrderItem/Product 4 表)
- [x] `fixtures/fixture-a-order-app/ground-truth/symbol-graph.expected.json`
- [x] `fixtures/fixture-a-order-app/ground-truth/io-entry-registry.expected.json`
- [x] `fixtures/fixture-a-order-app/ground-truth/flow-graph-*.expected.json` × 4(POST / GET 列 / GET 详情 / DELETE)
- [x] `fixtures/fixture-a-order-app/ground-truth/business-annotations-*.expected.json` × 4
- [x] `fixtures/fixture-a-order-app/backend/README.md` (覆盖场景说明 + 业务意图清单)
- [x] `fixtures/fixture-a-order-app/scripts/health-check.sh` + 仓库根 `npm run fixture:health`
- [x] `cli/src/schemas/*.ts` (4 个 zod schema,版本 0.1.0) + `npm run validate:ground-truth`

### M1.2: 静态分析 + IO 入口识别

- [x] `cli/src/analyzer/*` ts-morph 实现 — symbols / calls / frameworkPoints / dataAccessPoints + Prisma `include` 关系展开
- [x] `cli/src/io-mapper/*` Express 路由识别 — Router + app.use mount + middleware chain
- [x] CLI 子命令 `analyze` / `map-io` + 仓库根 `cli:analyze` / `cli:map-io` scripts
- [x] vitest 12 项断言(7 analyzer + 5 io-mapper)
- [x] e2e: SymbolGraph 召回 100%(19/19 + 2 个 server.ts 额外),IOEntryRegistry 100% 一致(5/5 entries)

### M1.3: 数据流追踪

- [x] `cli/src/tracer/*` 深度受限 DFS,kind=function/table/response/input,边 kind=call/read/write/delete/return/input-bind
- [x] Prisma include 关系展开为额外 read function 节点(关联展开可见)
- [x] CLI 子命令 `trace --entry <id> --depth-limit N`
- [x] vitest 16 项断言(覆盖 4 个 entry × 主路径节点 + 数据库读写)
- [x] e2e: 4 个 FlowGraph nodeCoverage 100%、edgeCoverage 91% 平均、table-ops 100%(PASS SPEC §7 ≥ 80%)

### M1.4: 业务翻译 + LLM Provider 抽象

- [x] `cli/src/translator/provider.ts` LLMProvider 接口 + ProviderRegistry
- [x] `cli/src/translator/providers/mock.ts` 启发式 MockProvider — 规则引擎,离线、确定性、CI 友好;遵守红线 #2(空 evidence → confidence=low + 占位 label)
- [x] `cli/src/translator/providers/claude.ts` 真实 `@anthropic-ai/sdk` 调用,lazy require(无 key 时清晰报错),JSON-fence 防御性解析
- [x] `cli/src/translator/providers/ollama.ts` 真实 `/api/generate` HTTP 调用,format=json,温度 0.1
- [x] `cli/src/translator/prompt.ts` TS+Express+Prisma 专用 prompt 模板 `ts-express-prisma@v1`,共享给两个 LLM Provider
- [x] `buildEvidenceFromFlow()` 自动从 FlowGraph metadata 提取 evidence
- [x] CLI 子命令 `translate <flow.json> --provider mock|claude|ollama [--model id]`
- [x] vitest 12 项断言(MockProvider 完整 / ClaudeProvider key 校验 + 注入 client 全链路 / OllamaProvider 注入 fetch 全链路 / prompt 字段)
- [x] mock 跑 4 个 entry 全部产出有效 BusinessAnnotations,evidenceNonEmpty=100%(红线 #2)

### M1.5: 2D 浏览器展示 + 端到端回归

- [x] `web/` Vite + React 18 + TypeScript + @xyflow/react + dagre,2D FlowGraph 渲染
- [x] 三栏布局:左 entries 列表 / 中 FlowGraph 节点图 / 右 narrative + 选中节点 evidence
- [x] 按 SPEC §UI 视觉规范:function 蓝、table 绿、input/response 灰;write 粗实线、read 虚线、delete 红粗;confidence low → 40% 不透明 + ❓
- [x] vite middleware `/data/*` 透传到 `reports/m1-out/*.json`,CLI 产出热更新可达
- [x] `cli/src/eval/evaluate.ts` BusinessAnnotations 准确率评估器(labelMatch + evidenceNonEmpty + highMediumRate)
- [x] `cli/src/eval/schema-eval.ts` SymbolGraph 召回 / IOEntryRegistry 准确率 / FlowGraph 主路径覆盖
- [x] `cli/src/eval/e2e.ts` 一键端到端:analyze → map-io → trace × 4 → translate(mock)× 4 → 4 项准确率 → `reports/m1-accuracy.md`
- [x] 仓库根 `npm run e2e:m1` + `web:dev` / `web:build` scripts
- [x] e2e 退出码:三个 hard requirement 任一 miss → 退出 1;mock provider 不达 80% 业务翻译质量是预期,不阻塞退出
- [x] `web:build` 通过(519 modules, 422KB bundle)+ dev server 启动 + /data 路由实跑验证

## 退出条件 (M1 整体)

- [x] 全部 M1.1 – M1.5 子里程碑标 ✅
- [ ] [SPEC.md §7 M1 完成标准](../../SPEC.md#m1-完成标准-全部勾完--m1-验收通过) 全部勾完(差最后一项:LLM Provider 至少 Claude + Ollama 两种实现 — 已实现但需真实 key 跑一次确认)
- [x] 准确率报告: SymbolGraph 召回 100% / IOEntryRegistry 100% / FlowGraph 主路径平均 91%(SPEC §7 ≥ 80% PASS)/ BusinessAnnotations mock 44%(需真实 LLM 跑出 ≥ 80%)
- [ ] [agents/codeviz-overview.md 支持矩阵](../agents/codeviz-overview.md#codeviz-当前支持矩阵初始) M1 范围标 ✅
- [ ] [roadmap.md](../roadmap.md) M1 行从 🚧 改 ✅
- [ ] PR 合并 (本分支 → main)

## 修订日志

| 日期 | commit | 修订 |
|---|---|---|
| 2026-05-19 | (待提交) | **M1.4 / M1.5 同夜完结** — MockProvider(规则引擎,4 entries 端到端跑通)+ ClaudeProvider 真实 @anthropic-ai/sdk 调用 + OllamaProvider 真实 /api/generate 调用 + ts-express-prisma@v1 prompt 模板(双 LLM 共用)+ translate CLI 子命令;web 前端 React 18 + xyflow + dagre 三栏视图(entries + FlowGraph + evidence 详情)+ vite /data 路由;e2e 评估器 + `npm run e2e:m1` 一键回归 + `reports/m1-accuracy.md`(SymbolGraph 100% / IO 100% / FlowGraph 平均 91% / mock BusinessAnnotations 44% — 真实 LLM 待跑)。CLI vitest 40/40(28 baseline + 12 translator) |
| 2026-05-19 | `7cd376a` | M1.2 / M1.3 状态文档同步(MVP 就位) |
| 2026-05-19 | `7c4d771` | M1.2 / M1.3 MVP — analyzer + io-mapper + tracer 实现 + 28 项 vitest |
| 2026-05-18 | `bcf4313` | M1.1 T16 — 为 GET 列 / GET 详情 / DELETE 取消 各补 1 份 FlowGraph + BusinessAnnotations |
| 2026-05-18 | `803427d` | M1.1 Stage B — Vite + React 18 frontend 骨架 + fixture 顶层 README |
| 2026-05-18 | `e1cbc63` | M1.1 阶段 C/D/E — ground-truth × 4 + zod schemas + 一键 fixture:health(9 断言)+ validate:ground-truth(10/10 通过) |
| 2026-05-18 | `7e7ec2b` / `cb14140` | M1.1 阶段 A(后端骨架 T1-T8) — `fixtures/fixture-a-order-app/backend/` 4 endpoints + seed + README 业务意图 |
| 2026-05-18 | (创建) | 初稿。5 个子里程碑 + 高层交付物 + 退出条件 |
