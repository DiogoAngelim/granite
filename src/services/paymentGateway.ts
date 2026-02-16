export interface PixEscrowGateway {
  lockFunds(input: { referenceId: string; ownerId: string; amount: number }): Promise<void>;
  refundToOwner(input: { referenceId: string; ownerId: string; amount: number }): Promise<void>;
  releaseToExecutive(input: {
    referenceId: string;
    executiveId: string;
    netAmount: number;
    platformFee: number;
  }): Promise<void>;
}

export type PixGatewayMode = "sim" | "native";

export type PixEscrowGatewayNativeConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  lockFundsPath: string;
  refundToOwnerPath: string;
  releaseToExecutivePath: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_PATH = "/escrow/pix/lock";
const DEFAULT_REFUND_PATH = "/escrow/pix/refund";
const DEFAULT_RELEASE_PATH = "/escrow/pix/release";

function normalizePath(path: string): string {
  if (!path) {
    throw new Error("Pix native gateway path cannot be empty");
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when PIX_GATEWAY_MODE=native`);
  }
  return value;
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PIX_GATEWAY_TIMEOUT_MS must be a positive number");
  }

  return parsed;
}

async function parseErrorBody(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (typeof body.error === "string" && body.error.length > 0) {
        return body.error;
      }
      if (typeof body.message === "string" && body.message.length > 0) {
        return body.message;
      }
    } catch {
      return "Unexpected JSON error response";
    }
  }

  const text = await response.text();
  return text.slice(0, 200) || response.statusText || "Unknown error";
}

export class PixEscrowGatewayNative implements PixEscrowGateway {
  constructor(
    private readonly config: PixEscrowGatewayNativeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) { }

  async lockFunds(input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    await this.post(this.config.lockFundsPath, input, `${input.referenceId}:lock`);
  }

  async refundToOwner(input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    await this.post(this.config.refundToOwnerPath, input, `${input.referenceId}:refund`);
  }

  async releaseToExecutive(input: {
    referenceId: string;
    executiveId: string;
    netAmount: number;
    platformFee: number;
  }): Promise<void> {
    await this.post(this.config.releaseToExecutivePath, input, `${input.referenceId}:release`);
  }

  private async post(path: string, payload: unknown, idempotencyKey: string): Promise<void> {
    const url = new URL(path, this.config.baseUrl);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        "x-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const reason = await parseErrorBody(response);
      throw new Error(`Native Pix gateway call failed (${response.status}): ${reason}`);
    }
  }
}

export class PixEscrowGatewaySim implements PixEscrowGateway {
  async lockFunds(_input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    void _input;
    return;
  }

  async refundToOwner(_input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    void _input;
    return;
  }

  async releaseToExecutive(_input: {
    referenceId: string;
    executiveId: string;
    netAmount: number;
    platformFee: number;
  }): Promise<void> {
    void _input;
    return;
  }
}

export function createPixEscrowGatewayFromEnv(): PixEscrowGateway {
  const mode = (process.env.PIX_GATEWAY_MODE?.trim().toLowerCase() ?? "sim") as PixGatewayMode;

  if (mode === "sim") {
    return new PixEscrowGatewaySim();
  }

  if (mode !== "native") {
    throw new Error("PIX_GATEWAY_MODE must be either 'sim' or 'native'");
  }

  const baseUrl = getRequiredEnv("PIX_GATEWAY_BASE_URL");
  const apiKey = getRequiredEnv("PIX_GATEWAY_API_KEY");

  return new PixEscrowGatewayNative({
    baseUrl,
    apiKey,
    timeoutMs: parseTimeoutMs(process.env.PIX_GATEWAY_TIMEOUT_MS),
    lockFundsPath: normalizePath(process.env.PIX_GATEWAY_LOCK_PATH ?? DEFAULT_LOCK_PATH),
    refundToOwnerPath: normalizePath(process.env.PIX_GATEWAY_REFUND_PATH ?? DEFAULT_REFUND_PATH),
    releaseToExecutivePath: normalizePath(process.env.PIX_GATEWAY_RELEASE_PATH ?? DEFAULT_RELEASE_PATH),
  });
}