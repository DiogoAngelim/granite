import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./client.js";

type MigrationDirection = "up" | "down";

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id bigserial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function listMigrationFiles(direction: MigrationDirection): Promise<string[]> {
  const migrationsDir = join(process.cwd(), "migrations");
  const files = await readdir(migrationsDir);
  return files
    .filter((file) => file.endsWith(`.${direction}.sql`))
    .sort((a, b) => a.localeCompare(b));
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename ASC",
  );
  return new Set(result.rows.map((row) => row.filename));
}

export async function applyPendingMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const files = await listMigrationFiles("up");
  const applied = await getAppliedMigrations();
  const appliedNow: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const fullPath = join(process.cwd(), "migrations", file);
    const sql = await readFile(fullPath, "utf8");
    const digest = checksum(sql);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [file, digest],
      );
      await client.query("COMMIT");
      appliedNow.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return appliedNow;
}

export async function rollbackLastMigration(): Promise<string | null> {
  await ensureMigrationsTable();

  const result = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1",
  );

  const last = result.rows[0];
  if (!last) {
    return null;
  }

  const downFile = last.filename.replace(/\.up\.sql$/, ".down.sql");
  if (downFile === last.filename) {
    throw new Error(`Invalid migration filename: ${last.filename}`);
  }

  const fullPath = join(process.cwd(), "migrations", downFile);
  const downSql = await readFile(fullPath, "utf8");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(downSql);
    await client.query("DELETE FROM schema_migrations WHERE filename = $1", [last.filename]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return last.filename;
}