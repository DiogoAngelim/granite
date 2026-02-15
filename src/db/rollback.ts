import { rollbackLastMigration } from "./migrationRunner.js";

async function main() {
  const rolledBack = await rollbackLastMigration();
  if (!rolledBack) {
    console.log("no applied migrations to rollback");
    return;
  }

  console.log(`rolled back migration: ${rolledBack}`);
}

main().catch((error) => {
  console.error("rollback failed", error);
  process.exit(1);
});