import { Router, Request, Response, NextFunction } from "express";
import { requireUser } from "../lib/auth";
import {
  createOrder,
  listOrders,
  getOrderDetail,
  cancelOrder,
} from "../services/order-service";

export const ordersRouter = Router();

// POST /api/orders — create a new order
// Body: { items: [{ productId, quantity }] }
// Auth: x-user-id header identifies the buyer.
ordersRouter.post(
  "/",
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createOrder({
        userId: req.userId!,
        items: req.body?.items,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/orders?page=1&pageSize=20 — list the caller's own orders
ordersRouter.get(
  "/",
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(String(req.query.page ?? "1"), 10) || 1;
      const pageSize = parseInt(String(req.query.pageSize ?? "20"), 10) || 20;
      const result = await listOrders({ userId: req.userId!, page, pageSize });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/orders/:id — fetch one order (header + items + product info)
ordersRouter.get(
  "/:id",
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const order = await getOrderDetail(req.userId!, req.params.id);
      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/orders/:id — cancel a pending order and restore stock
ordersRouter.delete(
  "/:id",
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await cancelOrder(req.userId!, req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
