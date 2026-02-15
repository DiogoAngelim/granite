import { describe, expect, it, vi, beforeEach } from "vitest";

const { readdir, readFile, poolQuery, clientQuery, release, connect } = vi.hoisted(() => {
  const localReaddir = vi.fn();
  const localReadFile = vi.fn();
  const localPoolQuery = vi.fn();
  const localClientQuery = vi.fn();
  const localRelease = vi.fn();
  const localConnect = vi.fn(async () => ({ query: localClientQuery, release: localRelease }));
  return {
    readdir: localReaddir,
    readFile: localReadFile,
    poolQuery: localPoolQuery,
    clientQuery: localClientQuery,
    release: localRelease,
    connect: localConnect,
  };
});

vi.mock("node:fs/promises", () => ({
  readdir,
  readFile,
}));

vi.mock("../src/db/client.js", () => ({
  pool: {
    query: poolQuery,
    connect,
  },
}));

import { applyPendingMigrations, rollbackLastMigration } from "../src/db/migrationRunner.js";

describe("migrationRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies only pending up migrations", async () => {
    readdir.mockResolvedValueOnce(["0001_init.up.sql", "0001_init.down.sql", "0002_x.up.sql"]);
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ filename: "0001_init.up.sql" }] });
    readFile.mockResolvedValueOnce("CREATE TABLE t2();");
    clientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const applied = await applyPendingMigrations();

    expect(applied).toEqual(["0002_x.up.sql"]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back transaction when apply fails", async () => {
    readdir.mockResolvedValueOnce(["0001_init.up.sql"]);
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    readFile.mockResolvedValueOnce("BROKEN SQL");
    clientQuery
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("sql error"))
      .mockResolvedValueOnce(undefined);

    await expect(applyPendingMigrations()).rejects.toThrow("sql error");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns null rollback when no migration is applied", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await rollbackLastMigration();
    expect(result).toBeNull();
  });

  it("rolls back last migration using down file", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ filename: "0002_x.up.sql" }] });
    readFile.mockResolvedValueOnce("DROP TABLE t2;");
    clientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const rolledBack = await rollbackLastMigration();

    expect(rolledBack).toBe("0002_x.up.sql");
    expect(readFile.mock.calls[0][0]).toContain("0002_x.down.sql");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("throws when last migration filename is invalid", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ filename: "manual.sql" }] });

    await expect(rollbackLastMigration()).rejects.toThrow("Invalid migration filename: manual.sql");
  });

  it("rolls back transaction when rollback down execution fails", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ filename: "0003_x.up.sql" }] });
    readFile.mockResolvedValueOnce("BROKEN DOWN SQL");
    clientQuery
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("down error"))
      .mockResolvedValueOnce(undefined);

    await expect(rollbackLastMigration()).rejects.toThrow("down error");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });
});
