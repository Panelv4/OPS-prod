import "dotenv/config";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL for migrations.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(182614, 1)");
    const {
      rows: [state],
    } = await client.query(
      "select to_regclass('public.tenants') as legacy, to_regclass('drizzle.__drizzle_migrations') as journal",
    );
    if (state.legacy && !state.journal)
      throw new Error(
        "Untracked legacy database: review schema and baseline on a restored copy first.",
      );
    if (state.legacy && process.env.NODE_ENV === "production") {
      const seeded = await client.query(
        "select 1 from tenants where slug in ('meridian-ops','northstar-labs') limit 1",
      );
      if (seeded.rowCount)
        throw new Error(
          "Demo fixtures present. Do not migrate a seeded database into production.",
        );
    }
    const expected = readMigrationFiles({ migrationsFolder: "drizzle" });
    if (state.journal) {
      const { rows } = await client.query(
        "select hash,created_at from drizzle.__drizzle_migrations order by id",
      );
      if (
        rows.some(
          (r, i) =>
            expected[i]?.hash !== r.hash ||
            expected[i].folderMillis !== Number(r.created_at),
        )
      )
        throw new Error("Migration journal differs from this release.");
    }
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    if (process.argv.includes("--grant-runtime")) {
      await client.query(
        await readFile("scripts/postgres/runtime-grants.sql", "utf8"),
      );
      console.log("Applied runtime role grants.");
    }
    console.log("Journaled migrations complete. No demo records installed.");
  } finally {
    client.release(true); // closes the physical session and releases its advisory lock
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Migration refused or failed. Check connection, schema history and legacy/demo preflight in DEPLOYMENT_RUNBOOK.md.",
  );
  process.exitCode = 1;
});
