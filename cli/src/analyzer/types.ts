import { SymbolGraph } from "../schemas";

export interface AnalyzeOptions {
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export type SymbolGraphArrays = Pick<
  SymbolGraph,
  "symbols" | "calls" | "frameworkPoints" | "dataAccessPoints"
>;

export interface RouteHandlerDescriptor {
  routerVarName: string;
  httpMethod: string;
  routePath: string;
  handlerSymbolId: string;
  middlewareSymbolIds: string[];
  filePath: string;
  startLine: number;
  endLine: number;
  rawCall: string;
}

export interface RouterMountDescriptor {
  mountPath: string;
  routerVarName: string;
  filePath: string;
  line: number;
  raw: string;
}
