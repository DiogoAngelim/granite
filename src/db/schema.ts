import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userTypeEnum = pgEnum("user_type", ["EXECUTIVE", "OWNER"]);
export const slotTierEnum = pgEnum("slot_tier", ["7_DAYS", "14_DAYS", "30_DAYS"]);
export const slotStatusEnum = pgEnum("slot_status", [
  "OPEN",
  "AUCTION_CLOSED",
  "IN_PROGRESS",
  "COMPLETED",
  "BREACH",
  "VOID",
]);
export const escrowStatusEnum = pgEnum("escrow_status", ["LOCKED", "RELEASED", "REFUNDED"]);
export const contractStatusEnum = pgEnum("contract_status", ["ACTIVE", "COMPLETED", "BREACH"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: userTypeEnum("type").notNull(),
  email: text("email").notNull().unique(),
  verified: boolean("verified").notNull().default(false),
  ratingInternal: numeric("rating_internal", { precision: 4, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slots = pgTable("slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  executiveId: uuid("executive_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  tier: slotTierEnum("tier").notNull(),
  category: text("category").notNull(),
  status: slotStatusEnum("status").notNull().default("OPEN"),
  auctionEndsAt: timestamp("auction_ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const executiveProfiles = pgTable("executive_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inviteOnly: boolean("invite_only").notNull().default(true),
  activeSlotId: uuid("active_slot_id").references(() => slots.id, { onDelete: "set null" }),
  reservePrice: integer("reserve_price").notNull(),
  categories: text("categories").array().notNull().default([]),
});

export const bids = pgTable("bids", {
  id: uuid("id").defaultRandom().primaryKey(),
  slotId: uuid("slot_id")
    .notNull()
    .references(() => slots.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  amount: integer("amount").notNull(),
  escrowStatus: escrowStatusEnum("escrow_status").notNull().default("LOCKED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  slotId: uuid("slot_id")
    .notNull()
    .unique()
    .references(() => slots.id, { onDelete: "cascade" }),
  winningBidId: uuid("winning_bid_id")
    .notNull()
    .unique()
    .references(() => bids.id, { onDelete: "restrict" }),
  clearingPrice: integer("clearing_price").notNull(),
  status: contractStatusEnum("status").notNull().default("ACTIVE"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
});

export type UserType = (typeof userTypeEnum.enumValues)[number];
export type SlotTier = (typeof slotTierEnum.enumValues)[number];
export type SlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type EscrowStatus = (typeof escrowStatusEnum.enumValues)[number];
export type ContractStatus = (typeof contractStatusEnum.enumValues)[number];