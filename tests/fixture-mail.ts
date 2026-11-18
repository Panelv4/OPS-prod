import assert from "node:assert/strict";
import { pool } from "../src/db";
import { decryptSecret } from "../src/lib/security";
export function assertPrivateFixture() {
  assert.ok(
    !process.env.SMTP_HOST ||
      ["127.0.0.1", "localhost"].includes(process.env.SMTP_HOST),
    "Never run with external mail transport.",
  );
  assert.notEqual(process.env.ENABLE_EXTERNAL_AI, "1");
  const db = new URL(process.env.DATABASE_URL || "about:blank");
  assert.ok(
    ["127.0.0.1", "localhost"].includes(db.hostname) &&
      db.pathname.endsWith("_test"),
    "Use a loopback *_test fixture database. Never run this suite on customer data.",
  );
  assert.ok(
    ["127.0.0.1", "localhost"].includes(
      new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3000").hostname,
    ),
  );
}
export async function fixtureCode(kind: string, email: string) {
  assertPrivateFixture();
  const { rows } = await pool.query(
    "select payload from mail_jobs where kind=$1 and status=$2 order by id desc limit 100",
    [kind, "queued"],
  );
  for (const row of rows) {
    const msg = JSON.parse(decryptSecret(row.payload) || "{}");
    if (msg.to === email) return String(msg.text).split("\n").at(-1)!;
  }
  throw new Error("Expected fixture mailbox delivery was not queued.");
}
