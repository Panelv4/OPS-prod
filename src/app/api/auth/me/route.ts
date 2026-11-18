import { notificationAudience, unreadBy } from "@/lib/notifications";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, count } from "drizzle-orm";
import { db } from "@/db";
import {
  sessions,
  notifications,
  tenants,
  users,
  workspaceMembers,
} from "@/db/schema";
import {
  ApiError,
  attachSessionCookie,
  createSession,
  getAuthContext,
  handleApiError,
  requireAuth,
} from "@/lib/auth";
import {
  hashPassword,
  sanitizeText,
  sha256,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/security";
import { queueVerification } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Until mailbox verification, return only the identity data used by the verification screen.
    if (!ctx.user.emailVerified)
      return NextResponse.json({
        authenticated: true,
        user: ctx.user,
        csrfToken: ctx.csrfToken,
        permissions: [],
        workspaces: [],
        unreadNotifications: 0,
      });
    const userWorkspaces = await db
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(tenants, eq(workspaceMembers.tenantId, tenants.id))
      .where(
        and(
          eq(workspaceMembers.userId, ctx.user.id),
          eq(workspaceMembers.status, "active"),
        ),
      );

    const unreadRows = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(notificationAudience(ctx), unreadBy(ctx.user.id)));

    return NextResponse.json({
      authenticated: true,
      csrfToken: ctx.csrfToken,
      user: ctx.user,
      role: ctx.role,
      permissions: Array.from(ctx.permissions),
      tenant: {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        slug: ctx.tenant.slug,
        industry: ctx.tenant.industry,
        currency: ctx.tenant.currency,
        jurisdiction: ctx.tenant.jurisdiction,
        taxLabel: ctx.tenant.taxLabel,
        defaultTaxBps: ctx.tenant.defaultTaxBps,
        taxId: ctx.tenant.taxId,
        address: ctx.tenant.address,
        website: ctx.tenant.website,
        plan: ctx.tenant.plan,
        billingStatus: ctx.tenant.billingStatus,
        aiProvider: ctx.tenant.aiProvider,
        aiModel: ctx.tenant.aiModel,
        hasAiApiKey: Boolean(ctx.tenant.aiApiKeyEncrypted),
        aiTokensUsed: ctx.tenant.aiTokensUsed,
        aiTokenLimit: ctx.tenant.aiTokenLimit,
        dashboardWidgets: ctx.tenant.dashboardWidgets,
      },
      workspaces: userWorkspaces,
      unreadNotifications: unreadRows[0].value,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const updateAccountSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().max(40).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
  verificationToken: z.string().max(120).optional(),
  resendVerification: z.boolean().optional(),
  notificationPrefs: z
    .object({
      inApp: z.boolean(),
      email: z.boolean(),
      invoiceAlerts: z.boolean(),
      leadAlerts: z.boolean(),
      stockAlerts: z.boolean(),
      hrAlerts: z.boolean(),
      taskAlerts: z.boolean(),
      automationAlerts: z.boolean(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const body = updateAccountSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      const [fullUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)
        .for("update");
      if (!fullUser) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }

      const updates: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (body.fullName) updates.fullName = sanitizeText(body.fullName);
      if (body.phone !== undefined) updates.phone = sanitizeText(body.phone);
      if (body.notificationPrefs)
        updates.notificationPrefs = body.notificationPrefs;

      if (body.resendVerification && !fullUser.emailVerified) {
        if (
          !(await checkRateLimit(`verification:${fullUser.id}`, 3, 600_000))
            .allowed
        )
          throw new ApiError(
            429,
            "Please wait before requesting another code.",
          );
        await queueVerification(fullUser, tx);
        return NextResponse.json({ ok: true });
      }
      if (body.verificationToken) {
        const hashed = sha256(body.verificationToken.trim());
        if (
          fullUser.verificationExpiresAt &&
          fullUser.verificationExpiresAt > new Date() &&
          fullUser.verificationTokenHash &&
          hashed === fullUser.verificationTokenHash
        ) {
          updates.emailVerified = true;
          updates.verificationTokenHash = null;
          updates.verificationExpiresAt = null;
        } else {
          return NextResponse.json(
            { error: "Invalid email verification token." },
            { status: 400 },
          );
        }
      }

      if (body.newPassword) {
        if (!body.currentPassword) {
          return NextResponse.json(
            { error: "Current password is required to set a new password." },
            { status: 400 },
          );
        }
        const ok = await verifyPassword(
          body.currentPassword,
          fullUser.passwordHash,
        );
        if (!ok) {
          return NextResponse.json(
            { error: "Current password is incorrect." },
            { status: 400 },
          );
        }
        const strengthErr = validatePasswordStrength(body.newPassword);
        if (strengthErr) {
          return NextResponse.json({ error: strengthErr }, { status: 400 });
        }
        updates.passwordHash = await hashPassword(body.newPassword);

        await recordAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "auth.password_changed",
            module: "auth",
            entityType: "user",
            entityId: ctx.user.id,
            summary: `${ctx.user.fullName} updated their account password`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );
      }

      const [updated] = await tx
        .update(users)
        .set(updates)
        .where(eq(users.id, ctx.user.id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          emailVerified: users.emailVerified,
          notificationPrefs: users.notificationPrefs,
        });

      if (body.newPassword || body.verificationToken) {
        if (body.newPassword)
          await tx.delete(sessions).where(eq(sessions.userId, ctx.user.id));
        else await tx.delete(sessions).where(eq(sessions.id, ctx.sessionId));
        const fresh = await createSession(
          { userId: ctx.user.id, tenantId: ctx.tenantId, request },
          tx,
        );
        const res = NextResponse.json({
          user: updated,
          csrfToken: fresh.csrfToken,
        });
        attachSessionCookie(res, fresh.rawToken, fresh.expiresAt, request);
        return res;
      }
      return NextResponse.json({ user: updated });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
