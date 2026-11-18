import { checkCapacity } from "@/lib/entitlements";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  documents,
  sessions,
  tenants,
  users,
  workflows,
  workspaceInvitations,
  workspaceMembers,
} from "@/db/schema";
import {
  ApiError,
  handleApiError,
  requireAuth,
  createSession,
  attachSessionCookie,
} from "@/lib/auth";
import {
  ALL_PERMISSIONS,
  ALL_ROLES,
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/lib/permissions";
import {
  encryptSecret,
  generateSecureToken,
  sanitizeText,
  sha256,
} from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request);

    const members = await db
      .select({
        id: workspaceMembers.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        role: workspaceMembers.role,
        title: workspaceMembers.title,
        status: workspaceMembers.status,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.tenantId, ctx.tenantId));

    const invitations = ctx.permissions.has("workspace:users")
      ? await db
          .select({
            id: workspaceInvitations.id,
            email: workspaceInvitations.email,
            role: workspaceInvitations.role,
            status: workspaceInvitations.status,
            expiresAt: workspaceInvitations.expiresAt,
            createdAt: workspaceInvitations.createdAt,
          })
          .from(workspaceInvitations)
          .where(eq(workspaceInvitations.tenantId, ctx.tenantId))
          .orderBy(desc(workspaceInvitations.createdAt))
      : [];

    const recentAuditLogs = ctx.permissions.has("workspace:audit")
      ? await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.tenantId, ctx.tenantId))
          .orderBy(desc(auditLogs.createdAt))
          .limit(50)
      : [];

    const docRows = await db
      .select({ sizeBytes: documents.sizeBytes })
      .from(documents)
      .where(eq(documents.tenantId, ctx.tenantId));
    const wfRows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.tenantId, ctx.tenantId));

    const storageBytes = docRows.reduce((s, d) => s + d.sizeBytes, 0);

    const effectiveRolePerms =
      Object.keys(ctx.tenant.rolePermissions || {}).length > 0
        ? ctx.tenant.rolePermissions
        : DEFAULT_ROLE_PERMISSIONS;

    return NextResponse.json({
      workspace: {
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
        aiProvider: ctx.tenant.aiProvider,
        aiModel: ctx.tenant.aiModel,
        hasAiApiKey: Boolean(ctx.tenant.aiApiKeyEncrypted),
        aiTokensUsed: ctx.tenant.aiTokensUsed,
        aiTokenLimit: ctx.tenant.aiTokenLimit,
        apiCallsCount: ctx.tenant.apiCallsCount,
        storageBytes,
        documentCount: docRows.length,
        workflowCount: wfRows.length,
        memberCount: members.length,
      },
      members,
      invitations,
      rolePermissions: effectiveRolePerms,
      allRoles: ALL_ROLES,
      allPermissions: ALL_PERMISSIONS,
      auditLogs: recentAuditLogs,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchWorkspaceSchema = z.object({
  action: z
    .enum([
      "update_settings",
      "update_role_permissions",
      "update_ai",
      "switch_workspace",
      "create_workspace",
      "update_widgets",
      "accept_invitation",
    ])
    .default("update_settings"),
  name: z.string().min(2).max(120).optional(),
  industry: z.string().max(100).optional(),
  currency: z
    .enum(["INR", "USD", "EUR", "GBP", "SGD", "AED", "CAD", "AUD"])
    .optional(),
  jurisdiction: z.enum(["IN", "US", "GB", "SG", "AE", "CA", "AU"]).optional(),
  taxLabel: z.string().max(20).optional(),
  defaultTaxBps: z.number().int().min(0).max(5000).optional(),
  taxId: z.string().max(60).optional(),
  address: z.string().max(300).optional(),
  website: z.string().max(150).optional(),
  rolePermissions: z.record(z.string(), z.array(z.string())).optional(),
  aiProvider: z.enum(["deterministic", "openai"]).optional(),
  aiModel: z.string().max(80).optional(),
  aiApiKey: z.string().max(300).optional(),
  clearAiApiKey: z.boolean().optional(),
  inviteCode: z.string().max(120).optional(),
  targetTenantId: z.number().int().positive().optional(),
  dashboardWidgets: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        visible: z.boolean(),
        order: z.number().int(),
      }),
    )
    .optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const body = patchWorkspaceSchema.parse(await readJson(request));

    if (body.action === "accept_invitation") {
      return await db.transaction(async (tx) => {
        const [invite] = await tx
          .update(workspaceInvitations)
          .set({ status: "accepted" })
          .where(
            and(
              eq(workspaceInvitations.email, ctx.user.email),
              eq(
                workspaceInvitations.tokenHash,
                sha256(body.inviteCode?.trim() || ""),
              ),
              eq(workspaceInvitations.status, "pending"),
              gt(workspaceInvitations.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!invite) throw new ApiError(400, "Invitation invalid or expired.");
        await checkCapacity(tx, invite.tenantId, "seat");
        await tx
          .insert(workspaceMembers)
          .values({
            tenantId: invite.tenantId,
            userId: ctx.user.id,
            role: invite.role,
            title: invite.role.replace("_", " "),
          });
        await recordAuditLog(
          {
            tenantId: invite.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "member.joined",
            module: "workspace",
            entityType: "member",
            summary: "",
          },
          tx,
        );
        await tx.delete(sessions).where(eq(sessions.id, ctx.sessionId));
        const session = await createSession(
          { userId: ctx.user.id, tenantId: invite.tenantId, request },
          tx,
        );
        const res = NextResponse.json({
          ok: true,
          csrfToken: session.csrfToken,
        });
        attachSessionCookie(res, session.rawToken, session.expiresAt, request);
        return res;
      });
    }
    if (body.action === "switch_workspace") {
      if (!body.targetTenantId) {
        throw new ApiError(400, "targetTenantId is required.");
      }
      const [membership] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.tenantId, body.targetTenantId),
            eq(workspaceMembers.userId, ctx.user.id),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1);
      if (!membership) {
        throw new ApiError(403, "You do not have access to that workspace.");
      }
      const next = await db.transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.id, ctx.sessionId));
        return createSession(
          { userId: ctx.user.id, tenantId: membership.tenantId, request },
          tx,
        );
      });
      const res = NextResponse.json({
        ok: true,
        activeTenantId: membership.tenantId,
        csrfToken: next.csrfToken,
      });
      attachSessionCookie(res, next.rawToken, next.expiresAt, request);
      return res;
    }

    if (body.action === "create_workspace") {
      const wsName = sanitizeText(body.name || "New Workspace");
      const slug = `${wsName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 32)}-${generateSecureToken(3)}`;
      return await db.transaction(async (tx) => {
        const [newTenant] = await tx
          .insert(tenants)
          .values({
            name: wsName,
            slug,
            industry: sanitizeText(body.industry || "Business Services"),
            currency: body.currency || "INR",
            jurisdiction: body.jurisdiction || "IN",
            defaultTaxBps: 0,
            taxLabel: "Tax",
            plan: "community",
            dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
            rolePermissions: DEFAULT_ROLE_PERMISSIONS,
          })
          .returning();

        await tx.insert(workspaceMembers).values({
          tenantId: newTenant.id,
          userId: ctx.user.id,
          role: "owner",
          title: "Workspace Owner",
        });

        await tx.delete(sessions).where(eq(sessions.id, ctx.sessionId));
        const next = await createSession(
          { userId: ctx.user.id, tenantId: newTenant.id, request },
          tx,
        );

        await recordAuditLog(
          {
            tenantId: newTenant.id,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "workspace.created",
            module: "workspace",
            entityType: "tenant",
            entityId: newTenant.id,
            summary: `Created isolated workspace "${newTenant.name}"`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        const res = NextResponse.json(
          {
            ok: true,
            workspace: { id: newTenant.id, name: newTenant.name },
            csrfToken: next.csrfToken,
          },
          { status: 201 },
        );
        attachSessionCookie(res, next.rawToken, next.expiresAt, request);
        return res;
      });
    }

    if (body.action === "update_widgets") {
      if (!ctx.permissions.has("dashboard:customize")) {
        throw new ApiError(403, "Missing dashboard:customize permission.");
      }
      await db
        .update(tenants)
        .set({
          dashboardWidgets: body.dashboardWidgets ?? DEFAULT_DASHBOARD_WIDGETS,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId));
      return NextResponse.json({
        ok: true,
        dashboardWidgets: body.dashboardWidgets,
      });
    }

    if (body.action === "update_role_permissions") {
      if (ctx.role !== "owner") {
        throw new ApiError(403, "Only owners can edit role permissions.");
      }
      const allowedSet = new Set<string>(ALL_PERMISSIONS);
      const cleaned: Record<string, string[]> = {};
      for (const [roleKey, perms] of Object.entries(
        body.rolePermissions || {},
      )) {
        if (roleKey === "owner") {
          cleaned.owner = [...ALL_PERMISSIONS];
        } else {
          cleaned[roleKey] = perms.filter(
            (p) => allowedSet.has(p) && p !== "workspace:billing",
          );
        }
      }
      await db
        .update(tenants)
        .set({ rolePermissions: cleaned, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));

      await recordAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        actorName: ctx.user.fullName,
        action: "rbac.updated",
        module: "workspace",
        entityType: "role_permissions",
        summary: `${ctx.user.fullName} updated configurable RBAC permission matrix`,
        ipAddress: ctx.ipAddress,
      });

      return NextResponse.json({ ok: true, rolePermissions: cleaned });
    }

    if (body.action === "update_ai") {
      if (ctx.role !== "owner" || !ctx.permissions.has("ai:configure")) {
        throw new ApiError(403, "Only the workspace owner can configure AI.");
      }
      if (
        body.aiProvider === "openai" &&
        (ctx.role !== "owner" || process.env.ENABLE_EXTERNAL_AI !== "1")
      )
        throw new ApiError(
          403,
          "External AI requires operator enablement and workspace owner consent.",
        );
      const updates: Partial<typeof tenants.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.aiProvider) updates.aiProvider = body.aiProvider;
      if (body.aiModel) updates.aiModel = sanitizeText(body.aiModel);
      if (body.clearAiApiKey) {
        updates.aiApiKeyEncrypted = null;
      } else if (body.aiApiKey && body.aiApiKey.trim().length > 0) {
        updates.aiApiKeyEncrypted = encryptSecret(body.aiApiKey.trim());
      }

      await db.update(tenants).set(updates).where(eq(tenants.id, ctx.tenantId));

      await recordAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        actorName: ctx.user.fullName,
        action: "ai.configured",
        module: "ai",
        entityType: "tenant",
        entityId: ctx.tenantId,
        summary: `Updated AI provider configuration to ${body.aiProvider || ctx.tenant.aiProvider}`,
        ipAddress: ctx.ipAddress,
      });

      return NextResponse.json({
        ok: true,
        aiProvider: updates.aiProvider || ctx.tenant.aiProvider,
        hasAiApiKey: body.clearAiApiKey
          ? false
          : Boolean(body.aiApiKey || ctx.tenant.aiApiKeyEncrypted),
      });
    }

    // Default: update_settings
    if (!ctx.permissions.has("workspace:manage")) {
      throw new ApiError(403, "Missing workspace:manage permission.");
    }

    const updates: Partial<typeof tenants.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name) updates.name = sanitizeText(body.name);
    if (body.industry !== undefined)
      updates.industry = sanitizeText(body.industry);
    if (body.currency && body.currency !== ctx.tenant.currency)
      throw new ApiError(
        409,
        "Workspace currency is fixed to avoid reinterpreting historical amounts.",
      );
    if (body.jurisdiction) updates.jurisdiction = body.jurisdiction;
    if (body.taxLabel) updates.taxLabel = sanitizeText(body.taxLabel);
    if (body.defaultTaxBps !== undefined)
      updates.defaultTaxBps = body.defaultTaxBps;
    if (body.taxId !== undefined) updates.taxId = sanitizeText(body.taxId);
    if (body.address !== undefined)
      updates.address = sanitizeText(body.address);
    if (body.website !== undefined)
      updates.website = sanitizeText(body.website);

    await db.update(tenants).set(updates).where(eq(tenants.id, ctx.tenantId));

    await recordAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      actorName: ctx.user.fullName,
      action: "workspace.updated",
      module: "workspace",
      entityType: "tenant",
      entityId: ctx.tenantId,
      summary: `${ctx.user.fullName} updated workspace profile & regional settings`,
      ipAddress: ctx.ipAddress,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
