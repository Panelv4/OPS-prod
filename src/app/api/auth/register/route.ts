import { isReservedDemoEmail } from "@/lib/demo";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  tenants,
  users,
  workspaceInvitations,
  workspaceMembers,
} from "@/db/schema";
import {
  generateSecureToken,
  getClientIp,
  hashPassword,
  sanitizeText,
  sha256,
  validatePasswordStrength,
} from "@/lib/security";
import {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/lib/permissions";
import {
  ApiError,
  attachSessionCookie,
  createSession,
  handleApiError,
} from "@/lib/auth";
import { createNotification, recordAuditLog } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { queueVerification } from "@/lib/mail";
import { checkCapacity } from "@/lib/entitlements";

const registerSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email().max(150),
  password: z.string().min(8).max(128),
  workspaceName: z.string().min(2).max(120).optional(),
  industry: z.string().max(100).optional(),
  currency: z
    .enum(["INR", "USD", "EUR", "GBP", "SGD", "AED", "CAD", "AUD"])
    .optional(),
  jurisdiction: z.enum(["IN", "US", "GB", "SG", "AE", "CA", "AU"]).optional(),
  inviteCode: z.string().max(120).optional(),
});

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = generateSecureToken(3);
  return `${base || "workspace"}-${suffix}`;
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`register:${ip}`, 15, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again shortly." },
        { status: 429 },
      );
    }

    const body = registerSchema.parse(await readJson(request));
    const email = body.email.trim().toLowerCase();
    if (isReservedDemoEmail(email))
      throw new ApiError(400, "Unable to register with this address.");
    const pwdError = validatePasswordStrength(body.password);
    if (pwdError) {
      return NextResponse.json({ error: pwdError }, { status: 400 });
    }

    const passwordHash = await hashPassword(body.password);
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash, fullName: sanitizeText(body.fullName) })
        .onConflictDoNothing()
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
        });
      if (!user)
        throw new ApiError(
          409,
          "Unable to register. If you already have an account, sign in or recover your password.",
        );
      let role: typeof workspaceMembers.$inferSelect.role = "owner";
      let workspace;
      if (body.inviteCode?.trim()) {
        const [invite] = await tx
          .update(workspaceInvitations)
          .set({ status: "accepted" })
          .where(
            and(
              eq(
                workspaceInvitations.tokenHash,
                sha256(body.inviteCode.trim()),
              ),
              eq(workspaceInvitations.email, email),
              eq(workspaceInvitations.status, "pending"),
              gt(workspaceInvitations.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!invite) throw new ApiError(400, "Invitation invalid or expired.");
        await checkCapacity(tx, invite.tenantId, "seat");
        [workspace] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, invite.tenantId));
        role = invite.role;
      } else {
        const name = sanitizeText(
          body.workspaceName || `${user.fullName}'s Workspace`,
        );
        const jurisdiction = body.jurisdiction || "IN";
        [workspace] = await tx
          .insert(tenants)
          .values({
            name,
            slug: slugify(name),
            industry: sanitizeText(body.industry || "Professional services"),
            currency: body.currency || "INR",
            jurisdiction,
            taxLabel: ["IN", "SG"].includes(jurisdiction)
              ? "GST"
              : jurisdiction === "GB"
                ? "VAT"
                : "Tax",
            defaultTaxBps: 0,
            plan: "community",
            dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
            rolePermissions: DEFAULT_ROLE_PERMISSIONS,
          })
          .returning();
      }
      await tx
        .insert(workspaceMembers)
        .values({
          tenantId: workspace.id,
          userId: user.id,
          role,
          title: role.replace("_", " "),
        });
      await queueVerification(user, tx);
      await createNotification(
        {
          tenantId: workspace.id,
          userId: user.id,
          title: "Welcome to OpsPilot",
          message: "Start with a customer, project and invoice.",
          link: "/app",
        },
        tx,
      );
      await recordAuditLog(
        {
          tenantId: workspace.id,
          userId: user.id,
          actorName: user.fullName,
          action: "auth.registered",
          module: "auth",
          entityType: "user",
          entityId: user.id,
          summary: "",
          ipAddress: ip,
        },
        tx,
      );
      const session = await createSession(
        { userId: user.id, tenantId: workspace.id, request },
        tx,
      );
      return {
        user,
        tenantId: workspace.id,
        workspaceName: workspace.name,
        role,
        session,
      };
    });
    const { session, ...publicResult } = result;
    const response = NextResponse.json(
      {
        ...publicResult,
        user: { ...result.user, emailVerified: false },
        csrfToken: session.csrfToken,
        emailVerificationPending: true,
      },
      { status: 201 },
    );
    attachSessionCookie(response, session.rawToken, session.expiresAt, request);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
