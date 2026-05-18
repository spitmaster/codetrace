import { Node, SourceFile } from "ts-morph";
import { posix, relative, sep } from "node:path";

export function relPath(sourceFile: SourceFile, projectRoot: string): string {
  const abs = sourceFile.getFilePath();
  const rel = relative(projectRoot, abs);
  return rel.split(sep).join(posix.sep);
}

export function symbolId(relativePath: string, qualifiedName: string): string {
  return `ts:${relativePath}#${qualifiedName}`;
}

export interface RangeLite {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export function rangeOf(node: Node): RangeLite {
  const start = node.getStartLineNumber();
  const end = node.getEndLineNumber();
  return { startLine: start, endLine: end };
}

export function fileLineOf(
  sourceFile: SourceFile,
  node: Node,
  projectRoot: string
): { file: string; line: number } {
  return {
    file: relPath(sourceFile, projectRoot),
    line: node.getStartLineNumber(),
  };
}
