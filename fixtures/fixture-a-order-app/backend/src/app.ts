import express, { Request, Response, NextFunction } from "express";
import { ordersRouter } from "./routes/orders";
import { HttpError } from "./lib/errors";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/orders", ordersRouter);

  // 404 fallback
  app.use((req: Request, res: Response) => {
    res.status(404).json({ code: "NOT_FOUND", message: `no route for ${req.method} ${req.path}` });
  });

  // Centralized error handler: maps HttpError → HTTP status; everything else → 500.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[unhandled]", err);
    res.status(500).json({ code: "INTERNAL", message: "internal server error" });
  });

  return app;
}
