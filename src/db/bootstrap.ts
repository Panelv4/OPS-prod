import { sql } from "drizzle-orm";
import { db } from "@/db";

/** A read-only readiness check. Never create tables, users, or fixtures on HTTP requests. */
export async function ensureDatabaseReady() {
  await db.execute(
    sql`select i.project_id from invoices i, notification_reads r limit 0`,
  );
}
