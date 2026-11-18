import { db, type Database } from "@/db";
import { mailJobs } from "@/db/schema";
import { encryptSecret } from "./security";

export type MailKind =
  | "verification"
  | "recovery"
  | "invitation"
  | "notification"
  | "billing";
export async function enqueueMail(
  store: Database,
  kind: MailKind,
  to: string,
  text: string,
  expiresAt: Date,
) {
  await store
    .insert(mailJobs)
    .values({
      kind,
      payload: encryptSecret(JSON.stringify({ to, text })),
      expiresAt,
    });
}
export async function queueVerification(
  user: { id: number; email: string },
  store: Database = db,
) {
  const { users } = await import("@/db/schema");
  const { generateSecureToken, sha256 } = await import("./security");
  const { eq } = await import("drizzle-orm");
  const token = generateSecureToken(24);
  const expires = new Date(Date.now() + 24 * 3600_000);
  await store
    .update(users)
    .set({
      verificationTokenHash: sha256(token),
      verificationExpiresAt: expires,
    })
    .where(eq(users.id, user.id));
  await enqueueMail(
    store,
    "verification",
    user.email,
    `Enter this code on the workspace verification screen within 24 hours:\n${token}`,
    expires,
  );
}
