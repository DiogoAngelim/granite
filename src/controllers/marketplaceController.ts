import { Request, Response } from "express";
import { MarketplaceService } from "../services/marketplaceService.js";

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) { }

  createExecutiveSlot = async (req: Request, res: Response) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (req.auth.role !== "EXECUTIVE") {
        return res.status(403).json({ error: "Only executives can create slots" });
      }

      const { tier, category, reservePrice, categories } = req.body as {
        tier: "7_DAYS" | "14_DAYS" | "30_DAYS";
        category: string;
        reservePrice: number;
        categories: string[];
      };

      if (!tier || !category || !Array.isArray(categories)) {
        return badRequest(res, "tier, category and categories are required");
      }

      const slot = await this.marketplaceService.createExecutiveSlot({
        executiveUserId: req.auth.userId,
        tier,
        category,
        reservePrice,
        categories,
      });

      return res.status(201).json(slot);
    } catch (error) {
      return badRequest(res, (error as Error).message);
    }
  };

  createBid = async (req: Request, res: Response) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (req.auth.role !== "OWNER") {
        return res.status(403).json({ error: "Only owners can bid" });
      }

      const slotId = getSingleParam(req.params.id);
      const { amount } = req.body as { amount: number };

      if (!slotId) {
        return badRequest(res, "slot id is required");
      }

      const bid = await this.marketplaceService.placeBid({
        slotId,
        ownerUserId: req.auth.userId,
        amount,
      });

      return res.status(201).json(bid);
    } catch (error) {
      return badRequest(res, (error as Error).message);
    }
  };

  closeAuction = async (req: Request, res: Response) => {
    try {
      const slotId = getSingleParam(req.params.slotId);

      if (!slotId) {
        return badRequest(res, "slotId is required");
      }

      const result = await this.marketplaceService.closeAuction(slotId);
      return res.status(200).json(result);
    } catch (error) {
      return badRequest(res, (error as Error).message);
    }
  };

  completeContract = async (req: Request, res: Response) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (req.auth.role !== "EXECUTIVE") {
        return res.status(403).json({ error: "Only executive can complete contract" });
      }

      const contractId = getSingleParam(req.params.id);
      if (!contractId) {
        return badRequest(res, "contract id is required");
      }

      const result = await this.marketplaceService.completeContract({
        contractId,
        executiveUserId: req.auth.userId,
      });

      return res.status(200).json(result);
    } catch (error) {
      return badRequest(res, (error as Error).message);
    }
  };
}