# Roadmap — 代码可视化阅读器 (codeviz)

> 粗粒度功能版图与时间路径。具体里程碑见 [milestones.md](milestones.md);具体待办见 [todo/](todo/)。
> 真相源:
> - **产品意图** → [SPEC.md](../SPEC.md)
> - **技术架构** → [agents/codeviz-overview.md](agents/codeviz-overview.md)
> 最后更新: 2026-05-18

---

## 一句话定位

把 AI 对代码的语义理解 + 静态分析 + 3D 可视化,组合成"业务流水"级别的代码阅读体验 — 选一个 endpoint / 按钮 / CLI 命令,系统在 3D 空间里把这次业务的完整数据流转放映出来。

## 主线: 验证 → 表达 → 覆盖

| 阶段 | 一句话目标 | 状态 | 详情 |
|---|---|---|---|
| **M1** | 主链路验证:TS+React+Express+Prisma 上,业务翻译 ≥ 80% 准确 + 2D 展示 | 🚧 进行中 (feature/codeviz-m1) | [milestones/feature_codeviz-m1.md](milestones/feature_codeviz-m1.md) |
| **M2** | 加 3D + 扩展 Java Spring + Vue3 支持(用户实际需求落地) | ⏳ 计划中 | TBD |
| **M3** | 性能与覆盖:大型项目 + Python FastAPI | ⏳ 计划中 | TBD |

## 已发布版本

(暂无)

## 明确的非目标 (Non-goals)

避免范围蔓延,以下显式**不做**:

- ❌ 自动重构 / 自动修 bug
- ❌ 代码质量度量(复杂度评分等)
- ❌ Git 历史动画(Gource 做过,不重复)
- ❌ 代码城市隐喻(CodeCity 做过,我们做流水不做建筑)
- ❌ 实时协作多人编辑(M1-M3 是单机工具)
- ❌ IDE 插件(M1-M3 不做,M3 后视情况再议)
- ❌ 修改用户目标项目源码(overview 红线 #5)
- ❌ 训练 / fine-tune 自有模型(用现成 LLM Provider)

## 支持矩阵

详见 [agents/codeviz-overview.md 支持矩阵](agents/codeviz-overview.md#codeviz-当前支持矩阵初始)。

| 语言 | 框架 | 数据访问 | 状态 |
|---|---|---|---|
| TypeScript | React | — | M1 目标 |
| TypeScript | Express / NestJS | Prisma | M1 目标 |
| TypeScript | Vue3 | — | M2 目标 (用户优先需求) |
| Java | Spring | MyBatis / JPA | M2 目标 (用户优先需求) |
| Python | FastAPI | SQLAlchemy | M3 目标 |

支持矩阵扩展必须先建夹具,再开发 — 见 [fixture-validator agent 红线](agents/fixture-validator.md)。

## 修订日志

| 日期 | 修订 |
|---|---|
| 2026-05-18 | 初稿。M1 锁定 TS+React+Express+Prisma;**M2 扩展 Java Spring + Vue3** — 从 overview 原阶段 3 提前到 M2,落实用户实际需求 |
