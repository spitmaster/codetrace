import {
  CallExpression,
  Node,
  Project,
  SyntaxKind,
} from "ts-morph";

import { relPath, symbolId } from "./utils";
import { RouteHandlerDescriptor, RouterMountDescriptor } from "./types";

export interface FrameworkPointRecord {
  kind: "decorator" | "annotation" | "convention";
  framework: string;
  symbolId: string;
  meaning: string;
  raw: string;
}

const APP_FACTORY_FUNCTION_HINTS = ["createApp", "buildApp", "makeApp", "createServer"];
const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "all"];

export function extractFrameworkPoints(
  project: Project,
  projectRoot: string,
  handlers: RouteHandlerDescriptor[]
): { points: FrameworkPointRecord[]; mounts: RouterMountDescriptor[] } {
  const points: FrameworkPointRecord[] = [];
  const mounts: RouterMountDescriptor[] = [];

  for (const handler of handlers) {
    points.push({
      kind: "convention",
      framework: "express",
      symbolId: handler.handlerSymbolId,
      meaning: "route-registration",
      raw: handler.rawCall,
    });
  }

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = relPath(sourceFile, projectRoot);

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      if (!isMiddlewareSignature(fn.getParameters().map((p) => p.getName()))) continue;
      points.push({
        kind: "convention",
        framework: "express",
        symbolId: symbolId(relativePath, name),
        meaning: "middleware-definition",
        raw: `function ${name}(req, _res, next) { ... }`,
      });
    }

    for (const factoryFn of sourceFile.getFunctions()) {
      const fnName = factoryFn.getName();
      if (!fnName || !APP_FACTORY_FUNCTION_HINTS.includes(fnName)) continue;
      const factorySymId = symbolId(relativePath, fnName);

      factoryFn.forEachDescendant((node) => {
        if (!node.isKind(SyntaxKind.CallExpression)) return;
        const call = node as CallExpression;
        const expr = call.getExpression();
        if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
        const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        const receiver = propAccess.getExpression().getText();
        const method = propAccess.getName();
        if (receiver !== "app") return;

        const args = call.getArguments();
        const firstArg = args[0];
        const firstStr = literalString(firstArg);

        if (method === "use") {
          if (firstStr !== null && args.length >= 2) {
            const second = args[1];
            const mountVar = second?.isKind(SyntaxKind.Identifier) ? second.getText() : null;
            points.push({
              kind: "convention",
              framework: "express",
              symbolId: factorySymId,
              meaning: "router-mount",
              raw: stripCallText(call),
            });
            if (mountVar) {
              mounts.push({
                mountPath: firstStr,
                routerVarName: mountVar,
                filePath: relativePath,
                line: call.getStartLineNumber(),
                raw: stripCallText(call),
              });
            }
          } else {
            points.push({
              kind: "convention",
              framework: "express",
              symbolId: factorySymId,
              meaning: "middleware-mount",
              raw: stripCallText(call),
            });
          }
          return;
        }

        if (HTTP_METHODS.includes(method) && firstStr !== null) {
          points.push({
            kind: "convention",
            framework: "express",
            symbolId: factorySymId,
            meaning: "route-registration",
            raw: stripCallText(call),
          });
        }
      });
    }
  }

  return { points, mounts };
}

export function findAppFactorySymbolId(
  project: Project,
  projectRoot: string
): string | null {
  for (const sourceFile of project.getSourceFiles()) {
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (name && APP_FACTORY_FUNCTION_HINTS.includes(name)) {
        return symbolId(relPath(sourceFile, projectRoot), name);
      }
    }
  }
  return null;
}

function isMiddlewareSignature(paramNames: string[]): boolean {
  if (paramNames.length < 2 || paramNames.length > 3) return false;
  const lower = paramNames.map((n) => n.toLowerCase());
  return (
    lower.some((n) => n.includes("req")) &&
    lower.some((n) => n.includes("res")) &&
    lower[lower.length - 1].includes("next")
  );
}

function literalString(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.isKind(SyntaxKind.StringLiteral)) {
    return node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return node.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText();
  }
  return null;
}

function stripCallText(call: CallExpression): string {
  const t = call.getText().replace(/\s+/g, " ");
  if (t.length <= 140) return t;
  return t.slice(0, 140).replace(/\{[^{}]*$/, "{ ... })");
}
