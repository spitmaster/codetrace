# CLAUDE.md

> 给未来的 Claude:**先读 [docs/](docs/) 再动手**。本仓库的设计文档是真相源。
> 本项目遵循 `~/.claude/CLAUDE.md v1.3` 的全局工作约定。
> 本文件是 Claude Code 在本项目的入口配置;通用 SDD 行为规范见 [docs/ai-config/for-claude.md](docs/ai-config/for-claude.md),不在这里重复。

---

## 第零步:看当前进度

接手任何 session 第一步执行(摘自全局 `~/.claude/CLAUDE.md §5.2`):

1. `git branch --show-current` 拿到当前分支名
2. 推导 `docs/milestones/<branch with "/" → "_">.md` → 当前里程碑
3. 推导 `docs/todo/<branch with "/" → "_">.md` → 当前 M 的待办
4. 任一文件不存在 → 主动问用户:
   - (a) 新建?
   - (b) 这是探索性工作,不需要 milestone 跟踪?
   - (c) 用其他文件名?
5. 分支是 `main` / `develop` / `hotfix-*` 等非 feature 分支 → **不进 milestone 上下文**,主动问用户做什么

> 当前状态(2026-05-18):分支 `feature/codeviz-m1`,**SDD M1 启动中**。当前活动子里程碑 → **M1.1 测试夹具就位**。任务清单见 [docs/todo/feature_codeviz-m1.md](docs/todo/feature_codeviz-m1.md);M1 整体路径见 [docs/milestones/feature_codeviz-m1.md](docs/milestones/feature_codeviz-m1.md)。

---

## 第一步:读设计文档

按顺序读(前 6 篇是 codeviz 项目工作必读,7-8 是脚手架本体规范):

1. [SPEC.md](SPEC.md) ⭐ — 产品意图真相源 (M1 当前范围)
2. [docs/agents/codeviz-overview.md](docs/agents/codeviz-overview.md) ⭐ — 技术架构真相源 (双层 agent + 4 schema + 红线)
3. [docs/agents/codeviz-orchestrator.md](docs/agents/codeviz-orchestrator.md) — 主调度职责(跨层联调入口)
4. [docs/roadmap.md](docs/roadmap.md) — 粗粒度路径 + 非目标 + 支持矩阵
5. [docs/milestones.md](docs/milestones.md) + [milestones/feature_codeviz-m1.md](docs/milestones/feature_codeviz-m1.md) — 中粒度里程碑
6. [docs/todo/feature_codeviz-m1.md](docs/todo/feature_codeviz-m1.md) — 当前可勾选任务
7. [docs/03-工作流程.md](docs/03-工作流程.md) — SDD 通用流程(脚手架本体)
8. [docs/ai-config/for-claude.md](docs/ai-config/for-claude.md) — Claude Code 通用行为规范(脚手架本体)

---

## 项目一句话定位

**代码可视化阅读器 (codeviz)** — 读取源码库 → 识别 IO 入口(接口、按钮、CLI)→ AI 把代码翻译成中文业务语言 → 在浏览器中像"看流水"一样展示完整数据流。差异化不在 3D,而在 **"IO 入口驱动 + AI 业务翻译 + 完整数据流追踪"** 三者组合。

**当前 M1 范围**:TS + React + Express + Prisma 主链路验证,2D 展示,业务翻译准确率 ≥ 80%。**Java Spring + Vue3 在 M2 落地**(用户实际需求,从 overview 原阶段 3 提前到 M2)。

---

## 不可违反的架构不变量

### 通用红线 (SDD + 全局规范)

1. **[MUST] SPEC 先行** — 任何代码改动前,需求必须在 [SPEC.md](SPEC.md) 中可追溯;无 SPEC 不开发
2. **[MUST] 文档真相源** — `docs/` 与代码注释/README/git log 冲突时以 `docs/` 为准;**产品意图真相源 = [SPEC.md](SPEC.md);技术架构真相源 = [docs/agents/codeviz-overview.md](docs/agents/codeviz-overview.md)**;不一致则修文档或修代码,二者不许并存
3. **[MUST] 脚手架本体与项目业务隔离** — `docs/agents/`(除 codeviz-overview.md 和 codeviz-orchestrator.md 是 codeviz 项目层)、`docs/commands/`、`docs/skills/`、`docs/templates/`、`docs/ai-config/`、`docs/scripts/`、`docs/prompts/`、`docs/example/` 是**脚手架本体**(上游 `spitmaster/sdd-starter` 维护范围)。改动这些目录用 `scaffold:` 前缀,业务改动用 `feat:` / `fix:` 等常规前缀,**两类改动不混 commit/PR**
4. **[MUST] olddocs/ 内容是脚手架自带示例** — 不是本项目真实需求;AI 配置指南里的"P0 olddocs 自动吸收"流程在本仓库**禁用**
5. **[MUST] 红线动作执行边界** — 改 version / 包发布 / 推 main / 合并到长期分支 / 改生产 / 删除已 git 跟踪文件等,一律先 AskUserQuestion 取得明确同意,不可"逻辑必然路径"打包推理(对齐全局 §10)

### codeviz 业务级红线 (摘自 [docs/agents/codeviz-overview.md §红线](docs/agents/codeviz-overview.md#红线项目级架构不变量),与上方通用红线并列,均为 MUST)

1. **[MUST] 后端 agent 不直接生成可视化代码** — 必须产出中间表示 JSON;3D/2D 渲染交给前端 agent
2. **[MUST] 业务翻译禁止臆造** — LLM 翻译只能基于已抽取的代码 evidence;evidence 为空拒绝采用;猜测必须标 `confidence=low`
3. **[MUST] 3D 不是包装 2D** — 一个交互在 2D 节点图里更高效就别强行 3D;M1 阶段表现为"先做 2D"
4. **[MUST] 支持的语言/框架显式声明** — M1 只声明 TypeScript + React + Express + Prisma;其他一律不分析(报错或跳过),不"尽力而为"
5. **[MUST] 目标项目源码只读** — 任何 agent 都不允许修改用户输入的目标代码库
6. **[MUST] 中间表示有 schema 版本号** — SymbolGraph / IOEntryRegistry / FlowGraph / BusinessAnnotations 之间传递的 JSON 必须有版本号与 schema 校验;改动需升版 + orchestrator 把关

---

## 关键目录速查

### codeviz 项目业务 (核心)

| 目录 / 文件 | 职责 | 状态 |
|---|---|---|
| [SPEC.md](SPEC.md) | 产品意图真相源 (M1 范围) | ✅ 已建 |
| [docs/roadmap.md](docs/roadmap.md) | 粗粒度路径 + 非目标 + 支持矩阵 | ✅ 已建 |
| [docs/milestones.md](docs/milestones.md) | 中粒度索引(进行中/已归档) | ✅ 已建 |
| [docs/milestones/feature_codeviz-m1.md](docs/milestones/feature_codeviz-m1.md) | 当前分支里程碑(5 个子 M) | ✅ 已建 |
| [docs/todo/feature_codeviz-m1.md](docs/todo/feature_codeviz-m1.md) | 当前 M1.1 任务清单 | ✅ 已建 |
| [docs/agents/codeviz-overview.md](docs/agents/codeviz-overview.md) | 技术架构真相源 + 4 schema + 红线 | ✅ 已建 |
| [docs/agents/codeviz-orchestrator.md](docs/agents/codeviz-orchestrator.md) | 主调度职责 | ✅ 已建 |
| `cli/` | 分析器 CLI (Node + TS + tree-sitter) | ⏳ M1.2 起 |
| `web/` | 浏览器前端 (React + Vite) | ⏳ M1.5 起 |
| `fixtures/fixture-a-order-app/` | M1 标准测试夹具 | ⏳ M1.1 起 |

### 脚手架本体 (上游 sdd-starter 维护)

| 目录 / 文件 | 职责 |
| --- | --- |
| [README.md](README.md) | 脚手架总入口 + 场景导航 |
| [docs/01-..08-*.md](docs/) | 核心使用文档(8 篇) |
| [docs/agents/](docs/agents/) | 通用 agent(static-code-analyzer / io-entry-mapper / dataflow-tracer / business-translator / 3d-rendering-engineer / 3d-interaction-designer / fixture-validator)+ codeviz 项目编排 |
| [docs/templates/](docs/templates/) | SPEC / 变更日志 / 审查清单 模板 |
| [docs/skills/](docs/skills/) | 可复用 skill |
| [docs/commands/](docs/commands/) | 自定义 slash 命令(如 `/sdd-starter`) |
| [docs/ai-config/](docs/ai-config/) | 6 种 AI 工具配置文件 |
| [docs/scripts/](docs/scripts/) | 初始化 / SPEC 验证脚本 |
| [docs/prompts/](docs/prompts/) | 提示词库 |
| [docs/example/](docs/example/) | 示例代码 |
| [olddocs/](olddocs/) | ⚠️ 脚手架示例(见红线 #4),非本项目真实需求 |

---

## 测试 / 健康检查

> M1.1 前业务代码暂未实现,只能跑脚手架级检查。M1.1 后会逐步补 `fixture:health` / `cli:test` / `web:dev`。

```powershell
# === 脚手架级 (永远可跑) ===

# 1. 验证脚手架核心文档可读
Test-Path docs\README.md, docs\01-使用说明.md, docs\03-工作流程.md, docs\AI配置指南.md

# 2. 验证 6 种 AI 工具配置都齐
Get-ChildItem docs\ai-config\for-*.md | Measure-Object | Select-Object Count

# 3. 验证 git 状态干净
git status

# === codeviz 项目级 (随 M1 子里程碑逐步补) ===

# M1.1 完成后能跑:
# npm run fixture:health          # Fixture-A 启动 + curl 4 endpoints + ground-truth schema 校验

# M1.2 - M1.4 完成后能跑:
# npm run cli:test                # CLI 单测
# node cli/dist/index.js analyze fixtures/fixture-a-order-app

# M1.5 完成后能跑:
# npm run fixture:validate        # 端到端: analyze → 4 份 JSON vs ground-truth → 准确率报告
# npm run web:dev                 # 浏览器 view 模式
```

---

## 沟通约定

- **语言**:中文
- **红线动作**:严格按全局 `~/.claude/CLAUDE.md §10` 执行 — 任何不可逆 / 影响共享系统的动作先 AskUserQuestion,即使存在"逻辑必然路径"也不打包推理
- **三档规划文档**:按全局 §2 — `roadmap.md` / `milestones.md` / `todo.md`,粒度递进;场景 B 模糊探索期可只用 `todo/<branch>.md` 加一份轻量 `design.md`(全局 §6.2 小项目模式),后续升级
- **commit message 前缀**:`scaffold:` 改脚手架本体 / `feat:` 业务新功能 / `fix:` 缺陷 / `docs:` 仅改文档 / `chore:` 杂项
