import { Router } from "express";
import { MarketplaceController } from "../controllers/marketplaceController.js";

export function createMarketplaceRoutes(controller: MarketplaceController): Router {
  const router = Router();

  router.post("/executive/slot", controller.createExecutiveSlot);
  router.post("/slot/:id/bid", controller.createBid);
  router.post("/auction/close/:slotId", controller.closeAuction);
  router.post("/contract/:id/complete", controller.completeContract);

  return router;
}