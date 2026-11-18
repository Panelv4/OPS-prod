import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, workspaceInvitations, workspaceMembers } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { generateSecureToken, sha256 } from "@/lib/security";
import { enqueueMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkCapacity } from "@/lib/entitlements";
import { recordAuditLog } from "@/lib/audit";

const roleEnum = z.enum([
  "owner",
  "administrator",
  "manager",
  "hr_manager",
  "accountant",
  "salesperson",
  "employee",
]);

const inviteSchema = z.object({
  email: z.string().email(),
  role: roleEnum.default("employee"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "workspace:users");
    const body = inviteSchema.parse(await readJson(request));
    const email = body.email.trim().toLowerCase();

    if (
      ctx.role !== "owner" &&
      (body.role !== "employee" || ctx.role !== "administrator")
    )
      throw new ApiError(403, "Only an owner can delegate privileged roles.");
    if (!(await checkRateLimit(`invite:${ctx.tenantId}`, 20, 3600_000)).allowed)
      throw new ApiError(429, "Workspace invitation limit reached.");
    const code = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const invitation = await db.transaction(async (tx) => {
      await checkCapacity(tx, ctx.tenantId, "seat");
      const [invite] = await tx
        .insert(workspaceInvitations)
        .values({
          tenantId: ctx.tenantId,
          email,
          role: body.role,
          tokenHash: sha256(code),
          invitedByUserId: ctx.user.id,
          expiresAt,
        })
        .returning({
          id: workspaceInvitations.id,
          email: workspaceInvitations.email,
          role: workspaceInvitations.role,
          expiresAt: workspaceInvitations.expiresAt,
        });
      await enqueueMail(
        tx,
        "invitation",
        email,
        `Use this invitation with this email address during registration, or in Settings if already registered. Expires in seven days:\n${code}`,
        expiresAt,
      );
      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "member.invited",
          module: "workspace",
          entityType: "invitation",
          entityId: invite.id,
          summary: "",
        },
        tx,
      );
      return invite;
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const updateMemberSchema = z.object({
  memberId: z.number().int().positive(),
  role: roleEnum.optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "workspace:users");
    const body = updateMemberSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.id, body.memberId),
            eq(workspaceMembers.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
        .for("update");

      if (!member) {
        throw new ApiError(404, "Workspace member not found.");
      }

      if (
        member.role === "owner" ||
        (ctx.role !== "owner" &&
          (ctx.role !== "administrator" ||
            member.role !== "employee" ||
            body.role !== undefined))
      ) {
        throw new ApiError(
          403,
          "Only owners can change roles; ownership cannot be removed here.",
        );
      }
      if (member.userId === ctx.user.id && body.status === "suspended") {
        throw new ApiError(400, "You cannot suspend your own account.");
      }

      const updates: Partial<typeof workspaceMembers.$inferInsert> = {};
      if (body.role) updates.role = body.role;
      if (body.status) updates.status = body.status;

      const [updated] = await tx
        .update(workspaceMembers)
        .set(updates)
        .where(
          and(
            eq(workspaceMembers.id, member.id),
            eq(workspaceMembers.tenantId, ctx.tenantId),
          ),
        )
        .returning();

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "member.updated",
          module: "workspace",
          entityType: "workspace_member",
          entityId: member.id,
          summary: `Updated member #${member.id} (${body.role || member.role}, ${
            body.status || member.status
          })`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );
      await tx
        .delete(sessions)
        .where(
          and(
            eq(sessions.userId, member.userId),
            eq(sessions.activeTenantId, ctx.tenantId),
          ),
        );

      return NextResponse.json({ member: updated });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "workspace:users");
    const url = new URL(request.url);
    const invitationId = Number(url.searchParams.get("invitationId"));
    if (!Number.isInteger(invitationId) || invitationId <= 0) {
      throw new ApiError(400, "Valid invitationId query parameter required.");
    }

    await db
      .update(workspaceInvitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.tenantId, ctx.tenantId),
          eq(workspaceInvitations.status, "pending"),
          ctx.role === "owner"
            ? undefined
            : eq(workspaceInvitations.role, "employee"),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
