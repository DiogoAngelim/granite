import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPixEscrowGatewayFromEnv,
  PixEscrowGatewayNative,
  PixEscrowGatewaySim,
} from "../src/services/paymentGateway.js";

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

describe("PixEscrowGatewayNative", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls lock endpoint with auth and idempotency", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const gateway = new PixEscrowGatewayNative(
      {
        baseUrl: "https://pix.example.com",
        apiKey: "secret",
        timeoutMs: 3000,
        lockFundsPath: "/escrow/pix/lock",
        refundToOwnerPath: "/escrow/pix/refund",
        releaseToExecutivePath: "/escrow/pix/release",
      },
      fetchMock,
    );

    await gateway.lockFunds({ referenceId: "r1", ownerId: "o1", amount: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://pix.example.com/escrow/pix/lock");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    expect(headers["x-idempotency-key"]).toBe("r1:lock");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("throws readable error when provider call fails", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "insufficient funds" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    const gateway = new PixEscrowGatewayNative(
      {
        baseUrl: "https://pix.example.com",
        apiKey: "secret",
        timeoutMs: 3000,
        lockFundsPath: "/escrow/pix/lock",
        refundToOwnerPath: "/escrow/pix/refund",
        releaseToExecutivePath: "/escrow/pix/release",
      },
      fetchMock,
    );

    await expect(gateway.refundToOwner({ referenceId: "r1", ownerId: "o1", amount: 1000 })).rejects.toThrow(
      "Native Pix gateway call failed (422): insufficient funds",
    );
  });

  it("uses message field and release idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "temporarily unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      );

    const gateway = new PixEscrowGatewayNative(
      {
        baseUrl: "https://pix.example.com",
        apiKey: "secret",
        timeoutMs: 3000,
        lockFundsPath: "/escrow/pix/lock",
        refundToOwnerPath: "/escrow/pix/refund",
        releaseToExecutivePath: "/escrow/pix/release",
      },
      fetchMock,
    );

    await gateway.releaseToExecutive({
      referenceId: "r2",
      executiveId: "e1",
      netAmount: 900,
      platformFee: 100,
    });

    const [, releaseInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const releaseHeaders = releaseInit.headers as Record<string, string>;
    expect(releaseHeaders["x-idempotency-key"]).toBe("r2:release");

    await expect(gateway.lockFunds({ referenceId: "r3", ownerId: "o1", amount: 500 })).rejects.toThrow(
      "Native Pix gateway call failed (503): temporarily unavailable",
    );
  });

  it("handles invalid JSON error payload", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("not-json", {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    const gateway = new PixEscrowGatewayNative(
      {
        baseUrl: "https://pix.example.com",
        apiKey: "secret",
        timeoutMs: 3000,
        lockFundsPath: "/escrow/pix/lock",
        refundToOwnerPath: "/escrow/pix/refund",
        releaseToExecutivePath: "/escrow/pix/release",
      },
      fetchMock,
    );

    await expect(gateway.lockFunds({ referenceId: "r1", ownerId: "o1", amount: 1000 })).rejects.toThrow(
      "Native Pix gateway call failed (500): Unexpected JSON error response",
    );
  });

  it("falls back to unknown error when provider body is empty", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500, statusText: "" }));
    const gateway = new PixEscrowGatewayNative(
      {
        baseUrl: "https://pix.example.com",
        apiKey: "secret",
        timeoutMs: 3000,
        lockFundsPath: "/escrow/pix/lock",
        refundToOwnerPath: "/escrow/pix/refund",
        releaseToExecutivePath: "/escrow/pix/release",
      },
      fetchMock,
    );

    await expect(gateway.lockFunds({ referenceId: "r1", ownerId: "o1", amount: 1000 })).rejects.toThrow(
      "Native Pix gateway call failed (500): Unknown error",
    );
  });
});

describe("createPixEscrowGatewayFromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to simulator mode", () => {
    delete process.env.PIX_GATEWAY_MODE;
    const gateway = createPixEscrowGatewayFromEnv();
    expect(gateway).toBeInstanceOf(PixEscrowGatewaySim);
  });

  it("creates native mode when env is configured", () => {
    process.env.PIX_GATEWAY_MODE = "native";
    process.env.PIX_GATEWAY_BASE_URL = "https://pix.example.com";
    process.env.PIX_GATEWAY_API_KEY = "api-key";

    const gateway = createPixEscrowGatewayFromEnv();
    expect(gateway).toBeInstanceOf(PixEscrowGatewayNative);
  });

  it("normalizes native paths without leading slash", async () => {
    process.env.PIX_GATEWAY_MODE = "native";
    process.env.PIX_GATEWAY_BASE_URL = "https://pix.example.com";
    process.env.PIX_GATEWAY_API_KEY = "api-key";
    process.env.PIX_GATEWAY_LOCK_PATH = "custom/lock";

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const gateway = createPixEscrowGatewayFromEnv();
    await gateway.lockFunds({ referenceId: "r1", ownerId: "o1", amount: 1000 });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://pix.example.com/custom/lock");
  });

  it("throws when native mode misses required env", () => {
    process.env.PIX_GATEWAY_MODE = "native";
    delete process.env.PIX_GATEWAY_BASE_URL;
    process.env.PIX_GATEWAY_API_KEY = "api-key";

    expect(() => createPixEscrowGatewayFromEnv()).toThrow(
      "PIX_GATEWAY_BASE_URL is required when PIX_GATEWAY_MODE=native",
    );
  });

  it("throws when native mode misses api key", () => {
    process.env.PIX_GATEWAY_MODE = "native";
    process.env.PIX_GATEWAY_BASE_URL = "https://pix.example.com";
    delete process.env.PIX_GATEWAY_API_KEY;

    expect(() => createPixEscrowGatewayFromEnv()).toThrow(
      "PIX_GATEWAY_API_KEY is required when PIX_GATEWAY_MODE=native",
    );
  });

  it("throws when gateway mode is invalid", () => {
    process.env.PIX_GATEWAY_MODE = "invalid";
    expect(() => createPixEscrowGatewayFromEnv()).toThrow(
      "PIX_GATEWAY_MODE must be either 'sim' or 'native'",
    );
  });

  it("throws on invalid timeout and empty path", () => {
    process.env.PIX_GATEWAY_MODE = "native";
    process.env.PIX_GATEWAY_BASE_URL = "https://pix.example.com";
    process.env.PIX_GATEWAY_API_KEY = "api-key";
    process.env.PIX_GATEWAY_TIMEOUT_MS = "0";

    expect(() => createPixEscrowGatewayFromEnv()).toThrow(
      "PIX_GATEWAY_TIMEOUT_MS must be a positive number",
    );

    process.env.PIX_GATEWAY_TIMEOUT_MS = "1000";
    process.env.PIX_GATEWAY_LOCK_PATH = "";

    expect(() => createPixEscrowGatewayFromEnv()).toThrow("Pix native gateway path cannot be empty");
  });
});
