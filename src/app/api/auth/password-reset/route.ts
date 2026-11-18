import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  generateSecureToken,
  getClientIp,
  hashPassword,
  sha256,
  validatePasswordStrength,
} from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import { enqueueMail } from "@/lib/mail";
import { ApiError, handleApiError } from "@/lib/auth";

const resetSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("request"),
    email: z.string().email(),
  }),
  z.object({
    step: z.literal("confirm"),
    token: z.string().min(10),
    newPassword: z.string().min(8).max(128),
  }),
]);

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`pwd-reset:${ip}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many recovery attempts. Please wait a minute." },
        { status: 429 },
      );
    }

    const body = resetSchema.parse(await readJson(request));

    if (body.step === "request") {
      const email = body.email.trim().toLowerCase();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (
        user &&
        (await checkRateLimit(`recovery-account:${email}`, 3, 1800_000)).allowed
      ) {
        const rawToken = generateSecureToken(24);
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              resetTokenHash: sha256(rawToken),
              resetTokenExpiresAt: expiresAt,
            })
            .where(eq(users.id, user.id));
          await enqueueMail(
            tx,
            "recovery",
            email,
            `Enter this recovery code within 30 minutes:\n${rawToken}`,
            expiresAt,
          );
        });
      }
      return NextResponse.json({
        message:
          "If the address is registered, check its inbox for a recovery code.",
      });
    }

    const pwdErr = validatePasswordStrength(body.newPassword);
    if (pwdErr) {
      return NextResponse.json({ error: pwdErr }, { status: 400 });
    }

    const tokenHash = sha256(body.token.trim());
    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(users)
        .set({
          passwordHash,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.resetTokenHash, tokenHash),
            gt(users.resetTokenExpiresAt, new Date()),
          ),
        )
        .returning({ id: users.id });
      if (!claimed)
        throw new ApiError(400, "Invalid or expired password recovery code.");
      await tx.delete(sessions).where(eq(sessions.userId, claimed.id));
    });
    return NextResponse.json({
      message:
        "Password successfully reset. You can now sign in with your new password.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
