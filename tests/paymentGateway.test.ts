import { describe, expect, it } from "vitest";
import { PixEscrowGatewaySim } from "../src/services/paymentGateway.js";

describe("PixEscrowGatewaySim", () => {
  it("supports lock, refund and release operations", async () => {
    const gateway = new PixEscrowGatewaySim();

    await expect(
      gateway.lockFunds({ referenceId: "r1", ownerId: "p1", amount: 1000 }),
    ).resolves.toBeUndefined();

    await expect(
      gateway.refundToOwner({ referenceId: "r1", ownerId: "p1", amount: 500 }),
    ).resolves.toBeUndefined();

    await expect(
      gateway.releaseToExecutive({
        referenceId: "r1",
        executiveId: "e1",
        netAmount: 900,
        platformFee: 100,
      }),
    ).resolves.toBeUndefined();
  });
});
