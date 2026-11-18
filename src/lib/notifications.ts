import { and, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { notifications } from "@/db/schema";
import type { NotificationPrefs } from "@/db/schema";
import type { AuthContext } from "./auth";
const sources = [
  ["/app/projects", "projects:view", "taskAlerts"],
  ["/app/hrms", "hrms:view", "hrAlerts"],
  ["/app/inventory", "inventory:view", "stockAlerts"],
  ["/app/crm", "crm:view", "leadAlerts"],
  ["/app/sales", "sales:view", "invoiceAlerts"],
  ["/app/automations", "automation:view", "automationAlerts"],
] as const;
export function notificationAudience(ctx: AuthContext) {
  const links = [
    "/app",
    ...sources
      .filter(
        ([, perm, pref]) =>
          ctx.permissions.has(perm) && ctx.user.notificationPrefs[pref],
      )
      .map(([link]) => link),
  ];
  return and(
    ctx.user.notificationPrefs.inApp ? undefined : sql`false`,
    eq(notifications.tenantId, ctx.tenantId),
    or(isNull(notifications.userId), eq(notifications.userId, ctx.user.id)),
    ["owner", "administrator"].includes(ctx.role)
      ? undefined
      : or(
          isNull(notifications.targetRole),
          eq(notifications.targetRole, ctx.role),
        ),
    or(isNull(notifications.link), inArray(notifications.link, links)),
  );
}
export function emailPreference(
  link: string | null | undefined,
  prefs: NotificationPrefs,
) {
  const source = sources.find(([url]) => url === link);
  return prefs.email && (!source || prefs[source[2]]);
}
export function unreadBy(userId: number) {
  return sql<boolean>`not ${notifications.isRead} and not exists (select 1 from notification_reads r where r.notification_id=${notifications.id} and r.user_id=${userId})`;
}
