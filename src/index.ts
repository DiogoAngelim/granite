import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { startMarketplaceCronJobs } from "./cron/marketplaceCron.js";
import { MarketplaceController } from "./controllers/marketplaceController.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { PixEscrowGatewaySim } from "./services/paymentGateway.js";
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

async function bootstrap() {
  await applyPendingMigrations();

  const app = express();
  app.use(express.json());
  app.use(authStubMiddleware);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const realtimeHub = new RealtimeHub(wss);

  const marketplaceService = new MarketplaceService(new PixEscrowGatewaySim(), realtimeHub);
  const marketplaceController = new MarketplaceController(marketplaceService);

  app.use(createMarketplaceRoutes(marketplaceController));

  startMarketplaceCronJobs(marketplaceService);

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`granite marketplace api listening on ${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("startup failed", error);
  process.exit(1);
});