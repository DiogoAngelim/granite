import express from "express";

type LockFundsInput = {
  referenceId: string;
  ownerId: string;
  amount: number;
};

type RefundToOwnerInput = {
  referenceId: string;
  ownerId: string;
  amount: number;
};

type ReleaseToExecutiveInput = {
  referenceId: string;
  executiveId: string;
  netAmount: number;
  platformFee: number;
};

type StripePaymentIntent = {
  id: string;
};

type StripeRefund = {
  id: string;
};

type StripeTransfer = {
  id: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "4010");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("STRIPE_PROVIDER_PORT must be a positive integer");
  }
  return parsed;
}

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value ?? "10000");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("STRIPE_PROVIDER_TIMEOUT_MS must be a positive number");
  }
  return parsed;
}

function parseExecutiveAccountMap(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, string>;
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    normalized[key.trim()] = value.trim();
  }

  return normalized;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateLockInput(input: unknown): LockFundsInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid request body");
  }

  const candidate = input as Partial<LockFundsInput>;
  if (!isNonEmptyString(candidate.referenceId) || !isNonEmptyString(candidate.ownerId) || !isPositiveInteger(candidate.amount)) {
    throw new Error("referenceId, ownerId and amount are required");
  }

  return {
    referenceId: candidate.referenceId.trim(),
    ownerId: candidate.ownerId.trim(),
    amount: candidate.amount,
  };
}

function validateRefundInput(input: unknown): RefundToOwnerInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid request body");
  }

  const candidate = input as Partial<RefundToOwnerInput>;
  if (!isNonEmptyString(candidate.referenceId) || !isNonEmptyString(candidate.ownerId) || !isPositiveInteger(candidate.amount)) {
    throw new Error("referenceId, ownerId and amount are required");
  }

  return {
    referenceId: candidate.referenceId.trim(),
    ownerId: candidate.ownerId.trim(),
    amount: candidate.amount,
  };
}

function validateReleaseInput(input: unknown): ReleaseToExecutiveInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid request body");
  }

  const candidate = input as Partial<ReleaseToExecutiveInput>;
  if (
    !isNonEmptyString(candidate.referenceId)
    || !isNonEmptyString(candidate.executiveId)
    || !isPositiveInteger(candidate.netAmount)
    || !isPositiveInteger(candidate.platformFee)
  ) {
    throw new Error("referenceId, executiveId, netAmount and platformFee are required");
  }

  return {
    referenceId: candidate.referenceId.trim(),
    executiveId: candidate.executiveId.trim(),
    netAmount: candidate.netAmount,
    platformFee: candidate.platformFee,
  };
}

async function parseStripeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    return `Stripe request failed with status ${response.status}`;
  }

  return `Stripe request failed with status ${response.status}`;
}

async function stripeFormRequest<T>(input: {
  path: string;
  params: Record<string, string>;
  stripeSecretKey: string;
  timeoutMs: number;
  idempotencyKey?: string;
}): Promise<T> {
  const url = `https://api.stripe.com/v1${input.path}`;
  const body = new URLSearchParams(input.params);
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.stripeSecretKey}`,
    "content-type": "application/x-www-form-urlencoded",
  };

  if (input.idempotencyKey) {
    headers["idempotency-key"] = input.idempotencyKey;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    const reason = await parseStripeError(response);
    throw new Error(reason);
  }

  return (await response.json()) as T;
}

async function createPaymentIntentPix(input: {
  amount: number;
  referenceId: string;
  ownerId: string;
  stripeSecretKey: string;
  timeoutMs: number;
  idempotencyKey: string;
}): Promise<StripePaymentIntent> {
  return stripeFormRequest<StripePaymentIntent>({
    path: "/payment_intents",
    stripeSecretKey: input.stripeSecretKey,
    timeoutMs: input.timeoutMs,
    idempotencyKey: input.idempotencyKey,
    params: {
      amount: String(input.amount),
      currency: "brl",
      "payment_method_types[0]": "pix",
      "metadata[referenceId]": input.referenceId,
      "metadata[ownerId]": input.ownerId,
    },
  });
}

async function createRefund(input: {
  amount: number;
  paymentIntentId: string;
  stripeSecretKey: string;
  timeoutMs: number;
  idempotencyKey: string;
}): Promise<StripeRefund> {
  return stripeFormRequest<StripeRefund>({
    path: "/refunds",
    stripeSecretKey: input.stripeSecretKey,
    timeoutMs: input.timeoutMs,
    idempotencyKey: input.idempotencyKey,
    params: {
      amount: String(input.amount),
      payment_intent: input.paymentIntentId,
    },
  });
}

async function createTransfer(input: {
  amount: number;
  destinationAccountId: string;
  referenceId: string;
  executiveId: string;
  platformFee: number;
  stripeSecretKey: string;
  timeoutMs: number;
  idempotencyKey: string;
}): Promise<StripeTransfer> {
  return stripeFormRequest<StripeTransfer>({
    path: "/transfers",
    stripeSecretKey: input.stripeSecretKey,
    timeoutMs: input.timeoutMs,
    idempotencyKey: input.idempotencyKey,
    params: {
      amount: String(input.amount),
      currency: "brl",
      destination: input.destinationAccountId,
      "metadata[referenceId]": input.referenceId,
      "metadata[executiveId]": input.executiveId,
      "metadata[platformFee]": String(input.platformFee),
    },
  });
}

function requireProviderToken(req: express.Request, expectedToken: string): boolean {
  const header = req.header("authorization");
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) {
    return false;
  }
  const token = header.slice(prefix.length).trim();
  return token.length > 0 && token === expectedToken;
}

async function bootstrap() {
  const providerApiKey = getRequiredEnv("STRIPE_PROVIDER_API_KEY");
  const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
  const port = parsePort(process.env.STRIPE_PROVIDER_PORT);
  const timeoutMs = parseTimeout(process.env.STRIPE_PROVIDER_TIMEOUT_MS);
  const executiveAccountMap = parseExecutiveAccountMap(process.env.STRIPE_EXECUTIVE_ACCOUNT_MAP);
  const paymentIntentsByReference = new Map<string, string>();

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use((req, res, next) => {
    if (!requireProviderToken(req, providerApiKey)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.post("/escrow/pix/lock", async (req, res) => {
    try {
      const body = validateLockInput(req.body);
      const idempotencyKey = req.header("x-idempotency-key") ?? `${body.referenceId}:lock`;
      const paymentIntent = await createPaymentIntentPix({
        amount: body.amount,
        referenceId: body.referenceId,
        ownerId: body.ownerId,
        stripeSecretKey,
        timeoutMs,
        idempotencyKey,
      });

      paymentIntentsByReference.set(body.referenceId, paymentIntent.id);

      res.status(200).json({ status: "locked", providerReference: paymentIntent.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      res.status(400).json({ error: message });
    }
  });

  app.post("/escrow/pix/refund", async (req, res) => {
    try {
      const body = validateRefundInput(req.body);
      const paymentIntentId = paymentIntentsByReference.get(body.referenceId);
      if (!paymentIntentId) {
        res.status(404).json({ error: "Payment reference not found" });
        return;
      }

      const idempotencyKey = req.header("x-idempotency-key") ?? `${body.referenceId}:refund`;
      const refund = await createRefund({
        amount: body.amount,
        paymentIntentId,
        stripeSecretKey,
        timeoutMs,
        idempotencyKey,
      });

      res.status(200).json({ status: "refunded", providerReference: refund.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      res.status(400).json({ error: message });
    }
  });

  app.post("/escrow/pix/release", async (req, res) => {
    try {
      const body = validateReleaseInput(req.body);
      const destinationAccountId = executiveAccountMap[body.executiveId];
      if (!destinationAccountId) {
        res.status(400).json({ error: "Stripe connected account not mapped for executiveId" });
        return;
      }

      const idempotencyKey = req.header("x-idempotency-key") ?? `${body.referenceId}:release`;
      const transfer = await createTransfer({
        amount: body.netAmount,
        destinationAccountId,
        referenceId: body.referenceId,
        executiveId: body.executiveId,
        platformFee: body.platformFee,
        stripeSecretKey,
        timeoutMs,
        idempotencyKey,
      });

      res.status(200).json({ status: "released", providerReference: transfer.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      res.status(400).json({ error: message });
    }
  });

  app.listen(port, () => {
    console.log(`stripe provider service listening on ${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("stripe provider service failed", error);
  process.exit(1);
});