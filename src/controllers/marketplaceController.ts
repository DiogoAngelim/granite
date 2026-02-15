import { Request, Response } from "express";
import { MarketplaceService } from "../services/marketplaceService.js";

const allowedTiers = new Set(["7_DAYS", "14_DAYS", "30_DAYS"]);

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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

      if (!allowedTiers.has(tier) || !isNonEmptyString(category) || !Array.isArray(categories)) {
        return badRequest(res, "tier, category and categories are required");
      }

      if (!isPositiveInteger(reservePrice)) {
        return badRequest(res, "reservePrice must be a positive integer in cents");
      }

      const normalizedCategories = categories.filter(isNonEmptyString).map((item) => item.trim());
      if (normalizedCategories.length === 0 || normalizedCategories.length !== categories.length) {
        return badRequest(res, "categories must contain non-empty strings");
      }

      const slot = await this.marketplaceService.createExecutiveSlot({
        executiveUserId: req.auth.userId,
        tier,
        category: category.trim(),
        reservePrice,
        categories: normalizedCategories,
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

      if (!isPositiveInteger(amount)) {
        return badRequest(res, "amount must be a positive integer in cents");
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