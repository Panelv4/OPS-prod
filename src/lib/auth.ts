import { isReservedDemoEmail } from "./demo";
import { checkRateLimit } from "./rate-limit";
import { effectivePlan } from "./plans";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { ApiError } from "./http";
import { ZodError } from "zod";
export { ApiError } from "./http";
import { db, type Database } from "@/db";
import {
  sessions,
  tenants,
  users,
  workspaceMembers,
  type WorkspaceRole,
} from "@/db/schema";
import {
  generateSecureToken,
  getClientIp,
  sha256,
  verifyCsrf,
} from "@/lib/security";
import {
  hasPermission,
  resolveUserPermissions,
  type Permission,
} from "@/lib/permissions";
import { trackTenantApiCall } from "@/lib/audit";

export const SESSION_COOKIE_NAME = "opspilot_session";
const SESSION_TTL_DAYS = 14;

export interface AuthContext {
  user: {
    id: number;
    email: string;
    fullName: string;
    phone: string | null;
    emailVerified: boolean;
    notificationPrefs: typeof users.$inferSelect.notificationPrefs;
  };
  tenant: typeof tenants.$inferSelect;
  tenantId: number;
  role: WorkspaceRole;
  permissions: Set<string>;
  sessionId: number;
  csrfToken: string;
  ipAddress: string;
}

function parseSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      if (key === SESSION_COOKIE_NAME) {
        const val = pair.slice(idx + 1).trim();
        if (/^[a-f0-9]{64}$/.test(val)) return val;
      }
    }
  }
  return null;
}

export async function createSession(
  params: {
    userId: number;
    tenantId: number;
    request: Request;
  },
  store: Database = db,
): Promise<{ rawToken: string; csrfToken: string; expiresAt: Date }> {
  const rawToken = generateSecureToken(32);
  const tokenHash = sha256(rawToken);
  const csrfToken = generateSecureToken(24);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await store.insert(sessions).values({
    userId: params.userId,
    activeTenantId: params.tenantId,
    tokenHash,
    csrfToken,
    ipAddress: getClientIp(params.request),
    userAgent: (params.request.headers.get("user-agent") || "").slice(0, 250),
    expiresAt,
  });

  await store
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, params.userId));

  return { rawToken, csrfToken, expiresAt };
}

export function attachSessionCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
  request?: Request,
): void {
  const isHttps =
    process.env.NODE_ENV === "production" ||
    request?.url.startsWith("https://") === true;

  response.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(
  response: NextResponse,
  request?: Request,
): void {
  const isHttps =
    process.env.NODE_ENV === "production" ||
    request?.url.startsWith("https://") === true;

  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 0,
  });
}

export async function getAuthContext(
  request?: Request,
): Promise<AuthContext | null> {
  let rawToken: string | null = null;
  if (request) {
    rawToken = parseSessionTokenFromRequest(request);
  } else {
    const store = await cookies();
    rawToken = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  }
  if (!rawToken) return null;

  const tokenHash = sha256(rawToken);
  const now = new Date();

  const [sessionRow] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!sessionRow) return null;

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, sessionRow.userId))
    .limit(1);
  if (!userRow || isReservedDemoEmail(userRow.email)) return null;

  const [memberRow] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.tenantId, sessionRow.activeTenantId),
        eq(workspaceMembers.userId, userRow.id),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!memberRow) return null;

  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, sessionRow.activeTenantId))
    .limit(1);
  if (!tenantRow) return null;

  const permissions = resolveUserPermissions({
    role: memberRow.role,
    tenantRolePermissions: tenantRow.rolePermissions,
    customPermissions: memberRow.customPermissions,
  });

  const plan = effectivePlan(tenantRow);
  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      fullName: userRow.fullName,
      phone: userRow.phone,
      emailVerified: userRow.emailVerified,
      notificationPrefs: userRow.notificationPrefs,
    },
    tenant: {
      ...tenantRow,
      plan: plan.id,
      aiTokenLimit: plan.aiTokenLimit,
      aiTokensUsed:
        tenantRow.aiUsageMonth === new Date().toISOString().slice(0, 7)
          ? tenantRow.aiTokensUsed
          : 0,
    },
    tenantId: tenantRow.id,
    role: memberRow.role,
    permissions,
    sessionId: sessionRow.id,
    csrfToken: sessionRow.csrfToken,
    ipAddress: request ? getClientIp(request) : "127.0.0.1",
  };
}

export async function requireAuth(
  request: Request,
  requiredPermission?: Permission,
): Promise<AuthContext> {
  const ctx = await getAuthContext(request);
  if (!ctx) {
    throw new ApiError(401, "Authentication required. Please sign in.");
  }

  if (!verifyCsrf(request, ctx.csrfToken)) {
    throw new ApiError(403, "Invalid or missing CSRF verification token.");
  }

  if (
    !ctx.user.emailVerified &&
    !["/api/auth/me", "/api/auth/logout"].includes(
      new URL(request.url).pathname,
    )
  )
    throw new ApiError(
      403,
      "Verify your email before accessing workspace data.",
    );

  if (
    requiredPermission &&
    !hasPermission(ctx.permissions, requiredPermission)
  ) {
    throw new ApiError(
      403,
      `Access denied: your role (${ctx.role}) does not have '${requiredPermission}' permission.`,
    );
  }

  if (
    !(await checkRateLimit(`api:${ctx.tenantId}:${ctx.user.id}`, 360, 60_000))
      .allowed
  )
    throw new ApiError(
      429,
      "Too many workspace requests. Please wait a minute.",
    );
  // Non-blocking tenant usage telemetry
  trackTenantApiCall(
    ctx.tenantId,
    new URL(request.url).pathname.split("/")[2],
  ).catch(() => undefined);

  return ctx;
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return NextResponse.json(
      { error: `${first.path.join(".") || "Request"}: ${first.message}` },
      { status: 400 },
    );
  }
  // Do not reflect SQL, bound parameters, provider errors, or stack traces.
  const e = error as { code?: string; cause?: { code?: string } } | null;
  const code = e?.cause?.code || e?.code;
  if (code === "23505")
    return NextResponse.json(
      { error: "Record already exists." },
      { status: 409 },
    );
  if (code === "23503")
    return NextResponse.json(
      { error: "Related record unavailable in this workspace." },
      { status: 400 },
    );
  return NextResponse.json(
    { error: "An unexpected server error occurred." },
    { status: 500 },
  );
}
