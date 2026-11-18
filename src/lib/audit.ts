import { emailPreference } from "./notifications";
import { db, type Database } from "@/db";
import {
  auditLogs,
  milestones,
  notifications,
  tenants,
  users,
  workspaceMembers,
} from "@/db/schema";
import { enqueueMail } from "./mail";
import { and, eq, sql } from "drizzle-orm";

export async function recordAuditLog(
  params: {
    tenantId: number;
    userId?: number | null;
    actorName: string;
    action: string;
    module: string;
    entityType: string;
    entityId?: string | number | null;
    summary: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  },
  store: Database = db,
): Promise<void> {
  await store.insert(auditLogs).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    actorName: params.actorName,
    action: params.action,
    module: params.module,
    entityType: params.entityType,
    entityId: params.entityId != null ? String(params.entityId) : null,
    summary: `${params.action} · ${params.entityType}`,
    metadata: {},
    ipAddress: params.ipAddress ?? null,
  });
  const events: Record<string, string> = {
    "customer.created": "customer",
    "customer.imported": "customer",
    "project.created": "project",
    "invoice.created": "financial",
    "sales.converted_to_invoice": "financial",
    "ledger.expense_posted": "financial",
    "ledger.income_posted": "financial",
    "member.invited": "invitation",
    "ai.receipt_posted": "financial",
  };
  const step = events[params.action];
  if (step)
    await store
      .insert(milestones)
      .values({ tenantId: params.tenantId, step })
      .onConflictDoNothing();
}

export async function createNotification(
  params: {
    tenantId: number;
    userId?: number | null;
    targetRole?: string | null;
    title: string;
    message: string;
    type?: "info" | "success" | "warning" | "alert" | "automation";
    link?: string | null;
  },
  store: Database = db,
): Promise<void> {
  const recipients = process.env.SMTP_HOST
    ? await store
        .select({ email: users.email, prefs: users.notificationPrefs })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.tenantId, params.tenantId),
            eq(workspaceMembers.status, "active"),
            eq(users.emailVerified, true),
            params.userId ? eq(users.id, params.userId) : undefined,
            params.targetRole
              ? eq(
                  workspaceMembers.role,
                  params.targetRole as typeof workspaceMembers.$inferSelect.role,
                )
              : undefined,
          ),
        )
    : [];
  const opted = recipients.filter((r) => emailPreference(params.link, r.prefs));
  for (const r of opted)
    await enqueueMail(
      store,
      "notification",
      r.email,
      "There is a new workspace notification. Sign in to review it.",
      new Date(Date.now() + 86400_000),
    );
  await store.insert(notifications).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    targetRole: params.targetRole ?? null,
    title: params.title,
    message: params.message,
    type: params.type ?? "info",
    link: params.link ?? null,
    isRead: false,
    emailQueued: opted.length > 0,
  });
}

export async function trackTenantApiCall(
  tenantId: number,
  module: string,
): Promise<void> {
  // One aggregate row per module/day, not a log of individual actions. Counters are best effort.
  await db.execute(sql`with activity as (insert into workspace_activity (tenant_id,day,module) values (${tenantId},to_char(now() at time zone 'UTC','YYYY-MM-DD'),${module})
    on conflict (tenant_id,day,module) do update set requests = workspace_activity.requests + 1)
    update tenants set api_calls_count=api_calls_count+1 where id=${tenantId}`);
}
