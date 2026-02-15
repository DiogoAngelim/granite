import { applyPendingMigrations } from "./migrationRunner.js";

async function main() {
  const applied = await applyPendingMigrations();
  if (applied.length === 0) {
    console.log("no pending migrations");
    return;
  }

  for (const file of applied) {
    console.log(`applied migration: ${file}`);
  }
}

main().catch((error) => {
  console.error("migration failed", error);
  process.exit(1);
});