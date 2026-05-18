# @codeviz/cli

> codeviz M1 命令行分析器。读取目标 TS + Express + Prisma 项目,产出 4 种中间表示 JSON(`SymbolGraph` / `IOEntryRegistry` / `FlowGraph` / `BusinessAnnotations`)供浏览器前端消费。
>
> **当前阶段**:M1.2 — `analyze` + `map-io` 已就位;`trace`(M1.3)与 `translate`(M1.4)待补。
>
> **不可违反的红线**:
> - 目标项目源码只读(red line #5)。
> - schema 版本 0.1.0,改 schema 必须升版(red line #6)。
> - 仅声明支持 TypeScript + Express + Prisma(red line #4)。

---

## 子命令

### `analyze <project-root> [--output <file>]`

静态分析目标项目,产出 SymbolGraph。

```bash
# 从仓库根
npm run cli:analyze -- fixtures/fixture-a-order-app/backend
# or stream to a file
npm run cli:analyze -- fixtures/fixture-a-order-app/backend --output /tmp/sg.json
```

抽取项:
- `symbols[]` — 函数 / 类 / 变量 / handler(`ts:<rel>#<qualifiedName>`)
- `calls[]` — direct + framework-injected(Express 中间件)
- `frameworkPoints[]` — Express route-registration / router-mount / middleware-mount / middleware-definition
- `dataAccessPoints[]` — Prisma `prisma.<model>.<op>` 和 `tx.<model>.<op>`,op 分类成 read / write / delete

不抽取(M1 范围外):
- 反射调用 / 动态分发
- 跨语言 import(Java、Vue、Python)
- 装饰器路由(NestJS @Controller 等)

### `map-io <project-root> [--output <file>]`

识别 HTTP IO 入口,产出 IOEntryRegistry。

```bash
npm run cli:map-io -- fixtures/fixture-a-order-app/backend
```

识别策略:
- `Router()` 变量 → 视为 Express router
- `<router>.<method>(path, ...middleware, handler)` → 一条 entry
- `app.use(mountPath, <routerVar>)` → router-mount,与上面的 router 关联拼出完整 path
- `app.get/post/...(path, ...)` 直接挂在 app 上 → 直接 entry(用于 `/health`)
- 中间件 identifier(`requireUser` 等)解析到导入源 → 写入 `middlewareSymbolIds`

ID 格式:`io:http:<METHOD>:<fullPath>`,businessLabel 在 M1.2 内置启发式(订单业务标签按 path 映射);M1.4 起由 business-translator 重写。

## 测试

```bash
npm run cli:test            # 仓库根
# 等价:
npm --prefix cli run test
```

测试覆盖:
- `cli/src/analyzer/__tests__/analyzer.test.ts` — 7 assertions:schema 版本、framework 识别、symbol/call recall ≥ 80%、dataAccessPoint 全覆盖、route-registration / router-mount / middleware-definition 识别。
- `cli/src/io-mapper/__tests__/io-mapper.test.ts` — 5 assertions:entry 数量 = 5(准确率 100%)、id / displayName / handlerSymbolId 与 ground-truth 逐字段一致、middlewareSymbolIds 一致、confidence=high。

回归参考答案:`fixtures/fixture-a-order-app/ground-truth/*.expected.json`。

## Schema

zod schema 在 `src/schemas/`:
- `symbol-graph.ts` / `io-entry-registry.ts` / `flow-graph.ts` / `business-annotations.ts`
- `common.ts`:`SCHEMA_VERSION = "0.1.0"`,`SymbolId` 正则 `^[a-z]+:[^#]+#.+$`

`npm run validate:ground-truth` 用上述 schema 校验 10 份 ground-truth(2 + 4 flow + 4 business)。

## 已知边界与待办

- analyzer 的 `signature` 字段是 ts-morph 推断结果(`typeof createOrder` 等),与 ground-truth 人工 narrative 风格不同;测试不要求 signature 完全一致,只看 symbol id 召回。
- analyzer 的 `tags` 是启发式(service / lib / async / middleware / auth / error / orm-client / router),与 ground-truth 不强制对齐。
- M1.3 `trace` 子命令:从 IOEntryRegistry 出发,沿 SymbolGraph 的 calls + dataAccessPoints,生成 FlowGraph。
- M1.4 `translate` 子命令:LLM 抽象层(Claude / Ollama),把 FlowGraph 翻译成 BusinessAnnotations。
