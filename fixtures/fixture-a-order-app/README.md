# Fixture-A — Order System(codeviz M1 标准测试夹具)

> **角色**:codeviz M1 主链路验证的**目标项目**(target)。不是 codeviz 本身。
> **整体形态**:一个最小可跑通"列表 → 创建 → 详情 → 取消"流程的订单系统,前后端各自一份 README。
> **范围**:4 张表 + 4 个 HTTP endpoints + 1 条核心业务规则(库存扣减不能为负)。
>
> **目录:**
> - [`backend/`](./backend) — Express + Prisma + SQLite,被 M1 的 codeviz 分析(详见 [backend/README.md](./backend/README.md))
> - [`frontend/`](./frontend) — Vite + React 18(详见 [frontend/README.md](./frontend/README.md));**M1 不分析**,M2 起作为前端入口识别 fixture
> - [`ground-truth/`](./ground-truth) — 4 种中间表示的"参考答案"JSON,M1.2 – M1.5 的回归对照
> - [`scripts/`](./scripts) — `health-check.sh` 一键自检(由仓库根 `npm run fixture:health` 调用)

---

## 1. 完整启动(浏览器跑通流程)

两个终端,先后启动:

```bash
# === 终端 1: backend(端口 4000)===
cd fixtures/fixture-a-order-app/backend
npm install                       # 首次
cp .env.example .env              # 首次
npx prisma migrate dev --name init  # 首次,生成 SQLite
npm run seed                      # 灌种子(3 用户 + 5 产品 + 2 示例订单)
npm run dev                       # 看到 listening on http://localhost:4000

# === 终端 2: frontend(端口 5173,proxy /api → 4000)===
cd fixtures/fixture-a-order-app/frontend
npm install                       # 首次
npm run dev                       # 看到 ready in xxx ms,访问 http://localhost:5173
```

浏览器打开 http://localhost:5173,左侧切用户 → "新建订单"选商品提交 → 跳详情 → "取消订单"。

## 2. 仅后端 + 一键体检(不需要前端)

```bash
# 在仓库根
npm run fixture:health
```

会自动 seed + 启 backend(私有端口 4100,不影响 4000 上的手动 dev)+ curl 4 个 endpoints + 验断言 + 关 backend。当前 9/9 断言通过。

## 3. 在 codeviz 里的角色

| codeviz 中间表示 | 在 fixture-A 中的对应 |
|---|---|
| SymbolGraph | `backend/src/{routes,services,lib}/**/*.ts` 的符号 + 调用边 + Prisma 数据访问点 |
| IOEntryRegistry | `backend/src/{app,routes/orders}.ts` 注册的 5 个 HTTP entries(含 `/health`) |
| FlowGraph | 4 个业务 endpoint 各一份(M1.1 起 4/4 ground-truth 就位) |
| BusinessAnnotations | 4 个业务 endpoint 的中文翻译 + evidence(M1.1 起 4/4 ground-truth 就位) |

ground-truth 文件清单见 [`ground-truth/`](./ground-truth) 与本仓库根 `npm run validate:ground-truth`(10 份全部通过 zod schema 校验)。

## 4. 不变量提醒(改 fixture 时三处必须同步)

改 `backend/src/**` 函数命名 / 拓扑 / 行号 时,以下三处必须一起改:

1. `backend/README.md §4 业务意图清单`(BusinessAnnotations 文本来源)
2. `ground-truth/symbol-graph.expected.json` + `ground-truth/flow-graph-*.expected.json` 中的 `symbolId` / `fileLocation.line`
3. `ground-truth/business-annotations-*.expected.json` 的 `evidence` 字段引用

三者中任一与代码现状不一致,M1.2 – M1.5 的回归会无法准确报告,且违反 codeviz red line #2(anti-fabrication)。

---

## 5. 与 codeviz 的红线

- **目标项目源码只读**(codeviz overview 红线 #5):非 fixture 维护任务,任何 codeviz agent 都不应改 `backend/` 与 `frontend/`。
- **支持语言/框架显式声明**(红线 #4):M1 fixture-A 涵盖 **TypeScript + Express + Prisma**(backend)与 **TypeScript + React**(frontend, M2 才被分析)。
