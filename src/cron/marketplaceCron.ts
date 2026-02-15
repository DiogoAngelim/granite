import cron from "node-cron";
import { MarketplaceService } from "../services/marketplaceService.js";

export function startMarketplaceCronJobs(marketplaceService: MarketplaceService) {
  const closeAuctionsTask = cron.schedule("* * * * *", async () => {
    await marketplaceService.closeDueAuctions();
  });

  const breachContractsTask = cron.schedule("* * * * *", async () => {
    await marketplaceService.breachOverdueContracts();
  });

  return {
    stop: () => {
      closeAuctionsTask.stop();
      breachContractsTask.stop();
    },
  };
}