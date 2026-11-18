import { createHmac } from "node:crypto";
import { pool } from "@/db";
import { vaultMaterial } from "./config";

/** Fixed windows shared by all replicas; atomic upsert uses the database clock. Fail closed on DB errors. */
export async function checkRateLimit(
  subject: string,
  limit: number,
  windowMs: number,
) {
  const key = createHmac("sha256", vaultMaterial())
    .update(`rate:${subject}`)
    .digest("hex");
  const {
    rows: [row],
  } = await pool.query<{ hits: number; retry: number }>(
    `
    INSERT INTO rate_windows AS w (key, hits, expires_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET hits = CASE WHEN w.expires_at <= now() THEN 1 ELSE least(w.hits + 1, $3 + 1) END,
    expires_at = CASE WHEN w.expires_at <= now() THEN excluded.expires_at ELSE w.expires_at END
    RETURNING hits, greatest(1, ceil(extract(epoch FROM expires_at - now())))::int AS retry`,
    [key, windowMs, limit],
  );
  return {
    allowed: row.hits <= limit,
    remaining: Math.max(0, limit - row.hits),
    retryAfterSec: row.retry,
  };
}
