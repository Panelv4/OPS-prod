import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tenants, customers } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
const row = z
  .object({
    name: z.string().trim().min(2).max(120),
    company: z.string().trim().min(1).max(160),
    email: z
      .string()
      .trim()
      .email()
      .max(150)
      .transform((s) => s.toLowerCase()),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const { csv, confirm } = z
      .object({
        csv: z.string().min(1).max(64000),
        confirm: z.boolean().default(false),
      })
      .parse(await readJson(request));
    let raw: unknown;
    try {
      raw = parse(csv, {
        columns: true,
        trim: true,
        skip_empty_lines: true,
        bom: true,
        max_record_size: 1024,
      });
    } catch {
      throw new ApiError(
        400,
        "Invalid CSV. Use the header name,company,email and quote fields containing commas.",
      );
    }
    const rows = z.array(row).min(1).max(200).parse(raw);
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .for("update");
      const existing = await tx
        .select({ email: customers.email })
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, ctx.tenantId),
            inArray(
              customers.email,
              rows.map((r) => r.email),
            ),
          ),
        );
      const seen = new Set(existing.map((r) => r.email));
      const add = rows.filter((r) => {
        if (seen.has(r.email)) return false;
        seen.add(r.email);
        return true;
      });
      if (confirm && add.length) {
        await tx
          .insert(customers)
          .values(add.map((r) => ({ ...r, tenantId: ctx.tenantId })));
        await recordAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "customer.imported",
            module: "crm",
            entityType: "customer",
            summary: "",
          },
          tx,
        );
      }
      return NextResponse.json({
        confirmed: confirm,
        add: add.length,
        skipped: rows.length - add.length,
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
