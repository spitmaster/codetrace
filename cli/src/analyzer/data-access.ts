import {
  CallExpression,
  Node,
  Project,
  PropertyAccessExpression,
  SourceFile,
  SyntaxKind,
} from "ts-morph";

import { relPath, symbolId } from "./utils";

export interface DataAccessRecord {
  kind: "orm-call" | "raw-sql" | "file-io" | "http-call" | "queue-publish";
  symbolId: string;
  target: string;
  operation: "read" | "write" | "delete";
  fileLocation: { file: string; line: number };
  raw?: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

// Treat any of `prisma.<model>.<op>(...)` and `tx.<model>.<op>(...)` as a
// Prisma data-access point. `tx` is conventional for the inner client of
// `prisma.$transaction(async (tx) => ...)`.
const PRISMA_RECEIVERS = new Set(["prisma", "tx"]);

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
]);
const READ_OPS = new Set([
  "findUnique",
  "findFirst",
  "findMany",
  "findUniqueOrThrow",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const DELETE_OPS = new Set(["delete", "deleteMany"]);

export function extractDataAccess(
  project: Project,
  projectRoot: string
): DataAccessRecord[] {
  const out: DataAccessRecord[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = relPath(sourceFile, projectRoot);
    sourceFile.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const decoded = decodePrismaCall(call);
      if (!decoded) return;
      const enclosing = findEnclosingNamedFunction(call);
      if (!enclosing) return;
      const operation = classifyOperation(decoded.op);
      if (!operation) return;

      out.push({
        kind: "orm-call",
        symbolId: symbolId(relativePath, enclosing),
        target: capitalize(decoded.model),
        operation,
        fileLocation: {
          file: relativePath,
          line: call.getStartLineNumber(),
        },
        raw: snippet(call.getText()),
        confidence: "high",
      });

      // Prisma `include` expands related models as additional reads on the
      // same call site. Treat each top-level included relation as a read
      // dataAccessPoint so the FlowGraph can show the join target.
      const includedRelations = extractIncludeRelations(call);
      for (const relation of includedRelations) {
        out.push({
          kind: "orm-call",
          symbolId: symbolId(relativePath, enclosing),
          target: capitalize(relation),
          operation: "read",
          fileLocation: {
            file: relativePath,
            line: call.getStartLineNumber(),
          },
          raw: snippet(call.getText()),
          confidence: "medium",
          note: `relation expansion via include from ${capitalize(decoded.model)}`,
        });
      }
    });
  }

  return out;
}

const PRISMA_RELATION_TO_MODEL: Record<string, string> = {
  items: "OrderItem",
  product: "Product",
  user: "User",
  order: "Order",
  orders: "Order",
  buyer: "User",
};

function extractIncludeRelations(call: CallExpression): string[] {
  const args = call.getArguments();
  if (args.length === 0) return [];
  const arg = args[0];
  if (!arg.isKind(SyntaxKind.ObjectLiteralExpression)) return [];
  const out: string[] = [];
  collectIncludeKeys(arg, out);
  // Map relation names → model names; if the relation is unknown to our
  // heuristic map we keep the relation key capitalized (best-effort).
  return out.map((k) => PRISMA_RELATION_TO_MODEL[k] ?? capitalize(k));
}

function collectIncludeKeys(objLit: Node, out: string[]): void {
  for (const prop of objLit.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const name = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getName();
    if (name !== "include") continue;
    const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    for (const relProp of init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
      if (!relProp.isKind(SyntaxKind.PropertyAssignment)) continue;
      const rel = relProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getName();
      out.push(rel);
      // Recurse into nested include for transitive relations.
      const relInit = relProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
      if (relInit && relInit.isKind(SyntaxKind.ObjectLiteralExpression)) {
        collectIncludeKeys(relInit, out);
      }
    }
  }
}

interface PrismaCallDecoded {
  receiver: string;
  model: string;
  op: string;
}

function decodePrismaCall(call: CallExpression): PrismaCallDecoded | null {
  const expr = call.getExpression();
  if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return null;
  const opAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const op = opAccess.getName();

  const modelExpr = opAccess.getExpression();
  if (!modelExpr.isKind(SyntaxKind.PropertyAccessExpression)) return null;
  const modelAccess = modelExpr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const model = modelAccess.getName();

  const receiverNode = modelAccess.getExpression();
  if (!receiverNode.isKind(SyntaxKind.Identifier)) return null;
  const receiver = receiverNode.getText();

  if (!PRISMA_RECEIVERS.has(receiver)) return null;
  return { receiver, model, op };
}

function classifyOperation(op: string): "read" | "write" | "delete" | null {
  if (WRITE_OPS.has(op)) return "write";
  if (READ_OPS.has(op)) return "read";
  if (DELETE_OPS.has(op)) return "delete";
  return null;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ");
  return collapsed.length <= 160
    ? collapsed
    : collapsed.slice(0, 160).replace(/\{[^{}]*$/, "{ ... })");
}

function findEnclosingNamedFunction(node: Node): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.isKind(SyntaxKind.FunctionDeclaration)) {
      const name = current.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName();
      if (name) return name;
    }
    if (
      current.isKind(SyntaxKind.ArrowFunction) ||
      current.isKind(SyntaxKind.FunctionExpression)
    ) {
      const parent = current.getParent();
      if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
        const name = parent.asKindOrThrow(SyntaxKind.VariableDeclaration).getName();
        if (name) return name;
      }
    }
    current = current.getParent();
  }
  return null;
}

// Reference SourceFile / PropertyAccessExpression to keep imports flagged
// in case lint rules tighten later.
type _Touch = SourceFile | PropertyAccessExpression;
const _t: _Touch | undefined = undefined;
void _t;
