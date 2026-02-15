import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  bids,
  contracts,
  executiveProfiles,
  SlotTier,
  slots,
  users,
} from "../db/schema.js";
import { PixEscrowGateway } from "./paymentGateway.js";

type RealtimePublisher = {
  broadcastBidCreated: (payload: {
    id: string;
    slotId: string;
    ownerId: string;
    amount: number;
    escrowStatus: string;
    createdAt: Date;
  }) => void;
  broadcastAuctionClosed: (payload: {
    slotId: string;
    status: "VOID" | "IN_PROGRESS";
    contractId?: string;
    winningBidId?: string;
    clearingPrice?: number;
  }) => void;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_FEE_RATE = 0.12;

function requirePositiveCents(amount: number, field: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`${field} must be a positive integer in cents`);
  }
}

function deadlineFromTier(startedAt: Date, tier: SlotTier): Date {
  const daysByTier: Record<SlotTier, number> = {
    "7_DAYS": 7,
    "14_DAYS": 14,
    "30_DAYS": 30,
  };
  return new Date(startedAt.getTime() + daysByTier[tier] * ONE_DAY_MS);
}

export class MarketplaceService {
  constructor(
    private readonly pixEscrowGateway: PixEscrowGateway,
    private readonly realtimePublisher?: RealtimePublisher,
  ) { }

  async createExecutiveSlot(input: {
    executiveUserId: string;
    tier: SlotTier;
    category: string;
    reservePrice: number;
    categories: string[];
  }) {
    requirePositiveCents(input.reservePrice, "reservePrice");

    return db.transaction(async (tx) => {
      const [executive] = await tx
        .select({ id: users.id, type: users.type, verified: users.verified })
        .from(users)
        .where(eq(users.id, input.executiveUserId))
        .limit(1);

      if (!executive || executive.type !== "EXECUTIVE" || !executive.verified) {
        throw new Error("Only verified executives can create slots");
      }

      const now = new Date();
      const auctionEndsAt = new Date(now.getTime() + ONE_DAY_MS);

      const [profile] = await tx
        .select({
          userId: executiveProfiles.userId,
          activeSlotId: executiveProfiles.activeSlotId,
          inviteOnly: executiveProfiles.inviteOnly,
        })
        .from(executiveProfiles)
        .where(eq(executiveProfiles.userId, input.executiveUserId))
        .limit(1);

      if (profile?.activeSlotId) {
        throw new Error("Executive already has one active slot");
      }

      const [createdSlot] = await tx
        .insert(slots)
        .values({
          executiveId: input.executiveUserId,
          tier: input.tier,
          category: input.category,
          status: "OPEN",
          auctionEndsAt,
        })
        .returning({
          id: slots.id,
          executiveId: slots.executiveId,
          tier: slots.tier,
          category: slots.category,
          status: slots.status,
          auctionEndsAt: slots.auctionEndsAt,
          createdAt: slots.createdAt,
        });

      if (!profile) {
        await tx.insert(executiveProfiles).values({
          userId: input.executiveUserId,
          inviteOnly: true,
          activeSlotId: createdSlot.id,
          reservePrice: input.reservePrice,
          categories: input.categories,
        });
      } else {
        await tx
          .update(executiveProfiles)
          .set({
            activeSlotId: createdSlot.id,
            reservePrice: input.reservePrice,
            categories: input.categories,
          })
          .where(eq(executiveProfiles.userId, input.executiveUserId));
      }

      return createdSlot;
    });
  }

  async placeBid(input: {
    slotId: string;
    ownerUserId: string;
    amount: number;
  }) {
    requirePositiveCents(input.amount, "amount");

    return db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id, type: users.type, verified: users.verified })
        .from(users)
        .where(eq(users.id, input.ownerUserId))
        .limit(1);

      if (!owner || owner.type !== "OWNER" || !owner.verified) {
        throw new Error("Only verified owners can place bids");
      }

      const [slot] = await tx
        .select({
          id: slots.id,
          status: slots.status,
          auctionEndsAt: slots.auctionEndsAt,
          executiveId: slots.executiveId,
        })
        .from(slots)
        .where(eq(slots.id, input.slotId))
        .limit(1);

      if (!slot || slot.status !== "OPEN") {
        throw new Error("Slot is not open for bidding");
      }

      if (slot.executiveId === input.ownerUserId) {
        throw new Error("Executive cannot bid on own slot");
      }

      const now = new Date();
      if (slot.auctionEndsAt.getTime() <= now.getTime()) {
        throw new Error("Auction already ended");
      }

      const bidId = randomUUID();

      await this.pixEscrowGateway.lockFunds({
        referenceId: bidId,
        ownerId: input.ownerUserId,
        amount: input.amount,
      });

      const [createdBid] = await tx
        .insert(bids)
        .values({
          id: bidId,
          slotId: input.slotId,
          ownerId: input.ownerUserId,
          amount: input.amount,
          escrowStatus: "LOCKED",
        })
        .returning({
          id: bids.id,
          slotId: bids.slotId,
          ownerId: bids.ownerId,
          amount: bids.amount,
          escrowStatus: bids.escrowStatus,
          createdAt: bids.createdAt,
        });

      this.realtimePublisher?.broadcastBidCreated(createdBid);

      return createdBid;
    });
  }

  async closeAuction(slotId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();

      const [lockedSlot] = await tx
        .update(slots)
        .set({ status: "AUCTION_CLOSED" })
        .where(and(eq(slots.id, slotId), eq(slots.status, "OPEN"), lte(slots.auctionEndsAt, now)))
        .returning({
          id: slots.id,
          executiveId: slots.executiveId,
          tier: slots.tier,
        });

      if (!lockedSlot) {
        throw new Error("Slot cannot be closed yet or is already closed");
      }

      const [profile] = await tx
        .select({ reservePrice: executiveProfiles.reservePrice })
        .from(executiveProfiles)
        .where(eq(executiveProfiles.userId, lockedSlot.executiveId))
        .limit(1);

      if (!profile) {
        throw new Error("Executive profile not found");
      }

      const slotBids = await tx
        .select({
          id: bids.id,
          slotId: bids.slotId,
          ownerId: bids.ownerId,
          amount: bids.amount,
          escrowStatus: bids.escrowStatus,
          createdAt: bids.createdAt,
        })
        .from(bids)
        .where(eq(bids.slotId, slotId))
        .orderBy(desc(bids.amount), asc(bids.createdAt), asc(bids.id));

      const validBids = slotBids.filter((bid) => bid.amount >= profile.reservePrice);

      if (validBids.length === 0) {
        for (const bid of slotBids) {
          if (bid.escrowStatus === "LOCKED") {
            await this.pixEscrowGateway.refundToOwner({
              referenceId: bid.id,
              ownerId: bid.ownerId,
              amount: bid.amount,
            });
            await tx
              .update(bids)
              .set({ escrowStatus: "REFUNDED" })
              .where(and(eq(bids.id, bid.id), eq(bids.escrowStatus, "LOCKED")));
          }
        }

        await tx.update(slots).set({ status: "VOID" }).where(eq(slots.id, slotId));

        await tx
          .update(executiveProfiles)
          .set({ activeSlotId: null })
          .where(eq(executiveProfiles.userId, lockedSlot.executiveId));

        this.realtimePublisher?.broadcastAuctionClosed({
          slotId,
          status: "VOID",
        });

        return { slotId, status: "VOID" as const };
      }

      const winner = validBids[0];
      const clearingPrice = validBids.length === 1 ? winner.amount : validBids[1].amount;

      for (const bid of slotBids) {
        if (bid.id === winner.id || bid.escrowStatus !== "LOCKED") {
          continue;
        }

        await this.pixEscrowGateway.refundToOwner({
          referenceId: bid.id,
          ownerId: bid.ownerId,
          amount: bid.amount,
        });

        await tx
          .update(bids)
          .set({ escrowStatus: "REFUNDED" })
          .where(and(eq(bids.id, bid.id), eq(bids.escrowStatus, "LOCKED")));
      }

      const excess = winner.amount - clearingPrice;
      if (excess > 0) {
        await this.pixEscrowGateway.refundToOwner({
          referenceId: winner.id,
          ownerId: winner.ownerId,
          amount: excess,
        });
      }

      const startedAt = now;
      const deadlineAt = deadlineFromTier(startedAt, lockedSlot.tier);

      const [createdContract] = await tx
        .insert(contracts)
        .values({
          slotId,
          winningBidId: winner.id,
          clearingPrice,
          status: "ACTIVE",
          startedAt,
          deadlineAt,
        })
        .returning({
          id: contracts.id,
          slotId: contracts.slotId,
          winningBidId: contracts.winningBidId,
          clearingPrice: contracts.clearingPrice,
          status: contracts.status,
          startedAt: contracts.startedAt,
          deadlineAt: contracts.deadlineAt,
        });

      await tx.update(slots).set({ status: "IN_PROGRESS" }).where(eq(slots.id, slotId));

      this.realtimePublisher?.broadcastAuctionClosed({
        slotId,
        status: "IN_PROGRESS",
        contractId: createdContract.id,
        winningBidId: createdContract.winningBidId,
        clearingPrice: createdContract.clearingPrice,
      });

      return createdContract;
    });
  }

  async completeContract(input: { contractId: string; executiveUserId: string }) {
    return db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          contractId: contracts.id,
          status: contracts.status,
          clearingPrice: contracts.clearingPrice,
          deadlineAt: contracts.deadlineAt,
          slotId: slots.id,
          slotExecutiveId: slots.executiveId,
          winningBidId: bids.id,
          winningOwnerId: bids.ownerId,
          winningEscrowStatus: bids.escrowStatus,
        })
        .from(contracts)
        .innerJoin(slots, eq(slots.id, contracts.slotId))
        .innerJoin(bids, eq(bids.id, contracts.winningBidId))
        .where(eq(contracts.id, input.contractId))
        .limit(1);

      if (!record || record.status !== "ACTIVE") {
        throw new Error("Contract is not active");
      }

      if (record.slotExecutiveId !== input.executiveUserId) {
        throw new Error("Only contract executive can mark completion");
      }

      const now = new Date();
      if (now.getTime() > record.deadlineAt.getTime()) {
        throw new Error("Deadline exceeded, contract must be breached");
      }

      if (record.winningEscrowStatus !== "LOCKED") {
        throw new Error("Winning escrow is not available for release");
      }

      const platformFee = Math.floor(record.clearingPrice * PLATFORM_FEE_RATE);
      const netAmount = record.clearingPrice - platformFee;

      await this.pixEscrowGateway.releaseToExecutive({
        referenceId: record.winningBidId,
        executiveId: record.slotExecutiveId,
        netAmount,
        platformFee,
      });

      await tx
        .update(bids)
        .set({ escrowStatus: "RELEASED" })
        .where(and(eq(bids.id, record.winningBidId), eq(bids.escrowStatus, "LOCKED")));

      await tx.update(contracts).set({ status: "COMPLETED" }).where(eq(contracts.id, record.contractId));
      await tx.update(slots).set({ status: "COMPLETED" }).where(eq(slots.id, record.slotId));

      await tx
        .update(executiveProfiles)
        .set({ activeSlotId: null })
        .where(eq(executiveProfiles.userId, record.slotExecutiveId));

      return {
        contractId: record.contractId,
        status: "COMPLETED" as const,
        clearingPrice: record.clearingPrice,
        platformFee,
        netAmount,
      };
    });
  }

  async autoBreachContract(contractId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();

      const [record] = await tx
        .select({
          contractId: contracts.id,
          contractStatus: contracts.status,
          deadlineAt: contracts.deadlineAt,
          clearingPrice: contracts.clearingPrice,
          slotId: slots.id,
          slotExecutiveId: slots.executiveId,
          winningBidId: bids.id,
          winningOwnerId: bids.ownerId,
          winningEscrowStatus: bids.escrowStatus,
        })
        .from(contracts)
        .innerJoin(slots, eq(slots.id, contracts.slotId))
        .innerJoin(bids, eq(bids.id, contracts.winningBidId))
        .where(eq(contracts.id, contractId))
        .limit(1);

      if (!record || record.contractStatus !== "ACTIVE") {
        return null;
      }

      if (record.deadlineAt.getTime() > now.getTime()) {
        return null;
      }

      if (record.winningEscrowStatus === "LOCKED") {
        await this.pixEscrowGateway.refundToOwner({
          referenceId: record.winningBidId,
          ownerId: record.winningOwnerId,
          amount: record.clearingPrice,
        });

        await tx
          .update(bids)
          .set({ escrowStatus: "REFUNDED" })
          .where(and(eq(bids.id, record.winningBidId), eq(bids.escrowStatus, "LOCKED")));
      }

      await tx.update(contracts).set({ status: "BREACH" }).where(eq(contracts.id, record.contractId));
      await tx.update(slots).set({ status: "BREACH" }).where(eq(slots.id, record.slotId));

      await tx
        .update(executiveProfiles)
        .set({ activeSlotId: null })
        .where(eq(executiveProfiles.userId, record.slotExecutiveId));

      return { contractId: record.contractId, status: "BREACH" as const };
    });
  }

  async closeDueAuctions(now = new Date()) {
    const dueSlots = await db
      .select({ id: slots.id })
      .from(slots)
      .where(and(eq(slots.status, "OPEN"), lte(slots.auctionEndsAt, now)));

    for (const slot of dueSlots) {
      try {
        await this.closeAuction(slot.id);
      } catch {
        continue;
      }
    }
  }

  async breachOverdueContracts(now = new Date()) {
    const dueContracts = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.status, "ACTIVE"), lte(contracts.deadlineAt, now)));

    for (const contract of dueContracts) {
      try {
        await this.autoBreachContract(contract.id);
      } catch {
        continue;
      }
    }
  }
}