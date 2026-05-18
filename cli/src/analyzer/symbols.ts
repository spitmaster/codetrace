import {
  ArrowFunction,
  CallExpression,
  ClassDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  Project,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
} from "ts-morph";

import { rangeOf, relPath, symbolId } from "./utils";
import { RouteHandlerDescriptor } from "./types";

export interface SymbolRecord {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  range: { startLine: number; endLine: number };
  signature?: string;
  visibility?: "public" | "private" | "protected" | "internal";
  tags?: string[];
}

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "all"]);

function getSignature(
  decl: FunctionDeclaration | ArrowFunction | FunctionExpression
): string | undefined {
  try {
    return decl.getType().getText(decl);
  } catch {
    return undefined;
  }
}

function classifyServiceTag(filePath: string): string[] {
  const tags: string[] = [];
  if (filePath.includes("/services/")) tags.push("service");
  if (filePath.includes("/lib/")) tags.push("lib");
  return tags;
}

export function extractSymbolsAndHandlers(
  project: Project,
  projectRoot: string
): { symbols: SymbolRecord[]; handlers: RouteHandlerDescriptor[] } {
  const symbols: SymbolRecord[] = [];
  const handlers: RouteHandlerDescriptor[] = [];
  const seen = new Set<string>();

  function push(rec: SymbolRecord) {
    if (seen.has(rec.id)) return;
    seen.add(rec.id);
    symbols.push(rec);
  }

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = relPath(sourceFile, projectRoot);
    extractFromFile(sourceFile, relativePath, push, handlers, projectRoot);
  }

  return { symbols, handlers };
}

function extractFromFile(
  sourceFile: SourceFile,
  relativePath: string,
  push: (rec: SymbolRecord) => void,
  handlers: RouteHandlerDescriptor[],
  projectRoot: string
): void {
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const isMiddleware = looksLikeMiddleware(fn);
    push({
      id: symbolId(relativePath, name),
      kind: "function",
      name,
      qualifiedName: name,
      filePath: relativePath,
      range: rangeOf(fn),
      signature: getSignature(fn),
      visibility: fn.isExported() ? "public" : "internal",
      tags: [
        ...(fn.isAsync() ? ["async"] : []),
        ...(isMiddleware ? ["middleware", "auth"] : []),
        ...classifyServiceTag(relativePath),
      ],
    });
  }

  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    push({
      id: symbolId(relativePath, name),
      kind: "class",
      name,
      qualifiedName: name,
      filePath: relativePath,
      range: rangeOf(cls),
      visibility: cls.isExported() ? "public" : "internal",
      tags: tagsForClass(cls),
    });
  }

  for (const v of sourceFile.getVariableDeclarations()) {
    const name = v.getName();
    if (!name) continue;

    const initializer = v.getInitializer();

    if (
      initializer &&
      (initializer.isKind(SyntaxKind.ArrowFunction) ||
        initializer.isKind(SyntaxKind.FunctionExpression))
    ) {
      const fnLike = initializer as ArrowFunction | FunctionExpression;
      const isExported = v.isExported();
      push({
        id: symbolId(relativePath, name),
        kind: "function",
        name,
        qualifiedName: name,
        filePath: relativePath,
        range: rangeOf(v.getVariableStatement() ?? v),
        signature: getSignature(fnLike),
        visibility: isExported ? "public" : "internal",
        tags: [
          ...(fnLike.isAsync() ? ["async"] : []),
          ...classifyServiceTag(relativePath),
        ],
      });
      continue;
    }

    push({
      id: symbolId(relativePath, name),
      kind: "variable",
      name,
      qualifiedName: name,
      filePath: relativePath,
      range: rangeOf(v.getVariableStatement() ?? v),
      signature: v.getType().getText(v),
      visibility: v.isExported() ? "public" : "internal",
      tags: tagsForVariable(v),
    });

    if (looksLikeRouter(v)) {
      collectHandlersForRouter(v, sourceFile, relativePath, handlers, projectRoot);
    }
  }
}

function looksLikeMiddleware(fn: FunctionDeclaration): boolean {
  const params = fn.getParameters();
  if (params.length < 2 || params.length > 3) return false;
  const names = params.map((p) => p.getName().toLowerCase());
  const lastIsNext = names[names.length - 1].includes("next");
  const hasReq = names.some((n) => n.includes("req"));
  const hasRes = names.some((n) => n.includes("res"));
  return lastIsNext && hasReq && hasRes;
}

function tagsForClass(cls: ClassDeclaration): string[] {
  const name = cls.getName() ?? "";
  const tags: string[] = [];
  if (/Error$/.test(name)) tags.push("error");
  if (/^Http/.test(name)) tags.push("error-base");
  return tags;
}

function tagsForVariable(v: VariableDeclaration): string[] {
  const initializer = v.getInitializer();
  if (!initializer) return [];
  const tags: string[] = [];
  if (initializer.isKind(SyntaxKind.NewExpression)) {
    tags.push("singleton");
    const exprName = initializer.asKind(SyntaxKind.NewExpression)?.getExpression().getText();
    if (exprName?.includes("PrismaClient")) tags.push("orm-client");
  }
  if (initializer.isKind(SyntaxKind.CallExpression)) {
    const callee = (initializer as CallExpression).getExpression().getText();
    if (callee === "Router" || callee.endsWith(".Router")) tags.push("router");
  }
  return tags;
}

function looksLikeRouter(v: VariableDeclaration): boolean {
  const initializer = v.getInitializer();
  if (!initializer) return false;
  if (!initializer.isKind(SyntaxKind.CallExpression)) return false;
  const callee = (initializer as CallExpression).getExpression().getText();
  return callee === "Router" || callee.endsWith(".Router");
}

function collectHandlersForRouter(
  routerVar: VariableDeclaration,
  sourceFile: SourceFile,
  relativePath: string,
  out: RouteHandlerDescriptor[],
  projectRoot: string
): void {
  const routerName = routerVar.getName();

  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;

    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const receiver = propAccess.getExpression().getText();
    const method = propAccess.getName();
    if (receiver !== routerName) return;
    if (!HTTP_METHODS.has(method)) return;

    const args = call.getArguments();
    if (args.length < 2) return;
    const first = args[0];
    if (
      !first.isKind(SyntaxKind.StringLiteral) &&
      !first.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      return;
    }
    const routePath =
      first.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ??
      first
        .asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral)
        .getLiteralText();

    const handlerArg = args[args.length - 1];
    if (
      !handlerArg ||
      !(
        handlerArg.isKind(SyntaxKind.ArrowFunction) ||
        handlerArg.isKind(SyntaxKind.FunctionExpression)
      )
    ) {
      return;
    }

    const handlerSymId = symbolId(
      relativePath,
      `${routerName}.${method}:${routePath}`
    );

    const middleware: string[] = [];
    for (let i = 1; i < args.length - 1; i++) {
      const a = args[i];
      if (a.isKind(SyntaxKind.Identifier)) {
        middleware.push(a.getText());
      }
    }
    const middlewareSymIds = middleware
      .map((name) => resolveImportedSymbolId(sourceFile, name, projectRoot))
      .filter((s): s is string => s !== null);

    out.push({
      routerVarName: routerName,
      httpMethod: method.toUpperCase(),
      routePath,
      handlerSymbolId: handlerSymId,
      middlewareSymbolIds: middlewareSymIds,
      filePath: relativePath,
      startLine: call.getStartLineNumber(),
      endLine: call.getEndLineNumber(),
      rawCall: stripCallBody(call.getText()),
    });
  });
}

function stripCallBody(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 160).replace(/\{[^{}]*$/, "{ ... })");
}

export function resolveImportedSymbolId(
  sourceFile: SourceFile,
  name: string,
  projectRoot: string
): string | null {
  for (const decl of sourceFile.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      if (named.getName() === name) {
        const importPath = decl.getModuleSpecifierValue();
        const resolved = resolveRelativeImport(sourceFile, importPath, projectRoot);
        if (resolved) return symbolId(resolved, name);
      }
    }
  }
  return null;
}

function resolveRelativeImport(
  sourceFile: SourceFile,
  importPath: string,
  projectRoot: string
): string | null {
  if (!importPath.startsWith(".")) return null;
  const sourceDir = sourceFile.getDirectory().getPath(); // posix-ish from ts-morph
  let candidate = joinPosix(sourceDir, importPath);
  if (!candidate.endsWith(".ts")) candidate = `${candidate}.ts`;
  const normalizedRoot = projectRoot.replace(/\\/g, "/");
  if (!candidate.startsWith(normalizedRoot)) return null;
  return candidate.slice(normalizedRoot.length).replace(/^\/+/, "");
}

function joinPosix(base: string, rel: string): string {
  const baseNorm = base.replace(/\\/g, "/");
  const stack = baseNorm.split("/").filter((s) => s !== "" && s !== ".");
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return (baseNorm.startsWith("/") ? "/" : "") + stack.join("/");
}

export function collectHandlerSymbols(
  handlers: RouteHandlerDescriptor[]
): SymbolRecord[] {
  return handlers.map((h) => ({
    id: h.handlerSymbolId,
    kind: "handler",
    name: `${h.httpMethod} ${h.routePath}`,
    qualifiedName: `${h.routerVarName}.${h.httpMethod.toLowerCase()}("${h.routePath}")`,
    filePath: h.filePath,
    range: { startLine: h.startLine, endLine: h.endLine },
    signature: "(req, res, next) => Promise<void>",
    visibility: "public",
    tags: ["async", "http-handler"],
  }));
}
