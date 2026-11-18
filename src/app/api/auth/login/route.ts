import { isReservedDemoEmail } from "@/lib/demo";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants, users, workspaceMembers } from "@/db/schema";
import { getClientIp, verifyPassword } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ApiError,
  attachSessionCookie,
  createSession,
  handleApiError,
} from "@/lib/auth";
import { readJson } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";

const credentials = z
  .object({
    email: z.string().trim().email().max(150),
    password: z.string().min(1).max(128),
  })
  .strict();
// A fixed non-account bcrypt digest equalizes work for unknown identities.
const dummy = "$2b$10$8cO50hW8FebTDmTNQ7bcsOihfF6cgT7t0G1GUly8pH8eB1nyW79d.";
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`login-ip:${ip}`, 60, 60_000)).allowed)
      throw new ApiError(429, "Too many attempts. Try again later.");
    const { email: input, password } = credentials.parse(
      await readJson(request),
    );
    const email = input.toLowerCase();
    if (!(await checkRateLimit(`login-account:${email}`, 10, 300_000)).allowed)
      throw new ApiError(429, "Too many attempts. Try again later.");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const valid = await verifyPassword(password, user?.passwordHash || dummy);
    if (!valid || !user || isReservedDemoEmail(email))
      throw new ApiError(401, "Invalid email or password.");
    const [primary] = await db
      .select({
        tenantId: tenants.id,
        role: workspaceMembers.role,
        name: tenants.name,
      })
      .from(workspaceMembers)
      .innerJoin(tenants, eq(workspaceMembers.tenantId, tenants.id))
      .where(
        and(
          eq(workspaceMembers.userId, user.id),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .orderBy(workspaceMembers.id)
      .limit(1);
    if (!primary) throw new ApiError(401, "Invalid email or password.");
    const session = await db.transaction(async (tx) => {
      // Serialize with password reset. A concurrent reset cannot leave a session authenticated with the old hash.
      const [current] = await tx
        .select({ hash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (current.hash !== user.passwordHash)
        throw new ApiError(401, "Invalid email or password.");
      await recordAuditLog(
        {
          tenantId: primary.tenantId,
          userId: user.id,
          actorName: user.fullName,
          action: "auth.login",
          module: "auth",
          entityType: "session",
          summary: "",
          ipAddress: ip,
        },
        tx,
      );
      return createSession(
        { userId: user.id, tenantId: primary.tenantId, request },
        tx,
      );
    });
    const response = NextResponse.json({
      user: {
        id: user.id,
        email,
        fullName: user.fullName,
        emailVerified: user.emailVerified,
      },
      tenantId: primary.tenantId,
      workspaceName: primary.name,
      role: primary.role,
      csrfToken: session.csrfToken,
    });
    attachSessionCookie(response, session.rawToken, session.expiresAt, request);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
