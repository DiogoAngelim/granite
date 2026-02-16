import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { pool } from "./db/client.js";
import { startMarketplaceCronJobs } from "./cron/marketplaceCron.js";
import { MarketplaceController } from "./controllers/marketplaceController.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { createPixEscrowGatewayFromEnv } from "./services/paymentGateway.js";
import { RealtimeHub } from "./services/realtimeHub.js";
import { createMarketplaceRoutes } from "./routes/marketplaceRoutes.js";
import type { UserType } from "./db/schema.js";
import { applyPendingMigrations } from "./db/migrationRunner.js";

function authStubMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role") as UserType | undefined;

  if (userId && role) {
    req.auth = { userId, role };
  }

  next();
}

function createRateLimiter() {
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 120);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      return res.status(429).json({ error: "Too many requests" });
    }

    current.count += 1;
    return next();
  };
}

async function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}

async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function bootstrap() {
  await applyPendingMigrations();

  const app = express();
  app.set("trust proxy", true);
  app.use(createRateLimiter());
  app.use(express.json());
  app.use(authStubMiddleware);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const realtimeHub = new RealtimeHub(wss);

  const pixEscrowGateway = createPixEscrowGatewayFromEnv();
  const marketplaceService = new MarketplaceService(pixEscrowGateway, realtimeHub);
  const marketplaceController = new MarketplaceController(marketplaceService);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await pool.query("select 1");
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not_ready" });
    }
  });

  app.use(createMarketplaceRoutes(marketplaceController));

  const cronJobs = startMarketplaceCronJobs(marketplaceService);

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`granite marketplace api listening on ${port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`received ${signal}, shutting down`);
    cronJobs.stop();

    try {
      await closeWebSocketServer(wss);
      await closeHttpServer(server);
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("graceful shutdown failed", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  console.error("startup failed", error);
  process.exit(1);
});