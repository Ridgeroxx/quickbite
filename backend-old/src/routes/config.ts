import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/config", (_req, res): Promise<void> => {
  res.json({
    currency: process.env.CURRENCY ?? "GHS",
    deliveryFee: process.env.DELIVERY_FEE ?? "5.00",
    serviceFee: process.env.SERVICE_FEE ?? "0.00",
    momoNumber: process.env.MOMO_NUMBER ?? "",
  });
  return Promise.resolve();
});

export default router;
