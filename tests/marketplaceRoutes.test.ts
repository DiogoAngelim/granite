import { describe, expect, it, vi } from "vitest";
import { createMarketplaceRoutes } from "../src/routes/marketplaceRoutes.js";

describe("createMarketplaceRoutes", () => {
  it("registers all expected POST routes", () => {
    const controller = {
      createExecutiveSlot: vi.fn(),
      createBid: vi.fn(),
      closeAuction: vi.fn(),
      completeContract: vi.fn(),
    } as any;

    const router = createMarketplaceRoutes(controller);
    const routes = (router as any).stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({ path: layer.route.path, methods: layer.route.methods }));

    expect(routes).toHaveLength(4);
    expect(routes).toEqual(
      expect.arrayContaining([
        { path: "/executive/slot", methods: { post: true } },
        { path: "/slot/:id/bid", methods: { post: true } },
        { path: "/auction/close/:slotId", methods: { post: true } },
        { path: "/contract/:id/complete", methods: { post: true } },
      ]),
    );
  });
});
