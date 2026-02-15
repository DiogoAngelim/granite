import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, tx, dbMock } = vi.hoisted(() => {
  const state = {
    txSelectResults: [] as unknown[],
    txInsertReturningResults: [] as unknown[],
    txUpdateReturningResults: [] as unknown[],
    dbSelectResults: [] as unknown[],
    txInsertTables: [] as unknown[],
    txUpdateTables: [] as unknown[],
  };

  function asThenable<T>(value: T, extras: Record<string, unknown> = {}) {
    return {
      ...extras,
      then: (onFulfilled: (value: T) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(value).then(onFulfilled, onRejected),
    };
  }

  function makeSelectBuilder(result: unknown) {
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      then(
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
      limit() {
        return Promise.resolve(result);
      },
      orderBy() {
        return Promise.resolve(result);
      },
      innerJoin() {
        return this;
      },
    };
  }

  const trx = {
    select: vi.fn(() => makeSelectBuilder(state.txSelectResults.shift())),
    insert: vi.fn((table: unknown) => {
      state.txInsertTables.push(table);
      return {
        values: vi.fn(() =>
          asThenable(undefined, {
            returning: vi.fn(() => Promise.resolve([state.txInsertReturningResults.shift()])),
          }),
        ),
      };
    }),
    update: vi.fn((table: unknown) => {
      state.txUpdateTables.push(table);
      return {
        set: vi.fn(() => ({
          where: vi.fn(() =>
            asThenable(undefined, {
              returning: vi.fn(() => Promise.resolve([state.txUpdateReturningResults.shift()])),
            }),
          ),
        })),
      };
    }),
  };

  const databaseMock = {
    transaction: vi.fn(async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx)),
    select: vi.fn(() => makeSelectBuilder(state.dbSelectResults.shift())),
  };

  return { mockState: state, tx: trx, dbMock: databaseMock };
});

function resetMockState() {
  mockState.txSelectResults = [];
  mockState.txInsertReturningResults = [];
  mockState.txUpdateReturningResults = [];
  mockState.dbSelectResults = [];
  mockState.txInsertTables = [];
  mockState.txUpdateTables = [];
}

vi.mock("../src/db/client.js", () => ({
  db: dbMock,
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: () => "bid-fixed-uuid",
  };
});

import { executiveProfiles } from "../src/db/schema.js";
import { MarketplaceService } from "../src/services/marketplaceService.js";

describe("MarketplaceService", () => {
  const gateway = {
    lockFunds: vi.fn(async () => undefined),
    refundToOwner: vi.fn(async () => undefined),
    releaseToExecutive: vi.fn(async () => undefined),
  };

  const service = new MarketplaceService(gateway);

  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  it("creates slot for verified executive without active slot", async () => {
    mockState.txSelectResults.push(
      [{ id: "e1", type: "EXECUTIVE", verified: true }],
      [undefined],
    );
    mockState.txInsertReturningResults.push({ id: "slot-1", executiveId: "e1", status: "OPEN" });

    const result = await service.createExecutiveSlot({
      executiveUserId: "e1",
      tier: "7_DAYS",
      category: "design",
      reservePrice: 10000,
      categories: ["design"],
    });

    expect(result).toEqual({ id: "slot-1", executiveId: "e1", status: "OPEN" });
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid reserve price", async () => {
    await expect(
      service.createExecutiveSlot({
        executiveUserId: "e1",
        tier: "7_DAYS",
        category: "design",
        reservePrice: 0,
        categories: ["design"],
      }),
    ).rejects.toThrow("reservePrice must be a positive integer in cents");

    expect(dbMock.transaction).not.toHaveBeenCalled();
  });

  it("rejects slot creation when executive is invalid", async () => {
    mockState.txSelectResults.push([{ id: "e1", type: "OWNER", verified: true }]);

    await expect(
      service.createExecutiveSlot({
        executiveUserId: "e1",
        tier: "7_DAYS",
        category: "design",
        reservePrice: 100,
        categories: ["design"],
      }),
    ).rejects.toThrow("Only verified executives can create slots");
  });

  it("rejects slot creation when executive already has active slot", async () => {
    mockState.txSelectResults.push(
      [{ id: "e1", type: "EXECUTIVE", verified: true }],
      [{ userId: "e1", activeSlotId: "slot-active", inviteOnly: true }],
    );

    await expect(
      service.createExecutiveSlot({
        executiveUserId: "e1",
        tier: "14_DAYS",
        category: "dev",
        reservePrice: 100,
        categories: ["dev"],
      }),
    ).rejects.toThrow("Executive already has one active slot");
  });

  it("updates existing profile when creating slot", async () => {
    mockState.txSelectResults.push(
      [{ id: "e1", type: "EXECUTIVE", verified: true }],
      [{ userId: "e1", activeSlotId: null, inviteOnly: true }],
    );
    mockState.txInsertReturningResults.push({ id: "slot-2", executiveId: "e1", status: "OPEN" });

    const result = await service.createExecutiveSlot({
      executiveUserId: "e1",
      tier: "30_DAYS",
      category: "dev",
      reservePrice: 200,
      categories: ["dev"],
    });

    expect(result.id).toBe("slot-2");
    expect(tx.update).toHaveBeenCalled();
  });

  it("places bid with escrow lock", async () => {
    mockState.txSelectResults.push(
      [{ id: "p1", type: "OWNER", verified: true }],
      [{ id: "slot-1", status: "OPEN", auctionEndsAt: new Date(Date.now() + 60000), executiveId: "e1" }],
    );
    mockState.txInsertReturningResults.push({ id: "bid-fixed-uuid", amount: 30000, escrowStatus: "LOCKED" });

    const result = await service.placeBid({ slotId: "slot-1", ownerUserId: "p1", amount: 30000 });

    expect(gateway.lockFunds).toHaveBeenCalledWith({
      referenceId: "bid-fixed-uuid",
      ownerId: "p1",
      amount: 30000,
    });
    expect(result).toEqual({ id: "bid-fixed-uuid", amount: 30000, escrowStatus: "LOCKED" });
  });

  it("rejects bid when amount is invalid", async () => {
    await expect(service.placeBid({ slotId: "slot-1", ownerUserId: "p1", amount: -1 })).rejects.toThrow(
      "amount must be a positive integer in cents",
    );
  });

  it("rejects bid when owner is invalid", async () => {
    mockState.txSelectResults.push([{ id: "p1", type: "EXECUTIVE", verified: true }]);
    await expect(service.placeBid({ slotId: "slot-1", ownerUserId: "p1", amount: 1000 })).rejects.toThrow(
      "Only verified owners can place bids",
    );
  });

  it("rejects bid when slot is not open", async () => {
    mockState.txSelectResults.push(
      [{ id: "p1", type: "OWNER", verified: true }],
      [{ id: "slot-1", status: "VOID", auctionEndsAt: new Date(Date.now() + 60000), executiveId: "e1" }],
    );

    await expect(service.placeBid({ slotId: "slot-1", ownerUserId: "p1", amount: 1000 })).rejects.toThrow(
      "Slot is not open for bidding",
    );
  });

  it("rejects bid when owner is slot executive", async () => {
    mockState.txSelectResults.push(
      [{ id: "e1", type: "OWNER", verified: true }],
      [{ id: "slot-1", status: "OPEN", auctionEndsAt: new Date(Date.now() + 60000), executiveId: "e1" }],
    );

    await expect(service.placeBid({ slotId: "slot-1", ownerUserId: "e1", amount: 1000 })).rejects.toThrow(
      "Executive cannot bid on own slot",
    );
  });

  it("rejects bid when auction has ended", async () => {
    mockState.txSelectResults.push(
      [{ id: "p1", type: "OWNER", verified: true }],
      [{ id: "slot-1", status: "OPEN", auctionEndsAt: new Date(Date.now() - 1000), executiveId: "e1" }],
    );

    await expect(service.placeBid({ slotId: "slot-1", ownerUserId: "p1", amount: 1000 })).rejects.toThrow(
      "Auction already ended",
    );
  });

  it("throws when close auction lock step fails", async () => {
    mockState.txUpdateReturningResults.push(undefined);
    await expect(service.closeAuction("slot-x")).rejects.toThrow(
      "Slot cannot be closed yet or is already closed",
    );
  });

  it("throws when executive profile is not found on close", async () => {
    mockState.txUpdateReturningResults.push({ id: "slot-1", executiveId: "e1", tier: "7_DAYS" });
    mockState.txSelectResults.push([undefined]);

    await expect(service.closeAuction("slot-1")).rejects.toThrow("Executive profile not found");
  });

  it("closes auction to VOID and refunds all locked bids below reserve", async () => {
    mockState.txUpdateReturningResults.push({ id: "slot-1", executiveId: "e1", tier: "7_DAYS" });
    mockState.txSelectResults.push(
      [{ reservePrice: 50000 }],
      [
        { id: "b1", ownerId: "p1", amount: 20000, escrowStatus: "LOCKED", createdAt: new Date() },
        { id: "b2", ownerId: "p2", amount: 30000, escrowStatus: "LOCKED", createdAt: new Date() },
      ],
    );

    const result = await service.closeAuction("slot-1");

    expect(result).toEqual({ slotId: "slot-1", status: "VOID" });
    expect(gateway.refundToOwner).toHaveBeenCalledTimes(2);
    expect(mockState.txUpdateTables).toContain(executiveProfiles);
  });

  it("closes auction with Vickrey second price and creates contract", async () => {
    const now = new Date();
    mockState.txUpdateReturningResults.push({ id: "slot-1", executiveId: "e1", tier: "14_DAYS" });
    mockState.txSelectResults.push(
      [{ reservePrice: 10000 }],
      [
        { id: "b1", ownerId: "p1", amount: 70000, escrowStatus: "LOCKED", createdAt: now },
        { id: "b2", ownerId: "p2", amount: 50000, escrowStatus: "LOCKED", createdAt: now },
      ],
    );
    mockState.txInsertReturningResults.push({
      id: "c1",
      slotId: "slot-1",
      winningBidId: "b1",
      clearingPrice: 50000,
      status: "ACTIVE",
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });

    const result = await service.closeAuction("slot-1");

    expect(result.id).toBe("c1");
    expect(result.clearingPrice).toBe(50000);
    expect(gateway.refundToOwner).toHaveBeenCalledWith({
      referenceId: "b2",
      ownerId: "p2",
      amount: 50000,
    });
    expect(gateway.refundToOwner).toHaveBeenCalledWith({
      referenceId: "b1",
      ownerId: "p1",
      amount: 20000,
    });
  });

  it("closes auction with single valid bid and no excess refund", async () => {
    const now = new Date();
    mockState.txUpdateReturningResults.push({ id: "slot-1", executiveId: "e1", tier: "30_DAYS" });
    mockState.txSelectResults.push(
      [{ reservePrice: 20000 }],
      [
        { id: "b1", ownerId: "p1", amount: 50000, escrowStatus: "LOCKED", createdAt: now },
        { id: "b2", ownerId: "p2", amount: 10000, escrowStatus: "RELEASED", createdAt: now },
      ],
    );
    mockState.txInsertReturningResults.push({
      id: "c-single",
      slotId: "slot-1",
      winningBidId: "b1",
      clearingPrice: 50000,
      status: "ACTIVE",
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const result = await service.closeAuction("slot-1");

    expect(result.clearingPrice).toBe(50000);
    expect(gateway.refundToOwner).not.toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: "b1", amount: 0 }),
    );
  });

  it("completes active contract and releases escrow minus fee", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        status: "ACTIVE",
        clearingPrice: 100000,
        deadlineAt: new Date(Date.now() + 60000),
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "LOCKED",
      },
    ]);

    const result = await service.completeContract({ contractId: "c1", executiveUserId: "e1" });

    expect(gateway.releaseToExecutive).toHaveBeenCalledWith({
      referenceId: "b1",
      executiveId: "e1",
      netAmount: 90000,
      platformFee: 10000,
    });
    expect(result).toEqual({
      contractId: "c1",
      status: "COMPLETED",
      clearingPrice: 100000,
      platformFee: 10000,
      netAmount: 90000,
    });
  });

  it("rejects completion when deadline already passed", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        status: "ACTIVE",
        clearingPrice: 100000,
        deadlineAt: new Date(Date.now() - 60000),
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "LOCKED",
      },
    ]);

    await expect(service.completeContract({ contractId: "c1", executiveUserId: "e1" })).rejects.toThrow(
      "Deadline exceeded, contract must be breached",
    );
  });

  it("rejects completion when contract is not active", async () => {
    mockState.txSelectResults.push([{ contractId: "c1", status: "BREACH" }]);
    await expect(service.completeContract({ contractId: "c1", executiveUserId: "e1" })).rejects.toThrow(
      "Contract is not active",
    );
  });

  it("rejects completion when executive is wrong", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        status: "ACTIVE",
        clearingPrice: 100,
        deadlineAt: new Date(Date.now() + 5000),
        slotId: "slot-1",
        slotExecutiveId: "e2",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "LOCKED",
      },
    ]);

    await expect(service.completeContract({ contractId: "c1", executiveUserId: "e1" })).rejects.toThrow(
      "Only contract executive can mark completion",
    );
  });

  it("rejects completion when escrow is not locked", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        status: "ACTIVE",
        clearingPrice: 100,
        deadlineAt: new Date(Date.now() + 5000),
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "RELEASED",
      },
    ]);

    await expect(service.completeContract({ contractId: "c1", executiveUserId: "e1" })).rejects.toThrow(
      "Winning escrow is not available for release",
    );
  });

  it("auto breaches overdue active contract and refunds owner", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        contractStatus: "ACTIVE",
        deadlineAt: new Date(Date.now() - 60000),
        clearingPrice: 50000,
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "LOCKED",
      },
    ]);

    const result = await service.autoBreachContract("c1");
    expect(result).toEqual({ contractId: "c1", status: "BREACH" });
    expect(gateway.refundToOwner).toHaveBeenCalledWith({
      referenceId: "b1",
      ownerId: "p1",
      amount: 50000,
    });
  });

  it("returns null when auto breach record is missing or not active", async () => {
    mockState.txSelectResults.push([undefined]);
    const result = await service.autoBreachContract("c1");
    expect(result).toBeNull();
  });

  it("returns null when auto breach deadline not reached", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        contractStatus: "ACTIVE",
        deadlineAt: new Date(Date.now() + 10000),
        clearingPrice: 50000,
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "LOCKED",
      },
    ]);

    const result = await service.autoBreachContract("c1");
    expect(result).toBeNull();
  });

  it("breaches without refund when escrow already released", async () => {
    mockState.txSelectResults.push([
      {
        contractId: "c1",
        contractStatus: "ACTIVE",
        deadlineAt: new Date(Date.now() - 10000),
        clearingPrice: 50000,
        slotId: "slot-1",
        slotExecutiveId: "e1",
        winningBidId: "b1",
        winningOwnerId: "p1",
        winningEscrowStatus: "RELEASED",
      },
    ]);

    const result = await service.autoBreachContract("c1");
    expect(result).toEqual({ contractId: "c1", status: "BREACH" });
  });

  it("closes due auctions and continues if one close fails", async () => {
    mockState.dbSelectResults.push([{ id: "slot-1" }, { id: "slot-2" }]);
    const closeSpy = vi
      .spyOn(service, "closeAuction")
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ id: "c2" } as never);

    await service.closeDueAuctions(new Date());

    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it("breaches overdue contracts and continues if one breach fails", async () => {
    mockState.dbSelectResults.push([{ id: "c1" }, { id: "c2" }]);
    const breachSpy = vi
      .spyOn(service, "autoBreachContract")
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ contractId: "c2", status: "BREACH" });

    await service.breachOverdueContracts(new Date());

    expect(breachSpy).toHaveBeenCalledTimes(2);
  });
});