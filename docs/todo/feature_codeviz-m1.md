# Todo — feature/codeviz-m1 (M1 全部子里程碑 MVP 已就位,待用户签收)

> 服务于 [milestones/feature_codeviz-m1.md](../milestones/feature_codeviz-m1.md) 的可勾选清单。
> 上一个 M(M1.5)完结后按 `~/.claude/CLAUDE.md` §2.2 清空,此处为 M1 整体收尾视图。
> 真相源: [SPEC.md](../../SPEC.md), [agents/codeviz-overview.md](../agents/codeviz-overview.md), [reports/m1-accuracy.md](../../reports/m1-accuracy.md)

---

## M1 收尾 — 待签收事项

### 上下文

**截至 2026-05-19**:M1.1 – M1.5 全部 MVP 就位。

| 子里程碑 | 状态 | 关键证据 |
|---|---|---|
| M1.1 测试夹具 | ✅ 完结 | `fixtures/fixture-a-order-app/*`, `npm run fixture:health` 9/9, `validate:ground-truth` 10/10 |
| M1.2 静态分析 + IO 入口 | ✅ MVP | `cli/src/analyzer + io-mapper`, vitest 12/12, SymbolGraph 召回 100%, IO 100% |
| M1.3 数据流追踪 | ✅ MVP | `cli/src/tracer`, vitest 16/16, FlowGraph nodeCoverage 100%/edgeCoverage 91% |
| M1.4 业务翻译 + Provider | ✅ MVP | `cli/src/translator` 3 providers + prompt 模板, vitest 12/12, mock evidence 非空 100% |
| M1.5 2D 前端 + e2e | ✅ MVP | `web/` 三栏视图, `cli/src/eval/`, `npm run e2e:m1`, `reports/m1-accuracy.md` |

### 待人工最终签收(M1 退出条件最后一公里)

- [ ] **T-FINAL-1** 用户审阅本轮所有改动并 commit + push(本会话不动 git,按红线 #10 等用户拍板)
- [ ] **T-FINAL-2** 实跑一次 `npm run e2e:m1 -- --provider claude`(需 `ANTHROPIC_API_KEY`)— 验证 BusinessAnnotations labelMatchRate ≥ 80% 达到 SPEC §7 第 4 条要求(mock 当前 44%,真实 LLM 预期 ≥ 80%)
- [ ] **T-FINAL-3** 同步两份文档:
  - [ ] `docs/agents/codeviz-overview.md` 支持矩阵把 TS+Express+Prisma 行从 ⏳ 改 ✅
  - [ ] `docs/roadmap.md` M1 行从 🚧 改 ✅,版本号迁入"已发布版本"
- [ ] **T-FINAL-4** 把 `docs/milestones/feature_codeviz-m1.md` `git mv` 到 `docs/milestones/archive/`(按全局 §3.2 完工归档)+ 主索引 `docs/milestones.md` 进行中行剪到已归档区
- [ ] **T-FINAL-5** 本 todo 文件 `git rm`(M 完结清空原则)
- [ ] **T-FINAL-6** 合并 `feature/codeviz-m1` → `main`(用户授权后)

### 自动准确率数据(2026-05-19 mock provider)

来自 `reports/m1-accuracy.md`:

| 验收项 | 阈值 | 实际 | 结果 |
|---|---|---|---|
| SymbolGraph 召回 | ≥ 80% | 100.0% | PASS |
| IOEntryRegistry 准确 | = 100% | 100.0% | PASS |
| FlowGraph 主路径(4 entries 平均 nodeCoverage) | ≥ 80% | 100.0% | PASS |
| FlowGraph 主路径(4 entries 平均 edgeCoverage) | ≥ 80% | 91.0% | PASS |
| BusinessAnnotations(mock 规则引擎,非 LLM) | ≥ 80% | 44.0% | MISS(预期 — 等 ClaudeProvider 实跑) |
| BusinessAnnotations evidenceNonEmpty(红线 #2) | = 100% | 100.0% | PASS |

**整体三项 hard requirement(SymbolGraph / IO / FlowGraph)**: PASS

### 红线遵守自检

- [x] **目标项目源码只读**(red line #5) — 本轮全过程 `fixtures/fixture-a-order-app/` 下未修改任何文件
- [x] **支持的语言/框架显式声明**(red line #4) — 仅 TS+Express+Prisma;`analyze`/`map-io`/`trace` 遇到其他 stack 报错或跳过
- [x] **中间表示 schema 版本号**(red line #6) — 所有产出 JSON `schemaVersion: "0.1.0"`
- [x] **业务翻译禁止臆造**(red line #2) — mock + claude + ollama 三个 Provider 均强制 evidence 非空,空 evidence 强制 confidence=low + 占位 label
- [x] **3D 不是包装 2D**(red line #3) — M1 阶段 web 严格 2D(React Flow + dagre),3D 留待 M2
- [x] **后端 agent 不直接生成可视化代码**(red line #1) — CLI 仅产 JSON,web 独立读 JSON

---

## 不在 M1 范围 (避免范围蔓延)

按 SPEC §M2 / §M3 / `docs/agents/codeviz-overview.md` 阶段 3,以下推到 M2+:

- ❌ Java Spring / Vue3 SFC 支持(M2 用户最优先需求)
- ❌ NestJS @Controller 装饰器(SPEC §M1 选 Express)
- ❌ Python FastAPI(M3)
- ❌ 3D 渲染 + 防迷路交互全套(M2)
- ❌ 前端按钮 / Router 入口识别(M2)
- ❌ tree-sitter(M2 跨语言时引入,M1 用 ts-morph 足够)
- ❌ 大型项目分块 / LOD(M3)
- ❌ 静态发布 `codeviz view` 打包(M3)
- ❌ 缓存策略 + LLM token 预算监控(M2 真实 LLM 稳定使用时再做)

---

## 下一个 M 启动指引

当 M1 退出后,新建 `docs/milestones/feature_codeviz-m2.md` 并按 `~/.claude/CLAUDE.md` §2.2 把新 M 的子里程碑拆成 T 序列写入新建的 `docs/todo/feature_codeviz-m2.md`。M2 候选优先级(待与用户对齐):

1. Fixture-B(Spring + Vue3 最小订单系统)
2. static-code-analyzer 扩展 Java + Vue3 SFC
3. io-entry-mapper 扩展 Vue3 onClick + 前端 Router 入口
4. 3D 渲染 + 防迷路交互(`@react-three/fiber`)
5. 用户修正反馈机制(business-translator 学习用户改 label)
