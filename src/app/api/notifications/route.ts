import { notificationAudience, unreadBy } from "@/lib/notifications";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { handleApiError, requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request);

    const rows = await db
      .select({
        ...getTableColumns(notifications),
        isRead: sql<boolean>`not (${unreadBy(ctx.user.id)})`,
      })
      .from(notifications)
      .where(notificationAudience(ctx))
      .orderBy(desc(notifications.createdAt))
      .limit(40);

    return NextResponse.json({
      notifications: rows,
      unreadCount: rows.filter((n) => !n.isRead).length,
      prefs: ctx.user.notificationPrefs,
      smtpConfigured: Boolean(process.env.SMTP_HOST),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchNotifSchema = z.object({
  id: z.number().int().positive().optional(),
  markAllRead: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const body = patchNotifSchema.parse(await readJson(request));

    if (!body.markAllRead && !body.id)
      return NextResponse.json(
        { error: "Choose a notification." },
        { status: 400 },
      );
    await db.execute(sql`insert into notification_reads(notification_id,user_id)
      select id, ${ctx.user.id} from notifications where ${and(notificationAudience(ctx), body.markAllRead ? undefined : eq(notifications.id, body.id!), unreadBy(ctx.user.id))} on conflict do nothing`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
