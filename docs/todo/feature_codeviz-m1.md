# Todo — feature/codeviz-m1 (当前: M1.2 静态分析 + IO 入口识别)

> 服务于 [milestones/feature_codeviz-m1.md → M1.2](../milestones/feature_codeviz-m1.md) 的可勾选清单。
> **M1.2 完结后,本文件整段清空,重写为 M1.3 内容** (按全局 `~/.claude/CLAUDE.md` §2.2)。
> 真相源: [SPEC.md](../../SPEC.md), [agents/codeviz-overview.md](../agents/codeviz-overview.md), [agents/static-code-analyzer.md](../agents/static-code-analyzer.md), [agents/io-entry-mapper.md](../agents/io-entry-mapper.md)

---

## M1.2: 静态分析 + IO 入口识别

### 上下文

**M1.1 已完结**:Fixture-A 后端 + 前端骨架 + 10 份 ground-truth(symbol/io + 4×flow + 4×business)全部就位,`npm run fixture:health` 9/9 通过,`npm run validate:ground-truth` 10/10 通过。

**M1.2 要做的事**:
- **static-code-analyzer**:对 fixture-A `backend/src/**/*.ts` 跑静态分析,产出符合 `cli/src/schemas/symbol-graph.ts` schema 的 SymbolGraph,与 ground-truth 比对召回 ≥ 80%。
- **io-entry-mapper**:基于 SymbolGraph + 直接扫源码,产出 IOEntryRegistry,与 ground-truth 比对**准确率 100%**(per SPEC §7)。

**红线提醒**:
- M1.2 只支持 **TS + Express + Prisma**(red line #4),其它一律不分析。
- 中间表示必须带 `schemaVersion: "0.1.0"`(red line #6)。
- 目标项目源码只读(red line #5),analyzer 只读 `fixtures/fixture-a-order-app/backend/`,不修改。
- Symbol ID 严格按 `ts:src/path.ts#qualifiedName` 格式。

### 任务清单

#### 阶段 A — Analyzer 核心(static-code-analyzer)

- [x] **T21** 在 `cli/src/analyzer/` 建目录,引入 `ts-morph`(2026-05-18)
- [x] **T22** 实现 `analyzeProject(projectRoot) => SymbolGraph`:`<root>/src/**/*.ts`,跳过 node_modules/dist/prisma
- [x] **T23** 抽取 symbols:function/method/class/variable/handler(`ts:<rel>#<qn>`)
- [x] **T24** 抽取 calls:direct + framework-injected(中间件 → handler)
- [x] **T25** 抽取 frameworkPoints:route-registration / router-mount / middleware-mount / middleware-definition
- [x] **T26** 抽取 dataAccessPoints:`prisma.X.Y` 与 `tx.X.Y`,op 分类 read/write/delete + **`include` 关系展开为额外 read**(bonus,M1.3 trace 用得到)
- [x] **T27** CLI 入口 `cli/src/index.ts`:`analyze <root> [--output <file>]` 子命令
- [x] **T28** 单测(vitest):7 个 assertions — schema 版本、framework 识别、symbol 召回 100%(19/19)、call 召回 100%(10/10)、dataAccessPoint 全覆盖、route-registration 4/4、router-mount/middleware-definition

#### 阶段 B — IO Entry Mapper(io-entry-mapper)

- [x] **T29** 在 `cli/src/io-mapper/` 实现 `mapEntries({projectRoot}) => IOEntryRegistry`
- [x] **T30** 入口识别:Router 变量扫描 + app.use mount 拼接 + app.get/post 直挂(`/health`)
- [x] **T31** entry id 格式 `io:http:<METHOD>:<fullPath>`,与 ground-truth 完全一致
- [x] **T32** middlewareSymbolIds:解析 `router.X(path, ...mw, handler)` 中的 Identifier 中间件,通过 import 关系拼到对应 symbol id
- [x] **T33** CLI 子命令 `map-io <root>`
- [x] **T34** 单测(vitest):5 个 assertions — entry 数 = 5、id/displayName/handlerSymbolId 逐字段一致、middlewareSymbolIds 一致、所有 confidence=high(准确率 100%,SPEC §7)

#### 阶段 C — 工程基建

- [x] **T35** 仓库根 `package.json` 增 `cli:test` / `cli:analyze` / `cli:map-io` / `cli:trace` scripts
- [x] **T36** `cli/package.json` 添加 ts-morph + vitest 依赖;CLI 解析自己写小手卷(暂不引 commander 减少依赖)
- [x] **T37** README:`cli/README.md` 说明 3 个子命令 + schema 版本与边界

### M1.2 验收

- [x] 全部 T21 – T37 勾选(2026-05-18)
- [x] `npm run cli:test` 全部通过(28/28 — 含 M1.3 tracer 16 项)
- [x] `npm run cli:analyze -- fixtures/fixture-a-order-app/backend` 产出的 SymbolGraph 通过 `SymbolGraphSchema.parse`
- [x] SymbolGraph 召回 100%(19/19 期望符号 + 2 个 server.ts 额外项,实际 ⊇ 期望)
- [x] `npm run cli:map-io -- fixtures/fixture-a-order-app/backend` 产出的 IOEntryRegistry 与 ground-truth 完全一致(准确率 100%)
- [ ] codeviz-orchestrator 审阅通过(契约对齐 + 红线无违反)— 待用户最终签收 commit + push

### M1.2 完结操作

完结时按 `~/.claude/CLAUDE.md` §2.2:

1. **本文件整段清空**,重写为 M1.3 内容(数据流追踪 dataflow-tracer 的可勾选清单)
2. 在 [milestones/feature_codeviz-m1.md 子里程碑表](../milestones/feature_codeviz-m1.md#子里程碑) 把 M1.2 行从 ⏳ 改 ✅,加 commit 哈希 + 日期
3. 启动 M1.3 — 由 codeviz-orchestrator 调度 dataflow-tracer

---

## 不在 M1.2 范围 (避免范围蔓延)

- ❌ FlowGraph 追踪(M1.3)
- ❌ LLM 翻译(M1.4)
- ❌ 浏览器前端(M1.5)
- ❌ Java / Vue / Python 等其他语言/框架(M2+)
- ❌ NestJS 装饰器路由(SPEC §M1 功能 1 说 "Express 或 NestJS 二选一",M1.2 选 Express)
- ❌ tree-sitter(SPEC 提到 tree-sitter,M1.2 实际选 ts-morph/typescript;tree-sitter 留给 M2 Java/Vue 扩展)
