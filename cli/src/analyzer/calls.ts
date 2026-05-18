import {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
} from "ts-morph";

import { fileLineOf, relPath, symbolId } from "./utils";
import { RouteHandlerDescriptor } from "./types";
import { resolveImportedSymbolId } from "./symbols";

export interface CallRecord {
  callerId: string;
  calleeId: string;
  callKind: "direct" | "virtual" | "dynamic" | "framework-injected";
  fileLocation: { file: string; line: number };
  confidence: "high" | "medium" | "low";
  note?: string;
}

interface EnclosingScope {
  symbolId: string;
}

type FnLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

export function extractCalls(
  project: Project,
  projectRoot: string,
  handlers: RouteHandlerDescriptor[]
): CallRecord[] {
  const calls: CallRecord[] = [];
  const seen = new Set<string>();

  function push(rec: CallRecord) {
    const key = `${rec.callerId}->${rec.calleeId}@${rec.fileLocation.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(rec);
  }

  for (const handler of handlers) {
    for (const mwSymId of handler.middlewareSymbolIds) {
      push({
        callerId: handler.handlerSymbolId,
        calleeId: mwSymId,
        callKind: "framework-injected",
        fileLocation: { file: handler.filePath, line: handler.startLine + 2 },
        confidence: "high",
        note:
          "middleware composition: middleware is registered before the handler",
      });
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = relPath(sourceFile, projectRoot);
    extractDirectCallsFromFile(
      sourceFile,
      relativePath,
      projectRoot,
      handlers,
      push
    );
  }

  return calls;
}

function extractDirectCallsFromFile(
  sourceFile: SourceFile,
  relativePath: string,
  projectRoot: string,
  handlers: RouteHandlerDescriptor[],
  push: (rec: CallRecord) => void
): void {
  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const call = node as CallExpression;

    const enclosing = findEnclosingScope(call, sourceFile, relativePath, handlers, projectRoot);
    if (!enclosing) return;

    const calleeName = resolveCalleeName(call);
    if (!calleeName) return;

    const calleeSymId = resolveImportedSymbolId(sourceFile, calleeName, projectRoot);
    if (!calleeSymId) return;

    push({
      callerId: enclosing.symbolId,
      calleeId: calleeSymId,
      callKind: "direct",
      fileLocation: fileLineOf(sourceFile, call, projectRoot),
      confidence: "high",
    });
  });
}

function resolveCalleeName(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (expr.isKind(SyntaxKind.Identifier)) {
    return expr.getText();
  }
  // Skip property access (e.g. tx.product.update) — those are handled as
  // dataAccessPoints, not direct calls between project symbols.
  return null;
}

function findEnclosingScope(
  node: Node,
  sourceFile: SourceFile,
  relativePath: string,
  handlers: RouteHandlerDescriptor[],
  _projectRoot: string
): EnclosingScope | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.isKind(SyntaxKind.FunctionDeclaration)) {
      const fn = current as FunctionDeclaration;
      const name = fn.getName();
      if (name) return { symbolId: symbolId(relativePath, name) };
    }
    if (
      current.isKind(SyntaxKind.ArrowFunction) ||
      current.isKind(SyntaxKind.FunctionExpression)
    ) {
      const fnLike = current as ArrowFunction | FunctionExpression;
      const matchedHandler = matchHandlerFromArrow(fnLike, handlers, relativePath);
      if (matchedHandler) {
        return { symbolId: matchedHandler.handlerSymbolId };
      }
      const parent = fnLike.getParent();
      if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
        const v = parent as VariableDeclaration;
        const name = v.getName();
        if (name) return { symbolId: symbolId(relativePath, name) };
      }
    }
    current = current.getParent();
  }
  // The traversal walked off the top without finding a named enclosing scope.
  void sourceFile;
  return null;
}

function matchHandlerFromArrow(
  fnLike: ArrowFunction | FunctionExpression,
  handlers: RouteHandlerDescriptor[],
  relativePath: string
): RouteHandlerDescriptor | null {
  const startLine = fnLike.getStartLineNumber();
  for (const h of handlers) {
    if (h.filePath !== relativePath) continue;
    if (startLine >= h.startLine && startLine <= h.endLine) {
      return h;
    }
  }
  return null;
}

// FnLike retained for future refactor of findEnclosingScope; reference it
// in a no-op cast so strict tsconfig.noUnusedLocals does not flag it.
const _fnLikeIsExported: FnLike | undefined = undefined;
void _fnLikeIsExported;
