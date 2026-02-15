import { describe, expect, it, vi } from "vitest";
import { MarketplaceController } from "../src/controllers/marketplaceController.js";

function createRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe("MarketplaceController", () => {
  const service = {
    createExecutiveSlot: vi.fn(),
    placeBid: vi.fn(),
    closeAuction: vi.fn(),
    completeContract: vi.fn(),
  } as any;

  const controller = new MarketplaceController(service);

  it("returns 401 when unauthenticated on create slot", async () => {
    const req = { body: {}, params: {} } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("creates slot for executive", async () => {
    service.createExecutiveSlot.mockResolvedValueOnce({ id: "slot-1" });
    const req = {
      auth: { userId: "e1", role: "EXECUTIVE" },
      body: { tier: "7_DAYS", category: "design", reservePrice: 1000, categories: ["design"] },
      params: {},
    } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);

    expect(service.createExecutiveSlot).toHaveBeenCalledWith({
      executiveUserId: "e1",
      tier: "7_DAYS",
      category: "design",
      reservePrice: 1000,
      categories: ["design"],
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when create slot payload is invalid", async () => {
    const req = {
      auth: { userId: "e1", role: "EXECUTIVE" },
      body: { tier: "7_DAYS", category: "design" },
      params: {},
    } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when reservePrice is not positive integer", async () => {
    const req = {
      auth: { userId: "e1", role: "EXECUTIVE" },
      body: { tier: "7_DAYS", category: "design", reservePrice: 0, categories: ["design"] },
      params: {},
    } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when categories contain empty strings", async () => {
    const req = {
      auth: { userId: "e1", role: "EXECUTIVE" },
      body: { tier: "7_DAYS", category: "design", reservePrice: 1000, categories: ["design", ""] },
      params: {},
    } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when create slot service throws", async () => {
    service.createExecutiveSlot.mockRejectedValueOnce(new Error("boom"));
    const req = {
      auth: { userId: "e1", role: "EXECUTIVE" },
      body: { tier: "7_DAYS", category: "design", reservePrice: 1000, categories: ["design"] },
      params: {},
    } as any;
    const res = createRes();

    await controller.createExecutiveSlot(req, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 403 when non owner bids", async () => {
    const req = { auth: { userId: "e1", role: "EXECUTIVE" }, body: { amount: 10 }, params: { id: "s1" } } as any;
    const res = createRes();

    await controller.createBid(req, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("creates bid for owner", async () => {
    service.placeBid.mockResolvedValueOnce({ id: "b1" });
    const req = { auth: { userId: "p1", role: "OWNER" }, body: { amount: 10 }, params: { id: "s1" } } as any;
    const res = createRes();

    await controller.createBid(req, res as any);

    expect(service.placeBid).toHaveBeenCalledWith({ slotId: "s1", ownerUserId: "p1", amount: 10 });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when bid slot param is missing", async () => {
    const req = { auth: { userId: "p1", role: "OWNER" }, body: { amount: 10 }, params: {} } as any;
    const res = createRes();

    await controller.createBid(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when bid amount is invalid", async () => {
    const req = { auth: { userId: "p1", role: "OWNER" }, body: { amount: 0 }, params: { id: "s1" } } as any;
    const res = createRes();

    await controller.createBid(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when close auction service throws", async () => {
    service.closeAuction.mockRejectedValueOnce(new Error("boom"));
    const res = createRes();
    await controller.closeAuction({ params: { slotId: "s1" } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("closes auction and handles missing slot id", async () => {
    const res1 = createRes();
    await controller.closeAuction({ params: {} } as any, res1 as any);
    expect(res1.status).toHaveBeenCalledWith(400);

    service.closeAuction.mockResolvedValueOnce({ id: "c1" });
    const res2 = createRes();
    await controller.closeAuction({ params: { slotId: "s1" } } as any, res2 as any);
    expect(res2.status).toHaveBeenCalledWith(200);
  });

  it("completes contract for executive and handles errors", async () => {
    const res1 = createRes();
    await controller.completeContract({ auth: { userId: "p1", role: "OWNER" }, params: { id: "c1" } } as any, res1 as any);
    expect(res1.status).toHaveBeenCalledWith(403);

    service.completeContract.mockRejectedValueOnce(new Error("boom"));
    const res2 = createRes();
    await controller.completeContract({ auth: { userId: "e1", role: "EXECUTIVE" }, params: { id: "c1" } } as any, res2 as any);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 and 400 paths in complete contract", async () => {
    const res1 = createRes();
    await controller.completeContract({ params: { id: "c1" } } as any, res1 as any);
    expect(res1.status).toHaveBeenCalledWith(401);

    const res2 = createRes();
    await controller.completeContract({ auth: { userId: "e1", role: "EXECUTIVE" }, params: {} } as any, res2 as any);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("completes contract for executive", async () => {
    service.completeContract.mockResolvedValueOnce({ id: "c1" });
    const req = { auth: { userId: "e1", role: "EXECUTIVE" }, params: { id: "c1" } } as any;
    const res = createRes();

    await controller.completeContract(req, res as any);

    expect(service.completeContract).toHaveBeenCalledWith({ contractId: "c1", executiveUserId: "e1" });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
