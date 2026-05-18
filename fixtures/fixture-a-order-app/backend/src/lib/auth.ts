import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "./errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Fake auth for M1 fixture: trust the `x-user-id` header.
// A real codebase would verify a JWT here; the fixture deliberately keeps
// the auth check trivial so the codeviz IO-entry mapper has a clear seam
// without getting distracted by token parsing.
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const userId = req.header("x-user-id");
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return next(new UnauthorizedError());
  }
  req.userId = userId.trim();
  next();
}
