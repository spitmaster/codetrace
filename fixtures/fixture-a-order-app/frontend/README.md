# Fixture-A Frontend — Order UI

> **角色**:codeviz M1 fixture-A 的目标项目前端,**M1 阶段不被 codeviz 分析**(M2 才扩展前端按钮入口识别)。
> **技术栈**:Vite + React 18 + TypeScript,使用浏览器原生 `fetch`,无外部状态库。
> **作用**:配合 `backend/`,让 fixture-A 是一套可以从浏览器跑通"列表 → 创建 → 详情 → 取消"完整流程的真实订单系统;M2 起会被 codeviz 当作目标项目分析(识别 onClick 入口、Router 入口)。

---

## 1. 快速启动(需要 backend 先起来)

两边端口:
- backend 监听 **4000**(`backend/.env` 默认 `PORT=4000`)
- frontend 开发服务器监听 **5173**,通过 vite proxy 把 `/api/*` 转发到 `http://localhost:4000`

```bash
# 第一次需要装依赖(本仓库 SOP 是不替用户安装,自己跑一次)
cd fixtures/fixture-a-order-app/frontend
npm install

# 启 frontend(默认 5173)
npm run dev
```

确保 backend 也起着:

```bash
# 另一个终端
cd fixtures/fixture-a-order-app/backend
npm run dev
# 看到 [fixture-a backend] listening on http://localhost:4000 即 OK
```

打开 http://localhost:5173,左上角"当前用户"切换 `user_alice / user_bob / user_carol`(seed 三个用户),开始走流程。

## 2. 页面与 API 映射

| 页面 | 对应 backend endpoint | 业务用途 |
|---|---|---|
| 左侧导航 → 我的订单 | `GET /api/orders?page=&pageSize=` | 列当前用户订单 |
| 左侧导航 → 新建订单 | `POST /api/orders` | 选商品 + 数量,提交创建 |
| 列表点行 / 创建后跳转 | `GET /api/orders/:id` | 订单详情(展开 items + product 摘要) |
| 详情页 → 取消订单按钮 | `DELETE /api/orders/:id` | 仅 `pending` 状态可取消;取消后刷新详情 |

所有请求都在 `src/api.ts` 里封装,固定带上当前选中的 `x-user-id` header(M1 假鉴权)。

## 3. 关键代码定位

```
frontend/src/
├── main.tsx              # React 入口
├── App.tsx               # 顶层路由(本地 state,无 router 依赖)
├── api.ts                # backend 4 个 endpoint 的客户端 + ApiError + seed 用户/商品镜像
├── styles.css            # 全局样式
└── pages/
    ├── OrderListPage.tsx     # GET /api/orders
    ├── CreateOrderPage.tsx   # POST /api/orders
    └── OrderDetailPage.tsx   # GET /api/orders/:id + DELETE /api/orders/:id
```

`api.ts` 中的 `SEED_USERS` 与 `SEED_PRODUCTS` 与 `backend/prisma/seed.ts` 中的 id/价格保持一致(分单位)。改 seed 时也要回来同步。

## 4. 在 codeviz 里的角色 / 不做什么

- **M1**:不被 codeviz 分析,只是让 fixture-A 体验闭环可走完。
- **M2**:会被 codeviz 分析,作为前端按钮入口识别的 fixture。
- ❌ 不引入 react-router / Zustand / Redux / Tailwind —— 让 M2 的入口识别可以聚焦于「onClick 按钮」与「fetch 入口」两种最基础的模式。
- ❌ 不写测试 —— M1 已用 `npm run fixture:health`(在仓库根)从 backend 侧覆盖。

## 5. 与 codeviz 的红线

- **目标项目源码只读**(codeviz overview 红线 #5):后续 codeviz 的任何 agent 都不应该改 `fixtures/fixture-a-order-app/` 下的源码。
- 这里的代码风格是为了"被分析的目标",所以保留显式的 fetch / 显式的 state 切换,便于 M2 静态分析时识别入口。
