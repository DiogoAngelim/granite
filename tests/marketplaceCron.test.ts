import { describe, expect, it, vi } from "vitest";

const { stopA, stopB, schedule } = vi.hoisted(() => {
  const localStopA = vi.fn();
  const localStopB = vi.fn();
  const localSchedule = vi
    .fn()
    .mockReturnValueOnce({ stop: localStopA })
    .mockReturnValueOnce({ stop: localStopB });

  return { stopA: localStopA, stopB: localStopB, schedule: localSchedule };
});

vi.mock("node-cron", () => ({
  default: { schedule },
}));

import { startMarketplaceCronJobs } from "../src/cron/marketplaceCron.js";

describe("startMarketplaceCronJobs", () => {
  it("registers two cron tasks and stops both", async () => {
    const service = {
      closeDueAuctions: vi.fn(async () => undefined),
      breachOverdueContracts: vi.fn(async () => undefined),
    } as any;

    const jobs = startMarketplaceCronJobs(service);

    expect(schedule).toHaveBeenCalledTimes(2);
    const closeTick = schedule.mock.calls[0][1];
    const breachTick = schedule.mock.calls[1][1];

    await closeTick();
    await breachTick();

    expect(service.closeDueAuctions).toHaveBeenCalledTimes(1);
    expect(service.breachOverdueContracts).toHaveBeenCalledTimes(1);

    jobs.stop();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
  });
});
