import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { clearSessionCookie, requireAuth, handleApiError } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);
    await db.delete(sessions).where(eq(sessions.id, ctx.sessionId));
    await recordAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      actorName: ctx.user.fullName,
      action: "auth.logout",
      module: "auth",
      entityType: "session",
      summary: `${ctx.user.fullName} signed out`,
      ipAddress: ctx.ipAddress,
    });
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response, request);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
