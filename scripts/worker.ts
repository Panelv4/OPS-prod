import "dotenv/config";
import { setTimeout as wait } from "node:timers/promises";
import { eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { tenants } from "../src/db/schema";
import { advanceWorkflow, runScheduledSweep } from "../src/lib/automation";
import { deliverMail, smtpTransport } from "../src/lib/mail-worker";
import { validateRuntimeConfig } from "../src/lib/config";

async function main() {
  validateRuntimeConfig();
  const smtp = smtpTransport();
  let stopping = false;
  let nextCleanup = 0;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  do {
    try {
      if (Date.now() >= nextCleanup) {
        await db.execute(
          sql`delete from rate_windows where expires_at < now()`,
        );
        await db.execute(sql`delete from sessions where expires_at < now()`);
        await db.execute(
          sql`update mail_jobs set payload=null, status='failed', finished_at=now() where status='queued' and expires_at <= now()`,
        );
        await db.execute(
          sql`delete from mail_jobs where finished_at < now() - interval '30 days'`,
        );
        nextCleanup = Date.now() + 60000;
      }
      const today = new Date().toISOString().slice(0, 10);
      const swept = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(
            or(isNull(tenants.lastSweepDate), lt(tenants.lastSweepDate, today)),
          )
          .orderBy(tenants.id)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return false;
        await runScheduledSweep(row.id, null, tx);
        await tx
          .update(tenants)
          .set({ lastSweepDate: today })
          .where(eq(tenants.id, row.id));
        return true;
      });
      const step = await advanceWorkflow();
      const sent =
        smtp &&
        (await deliverMail((msg) =>
          smtp.sendMail({ ...msg, from: process.env.SMTP_FROM }),
        ));
      if (!swept && !step && !sent && !process.argv.includes("--once"))
        await wait(2000);
    } catch {
      console.error("Worker iteration failed; no job payload logged.");
      if (process.argv.includes("--once")) throw new Error("Worker failed");
      await wait(5000);
    }
  } while (!stopping && !process.argv.includes("--once"));
  smtp?.close();
}
main()
  .catch(() => {
    console.error("Worker stopped. Check configuration and migrations.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
