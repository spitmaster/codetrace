import { existsSync } from "node:fs";
import { posix, resolve, sep } from "node:path";
import { Project, SyntaxKind } from "ts-morph";

import {
  IOEntryRegistry,
  IOEntryRegistrySchema,
  SCHEMA_VERSION,
  SymbolGraph,
} from "../schemas";
import { relPath } from "../analyzer/utils";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "all"];

interface RouteRegistration {
  routerVar: string;
  method: string;
  path: string;
  filePath: string;
  line: number;
  handlerSymbolId: string;
  middlewareSymbolIds: string[];
}

interface RouterMount {
  mountPath: string;
  routerVar: string;
  filePath: string;
  line: number;
}

interface AppDirectRoute {
  method: string;
  path: string;
  filePath: string;
  line: number;
  factorySymbolId: string;
}

interface MapOptions {
  projectRoot: string;
  symbolGraph?: SymbolGraph;
}

const ORDER_PATH_RE = /\/api\/orders/i;

export function mapEntries(opts: MapOptions): IOEntryRegistry {
  const absRoot = resolve(opts.projectRoot);
  if (!existsSync(absRoot)) {
    throw new Error(`project root does not exist: ${absRoot}`);
  }
  const normalizedRoot = absRoot.split(sep).join(posix.sep);

  const tsconfigPath = resolve(absRoot, "tsconfig.json");
  const project = existsSync(tsconfigPath)
    ? new Project({ tsConfigFilePath: tsconfigPath, skipAddingFilesFromTsConfig: true })
    : new Project();
  project.addSourceFilesAtPaths(
    [posix.join(normalizedRoot, "src/**/*.ts"), `!${posix.join(normalizedRoot, "**/node_modules/**")}`]
  );

  const routes: RouteRegistration[] = [];
  const mounts: RouterMount[] = [];
  const appDirectRoutes: AppDirectRoute[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = relPath(sourceFile, normalizedRoot);
    collectRoutesAndMounts(sourceFile, relativePath, normalizedRoot, routes, mounts, appDirectRoutes);
  }

  const entries: IOEntryRegistry["entries"] = [];

  // 1) app.<method>("/path", ...) direct routes (e.g. /health)
  for (const dr of appDirectRoutes) {
    entries.push({
      id: makeEntryId(dr.method, dr.path),
      kind: "http",
      displayName: `${dr.method.toUpperCase()} ${dr.path}`,
      framework: "express",
      handlerSymbolId: dr.factorySymbolId,
      metadata: {
        httpMethod: dr.method.toUpperCase(),
        path: dr.path,
        auth: "none",
        registeredAt: { file: dr.filePath, line: dr.line },
      },
      group: classifyGroup(dr.path),
      businessLabel: businessLabelFor(dr.method, dr.path),
      confidence: "high",
    });
  }

  // 2) router-mounted routes: for each route registration on `ordersRouter`,
  // find every mount that uses that router var, and synthesize the full path.
  for (const route of routes) {
    const matchingMounts = mounts.filter((m) => m.routerVar === route.routerVar);
    for (const mount of matchingMounts) {
      const fullPath = joinHttpPath(mount.mountPath, route.path);
      entries.push({
        id: makeEntryId(route.method, fullPath),
        kind: "http",
        displayName: `${route.method.toUpperCase()} ${fullPath}`,
        framework: "express",
        handlerSymbolId: route.handlerSymbolId,
        middlewareSymbolIds: route.middlewareSymbolIds.length > 0 ? route.middlewareSymbolIds : undefined,
        metadata: {
          httpMethod: route.method.toUpperCase(),
          path: fullPath,
          mountedAt: `${mount.mountPath} (via app.use in ${mount.filePath}:${mount.line}) + "${route.path}" on ${route.routerVar} (${route.filePath}:${route.line})`,
          auth: route.middlewareSymbolIds.length > 0
            ? "x-user-id header (requireUser middleware)"
            : "none",
          registeredAt: { file: route.filePath, line: route.line },
          ...computePathParams(fullPath),
        },
        group: classifyGroup(fullPath),
        businessLabel: businessLabelFor(route.method, fullPath),
        confidence: "high",
      });
    }
  }

  const registry: IOEntryRegistry = {
    schemaVersion: SCHEMA_VERSION,
    entries: dedupeById(entries),
  };

  return IOEntryRegistrySchema.parse(registry);
}

function collectRoutesAndMounts(
  sourceFile: import("ts-morph").SourceFile,
  relativePath: string,
  projectRoot: string,
  routes: RouteRegistration[],
  mounts: RouterMount[],
  appDirectRoutes: AppDirectRoute[]
): void {
  // Pass 1: discover router variable declarations and app-factory functions.
  const routerVars = new Set<string>();
  for (const v of sourceFile.getVariableDeclarations()) {
    const init = v.getInitializer();
    if (!init || !init.isKind(SyntaxKind.CallExpression)) continue;
    const callee = init.asKindOrThrow(SyntaxKind.CallExpression).getExpression().getText();
    if (callee === "Router" || callee.endsWith(".Router")) {
      routerVars.add(v.getName());
    }
  }

  for (const factoryFn of sourceFile.getFunctions()) {
    const fnName = factoryFn.getName();
    if (!fnName || !["createApp", "buildApp", "makeApp", "createServer"].includes(fnName)) continue;
    const factorySymId = `ts:${relativePath}#${fnName}`;

    factoryFn.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node.asKindOrThrow(SyntaxKind.CallExpression);
      const expr = call.getExpression();
      if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
      const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
      const receiver = pa.getExpression().getText();
      const method = pa.getName();
      if (receiver !== "app") return;
      const args = call.getArguments();
      const first = args[0];
      const firstStr = literalString(first);
      if (firstStr === null) return;

      if (method === "use" && args.length >= 2) {
        const second = args[1];
        if (second?.isKind(SyntaxKind.Identifier)) {
          mounts.push({
            mountPath: firstStr,
            routerVar: second.getText(),
            filePath: relativePath,
            line: call.getStartLineNumber(),
          });
        }
        return;
      }

      if (HTTP_METHODS.includes(method)) {
        appDirectRoutes.push({
          method,
          path: firstStr,
          filePath: relativePath,
          line: call.getStartLineNumber(),
          factorySymbolId: factorySymId,
        });
      }
    });
  }

  // Pass 2: discover route registrations on any router variable in this file.
  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const receiver = pa.getExpression().getText();
    const method = pa.getName();
    if (!routerVars.has(receiver)) return;
    if (!HTTP_METHODS.includes(method)) return;

    const args = call.getArguments();
    if (args.length < 2) return;
    const first = args[0];
    const routePath = literalString(first);
    if (routePath === null) return;

    const last = args[args.length - 1];
    if (
      !last ||
      !(last.isKind(SyntaxKind.ArrowFunction) || last.isKind(SyntaxKind.FunctionExpression))
    ) {
      return;
    }

    const handlerSymId = `ts:${relativePath}#${receiver}.${method}:${routePath}`;
    const middlewareNames: string[] = [];
    for (let i = 1; i < args.length - 1; i++) {
      const a = args[i];
      if (a.isKind(SyntaxKind.Identifier)) {
        middlewareNames.push(a.getText());
      }
    }
    const middlewareSymIds = middlewareNames
      .map((name) => resolveImportedSymbolId(sourceFile, name, projectRoot))
      .filter((s): s is string => s !== null);

    routes.push({
      routerVar: receiver,
      method,
      path: routePath,
      filePath: relativePath,
      line: call.getStartLineNumber(),
      handlerSymbolId: handlerSymId,
      middlewareSymbolIds: middlewareSymIds,
    });
  });
}

function resolveImportedSymbolId(
  sourceFile: import("ts-morph").SourceFile,
  name: string,
  projectRoot: string
): string | null {
  for (const decl of sourceFile.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      if (named.getName() === name) {
        const importPath = decl.getModuleSpecifierValue();
        if (!importPath.startsWith(".")) return null;
        const sourceDir = sourceFile.getDirectory().getPath().replace(/\\/g, "/");
        let candidate = joinPosixPath(sourceDir, importPath);
        if (!candidate.endsWith(".ts")) candidate = `${candidate}.ts`;
        if (!candidate.startsWith(projectRoot)) return null;
        const rel = candidate.slice(projectRoot.length).replace(/^\/+/, "");
        return `ts:${rel}#${name}`;
      }
    }
  }
  return null;
}

function joinPosixPath(base: string, rel: string): string {
  const baseNorm = base.replace(/\\/g, "/");
  const stack = baseNorm.split("/").filter((s) => s !== "" && s !== ".");
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return (baseNorm.startsWith("/") ? "/" : "") + stack.join("/");
}

function literalString(node: import("ts-morph").Node | undefined): string | null {
  if (!node) return null;
  if (node.isKind(SyntaxKind.StringLiteral)) {
    return node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return node.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText();
  }
  return null;
}

function joinHttpPath(prefix: string, suffix: string): string {
  const a = prefix.replace(/\/+$/, "");
  const b = suffix.replace(/^\/+/, "");
  if (b === "") return a;
  return `${a}/${b}`;
}

function makeEntryId(method: string, path: string): string {
  return `io:http:${method.toUpperCase()}:${path}`;
}

function classifyGroup(path: string): string {
  if (path === "/health") return "运维";
  if (ORDER_PATH_RE.test(path)) return "订单";
  return "其他";
}

function businessLabelFor(method: string, path: string): string {
  const m = method.toUpperCase();
  if (path === "/health") return "健康检查";
  if (path === "/api/orders" && m === "POST") return "下单";
  if (path === "/api/orders" && m === "GET") return "查看我的订单列表";
  if (path === "/api/orders/:id" && m === "GET") return "查看订单详情";
  if (path === "/api/orders/:id" && m === "DELETE") return "取消订单";
  return `${m} ${path}`;
}

function computePathParams(fullPath: string): Record<string, unknown> {
  const pathParams = [...fullPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  if (pathParams.length === 0) return {};
  return { pathParams };
}

function dedupeById(entries: IOEntryRegistry["entries"]): IOEntryRegistry["entries"] {
  const seen = new Map<string, IOEntryRegistry["entries"][number]>();
  for (const e of entries) {
    if (!seen.has(e.id)) seen.set(e.id, e);
  }
  return [...seen.values()];
}
