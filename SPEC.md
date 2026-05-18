# SPEC.md — 代码可视化阅读器 (codeviz)

> 项目代号: **codeviz**
> SPEC 版本: 0.1.0 (M1 草案)
> 范围: **本 SPEC 锁定 M1**;M2/M3 给方向不展开
> 真相源分工:
> - **产品意图**真相源 = 本文件
> - **技术架构**真相源 = [docs/agents/codeviz-overview.md](docs/agents/codeviz-overview.md)
> - schema 详情见 overview, 本 SPEC 不复制 schema 全文
> 最后更新: 2026-05-18

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 项目名称 | 代码可视化阅读器 (codeviz) |
| 项目简介 | 读取任意源码库,识别 IO 入口(HTTP 接口、按钮、CLI),用 AI 把代码翻译成中文业务语言,在浏览器中以图形化方式展示"一次业务的完整数据流"。 |
| 目标用户 | (主) 接手他人代码 / AI 生成代码的程序员;(次) 项目新人入职 onboarding;(明确不是) 重构工具用户、代码质量审查者、设计师 |
| 核心问题 | 人类理解代码效率 << AI 读代码效率,导致 AI 写的代码人类看不懂。codeviz 把 AI 的代码理解"翻译并可视化",让人类能跟上节奏。 |
| 差异化 | 不是 3D 表现,是 **"IO 入口驱动 + AI 业务翻译 + 完整数据流追踪"** 三者组合。详见 [overview 一句话定位](docs/agents/codeviz-overview.md#一句话定位) |
| 现有参照 | Sourcegraph / CodeSee (2D,缺数据流);CodeCity (静态建筑隐喻,不流动);Gource (时间维度) — 都没做"按入口 → 流转 → 业务语言"组合 |

## 2. 功能需求

按 [overview 三阶段路径](docs/agents/codeviz-overview.md#启动依赖顺序三阶段) 拆。**本 SPEC 详写 M1,M2/M3 仅给方向**。

### M1: 主链路验证 (本 SPEC 核心)

#### 功能 1 — 静态分析,产出 SymbolGraph

- **描述**: CLI 命令 `codeviz analyze <path>`,输出包含符号、调用、框架点、数据访问点的 JSON
- **用户故事**: 作为开发者,我对着一个 React+Express+Prisma 项目跑一条命令,得到能描述代码结构的中间表示
- **负责 agent**: static-code-analyzer
- **范围**: TypeScript 解析(tree-sitter-typescript)、Express 路由 或 NestJS Controller 二选一、Prisma 调用映射
- **验收**:
  - [ ] 识别 Express @decorator 路由(或 NestJS @Controller,二选一)
  - [ ] 识别 Prisma 调用 (`prisma.<model>.<op>`) 并映射为 dataAccessPoints
  - [ ] 产出 SymbolGraph JSON 符合 [overview schema 0.1.0](docs/agents/codeviz-overview.md#symbolgraphstatic-code-analyzer-产出)
  - [ ] 在 Fixture-A 上,符号召回率 ≥ 80%

#### 功能 2 — IO 入口识别,产出 IOEntryRegistry

- **描述**: 从 SymbolGraph 筛出 HTTP endpoint,生成入口注册表
- **用户故事**: 作为开发者,我希望看到这个项目所有"从外部触发"的入口
- **负责 agent**: io-entry-mapper
- **范围**: **仅 HTTP 路由** (POST/GET/PUT/DELETE);前端按钮入口推到 M2
- **验收**:
  - [ ] 在 Fixture-A 上识别全部 HTTP endpoints,准确率 **100%**
  - [ ] 每个 entry 包含 `displayName` + `handlerSymbolId`,可双向追溯
  - [ ] 符合 IOEntryRegistry schema 0.1.0

#### 功能 3 — 单入口数据流追踪,产出 FlowGraph

- **描述**: 给定 entryId,从 handler 出发追踪调用链 + DB 读写 + 文件操作
- **用户故事**: 作为开发者,选一个接口,我想看到它"经过哪些函数、读写哪些表"
- **负责 agent**: dataflow-tracer
- **范围**:
  - 调用链深度上限 10(超出标 truncations)
  - 节点 kind: `function / table / file / input / response`
  - M1 **不做**: `external-api / queue` (推到 M2)
- **验收**:
  - [ ] Fixture-A 每个 endpoint 都能追到数据库写入或读取
  - [ ] DI 容器调用能展开,不停在 controller
  - [ ] cycles 与 truncations 显式标注,不省略
  - [ ] 符合 FlowGraph schema 0.1.0

#### 功能 4 — 中文业务翻译,产出 BusinessAnnotations

- **描述**: 把 FlowGraph 的每个节点 + 边翻译成中文业务语言,并写一段整体 narrative
- **用户故事**: 作为开发者,我希望读到「创建订单 → 校验库存 → 写订单表 → 通知支付服务」,而不是「OrderController.create → InventoryService.check → prisma.order.create」
- **负责 agent**: business-translator
- **范围**:
  - LLM 抽象层 (Provider) 至少支持 **Claude + Ollama** 两种实现
  - 默认 Provider = Claude
  - 强制 evidence: 空 evidence 拒绝翻译,产出 `confidence=low + placeholder`,不臆造
  - 置信度三档: `high / medium / low`
- **验收**:
  - [ ] Fixture-A 全部 endpoints 上,人工评估业务翻译准确率 ≥ **80%** (high+medium 占比)
  - [ ] 空 evidence 时不输出 high/medium 置信度的翻译
  - [ ] Provider 抽象通过单测验证 Claude / Ollama 可切换
  - [ ] 符合 BusinessAnnotations schema 0.1.0

#### 功能 5 — 2D 浏览器展示 (M1 不上 3D)

- **描述**: 在浏览器中以 **2D 节点图** 展示一个 entry 的 FlowGraph + BusinessAnnotations
- **用户故事**: M1 阶段验证主链路正确性,2D 已经能呈现核心价值;3D 留到 M2
- **负责 agent**: 3d-rendering-engineer (运行在 "2D-degraded 模式") + 3d-interaction-designer (基础侧栏)
- **范围**: 2D 节点图 + 详情侧栏 + entries 列表
- **验收**:
  - [ ] 浏览器加载 `codeviz-output.json`,列出所有 entries
  - [ ] 选中一个 entry,显示其 2D FlowGraph + 中文 narrative
  - [ ] 节点点击显示 businessLabel + evidence
  - [ ] 置信度 = low 的节点视觉灰化 + ❓ 标记

#### 功能 6 — 测试夹具与端到端回归

- **描述**: 维护 Fixture-A (React+Express+Prisma 最小订单系统),固定 ground-truth,跑端到端回归
- **用户故事**: 任何 agent 改完后跑回归,确保准确率不退化
- **负责 agent**: fixture-validator
- **验收**:
  - [ ] Fixture-A 项目可独立启动 (前后端连通)
  - [ ] ground-truth 文件覆盖四种中间表示
  - [ ] 一键回归脚本 `npm run fixture:validate`

### M2: 加 3D + 扩展支持 (方向,不展开)

- 3D 渲染 + 防迷路交互全套
- io-entry-mapper 扩展前端按钮(Vue3 onClick + Router 入口)
- static-code-analyzer 扩展 Java(tree-sitter-java)+ Vue3 SFC(@vue/compiler-sfc)
- **Java Spring + Vue3** 加入支持矩阵(用户实际需求落地)
- Fixture-B (Spring + Vue3 最小订单系统)

### M3: 性能与覆盖 (方向,不展开)

- 大型项目支持 (LOD、instancing、子图分块加载)
- Python FastAPI 支持
- 静态发布

## 3. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 (M1) | Fixture-A (~50 files / ~2K LOC) 全量分析 < 30 秒 |
| 性能 (M2) | Java Spring 中型项目 (~500 files) 全量分析 < 5 分钟 |
| 安全 | LLM API key **只在 CLI 端**,不出现在前端 bundle;按 [overview 红线 #5](docs/agents/codeviz-overview.md#红线项目级架构不变量) 目标项目源码只读 |
| 兼容性 | Node.js ≥ 18;现代浏览器 (Chrome / Edge / Firefox 最新两版) |
| 可用性 | 即使 M1 是 2D,也必须有 entries 列表 + 当前 entry 面包屑(防迷路最低门槛) |

## 4. UI/UX 规范 (M1 范围)

### 页面结构

```
codeviz UI (浏览器)
├── 顶栏: 项目名 + entry 切换面包屑 + 加载/重载按钮
├── 左侧栏 (固定宽 280px): Entries 列表
│   └── 按 group (订单 / 用户 / ...) 分类, 显示 method + path
├── 中央 (主区域): 当前 entry 的 2D FlowGraph
│   └── 节点 = 圆角矩形, 边 = 带箭头线
└── 右侧栏 (固定宽 360px, 可隐藏): 详情面板
    ├── 整体 narrative (中文段落)
    ├── 选中节点的 businessLabel + businessDescription + confidence
    └── evidence 列表 (代码事实, 可点击跳转到源文件)
```

### 视觉规范

| 元素 | 规范 |
|---|---|
| **节点颜色** | function = 蓝;table = 绿;file = 橙;input/response = 灰 |
| **边样式** | call = 实线;write = 粗实线 + 实心箭头;read = 虚线;delete = 红粗实线 |
| **置信度** | high = 100% 不透明;medium = 70% 不透明;low = 40% 不透明 + ❓ 图标 |
| **字体** | 系统默认无衬线;node label 14px;narrative 16px |
| **间距** | 节点最小间距 80px;布局算法 dagre (TB 方向) |

### 组件规范

| 组件 | 用途 | 状态 |
|---|---|---|
| EntryListItem | 左栏单条 entry | default / hover / selected |
| FlowNode | 中央 FlowGraph 节点 | default / hover / selected / low-confidence |
| FlowEdge | 中央 FlowGraph 边 | default / highlighted (节点选中时关联边) |
| EvidencePopover | 点击 evidence 弹出代码片段 | default / loading / error |

## 5. 技术架构

### 技术栈

| 类别 | 选择 |
|---|---|
| CLI (分析器) | Node.js 18+ + TypeScript |
| AST 解析 | tree-sitter + tree-sitter-typescript |
| LLM | Provider 抽象层 (默认 Claude via `@anthropic-ai/sdk`,可切 OpenAI / Ollama) |
| 浏览器前端 | Vite + React 18 + TypeScript + Tailwind CSS + Zustand |
| 2D 可视化 (M1) | `@xyflow/react` (React Flow,生态最成熟) |
| 3D 可视化 (M2+) | `@react-three/fiber` + `@react-three/drei` + three.js |
| 测试夹具 | React + Express + Prisma + SQLite |

### 项目结构 (M1)

```
codeviz/                       # 本仓库根
├── cli/                       # 分析器 CLI
│   ├── src/
│   │   ├── analyzer/          # static-code-analyzer 实现
│   │   ├── io-mapper/         # io-entry-mapper 实现
│   │   ├── tracer/            # dataflow-tracer 实现
│   │   ├── translator/        # business-translator + LLM Provider
│   │   ├── schemas/           # SymbolGraph/IOEntryRegistry/FlowGraph/BusinessAnnotations zod schemas
│   │   └── output/            # JSON 序列化 + schema 校验
│   └── package.json
├── web/                       # 浏览器前端
│   ├── src/
│   │   ├── components/
│   │   ├── store/
│   │   └── flow/              # FlowGraph 2D 渲染
│   └── package.json
├── fixtures/
│   └── fixture-a-order-app/   # M1 标准测试夹具
│       ├── frontend/          # React 最小订单 UI
│       ├── backend/           # Express + Prisma 订单 API
│       ├── prisma/
│       └── ground-truth/      # 期望的 4 份 JSON
├── SPEC.md
└── docs/...
```

## 6. API 设计

### CLI 接口

```bash
# 全量分析项目, 产出 4 份 JSON
codeviz analyze <path> \
  [--output codeviz-output.json] \
  [--llm-provider claude|openai|ollama] \
  [--llm-model <model-id>] \
  [--depth-limit 10]

# 启动本地查看器 (本地 http server + 自动打开浏览器)
codeviz view <output.json> [--port 5173]
```

### 中间表示 schema

| Schema | 版本 | 产出方 | 消费方 |
|---|---|---|---|
| SymbolGraph | 0.1.0 | static-code-analyzer | io-entry-mapper, dataflow-tracer |
| IOEntryRegistry | 0.1.0 | io-entry-mapper | dataflow-tracer, web frontend |
| FlowGraph | 0.1.0 | dataflow-tracer | business-translator, web frontend |
| BusinessAnnotations | 0.1.0 | business-translator | web frontend |

详细字段见 [docs/agents/codeviz-overview.md 中的 4 个 schema](docs/agents/codeviz-overview.md#项目特定的中间表示schema-草案)。

**SPEC 不复制 schema 全文,以 overview 为单一真相源**。M1 期间 schema 变动必须同步两边并升 version,由 codeviz-orchestrator 把关。

## 7. 验收标准

### M1 完成标准 (全部勾完 = M1 验收通过)

- [ ] 分析器 CLI 可执行,对 Fixture-A 产出 4 份符合 schema 的 JSON
- [ ] 浏览器 web 可加载 JSON,展示 entries 列表 + 单 entry 2D FlowGraph + 中文 narrative
- [ ] Fixture-A 准确率:
  - SymbolGraph 召回 ≥ 80%
  - IOEntryRegistry 准确 100%
  - FlowGraph 主路径覆盖 ≥ 80%
  - BusinessAnnotations 人工评估 ≥ 80%
- [ ] 一键端到端回归脚本通过
- [ ] LLM Provider 抽象层至少 Claude + Ollama 两种实现

### 测试用例

| 用例 | 步骤 | 预期结果 |
|---|---|---|
| 解析 Fixture-A | `codeviz analyze fixtures/fixture-a-order-app` | 产出 4 份 JSON,schema 校验通过 |
| 入口识别 | 查看 IOEntryRegistry | 覆盖 Fixture-A 全部 HTTP endpoints |
| 数据流追踪 | 选 `POST /api/orders` | FlowGraph 包含 OrderController.create → OrderService.create → prisma.order.create → orders 表 |
| 业务翻译质量 | 同 entry | narrative 包含「创建订单 / 库存校验 / 写订单表」等中文语义 |
| 置信度可见 | 浏览器查看节点 | 每节点都有 confidence;low 节点视觉灰化 + ❓ |
| 浏览器查看 | `codeviz view output.json` | 自动打开浏览器,显示 entries 列表;选一个能看 2D 流程图 |
| LLM Provider 切换 | 改 `--llm-provider ollama` | 翻译仍可跑 (质量允许下降,但不能崩) |
| evidence 不臆造 | 故意制造一段无 evidence 代码 | 输出 confidence=low + placeholder,不出现高置信编造 |

## 8. 架构不变量 (M1 强约束)

继承 [overview 红线 #1-6](docs/agents/codeviz-overview.md#红线项目级架构不变量),在 M1 阶段表现为:

1. **后端 agent 不直接生成可视化代码** — CLI 只产 JSON
2. **业务翻译禁止臆造** — 空 evidence 拒绝;低置信度真实标记
3. **M1 不上 3D** — overview 红线 #3 「3D 不是包装 2D」在 M1 表现为「先做 2D」
4. **支持语言/框架显式声明** — M1 只声明 **TypeScript + React + Express + Prisma**,其他一律不分析(报错或跳过)
5. **目标项目源码只读**
6. **schema 版本号显式声明** — 改动需升版 + orchestrator 把关

## 9. 风险登记

| 风险 | 严重度 | 缓解方案 |
|---|---|---|
| LLM 业务翻译准确率 < 80% | ★★★★★ | M1 核心使命就是把它调上去;强制 evidence + 置信度 + 用户修正反馈机制;LLM provider 选优势模型(默认 Claude) |
| Prisma 链式调用追踪断链 | ★★★★ | dataflow-tracer 专门 Prisma 模式适配;失败处标 confidence=low 不假装通畅 |
| Express 依赖注入展开 | ★★★ | static-code-analyzer 覆盖标准 Express middleware 模式;边缘模式留 truncation 标记 |
| 浏览器加载大 JSON 卡顿 | ★★★ | M1 Fixture-A 规模小不会触发;M2 大项目时上分块加载 / LOD |
| schema 早期变更频繁 | ★★★ | overview 集中管理 + 版本号强制 + orchestrator 把关 |
| Fixture-A 设计过于玩具 | ★★ | 必须有 4+ 表 + 复合业务规则(库存扣减、订单状态机),否则翻译质量验证没说服力 |

## 10. 附录

### 术语表

| 术语 | 定义 |
|---|---|
| IO 入口 | 外部可触发的代码点: HTTP 路由 / 按钮 / CLI 子命令 / 队列消费者 / 定时任务 |
| SymbolGraph | 代码事实的中间表示 (符号 + 调用 + 框架点 + 数据访问点) |
| IOEntryRegistry | 项目所有 IO 入口的注册表 |
| FlowGraph | 单个 IO 入口出发的完整数据流图 |
| BusinessAnnotations | LLM 对 FlowGraph 的中文业务翻译 + 置信度 |
| Fixture-A | M1 标准测试夹具,React + Express + Prisma 最小订单系统 |
| evidence | 业务翻译的代码事实依据;空 evidence 不允许翻译 |
| confidence | high / medium / low 三档置信度 |
| Provider | LLM 抽象层接口,允许配置切换 Claude / OpenAI / Ollama |

### 参考资料

- [docs/agents/codeviz-overview.md](docs/agents/codeviz-overview.md) — 项目层技术真相源
- [docs/agents/codeviz-orchestrator.md](docs/agents/codeviz-orchestrator.md) — 主调度职责
- [docs/agents/](docs/agents/) — 各通用 agent 定义
- [CLAUDE.md](CLAUDE.md) — 项目级 Claude Code 入口
- 全局规范: `~/.claude/CLAUDE.md` v1.3

### 修订日志

| 日期 | 版本 | 修订 |
|---|---|---|
| 2026-05-18 | 0.1.0 | 初稿。M1 锁定 TS+React+Express+Prisma 主链路验证;Java Spring + Vue3 提升到 M2(用户优先需求落地) |
