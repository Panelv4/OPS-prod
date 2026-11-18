import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customerCommunications,
  tenants,
  customers,
  invoices,
} from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { sanitizeText } from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:view");
    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");

    // Single customer detail with purchase & communication history
    if (idParam) {
      const customerId = Number(idParam);
      if (!Number.isInteger(customerId) || customerId <= 0) {
        throw new ApiError(400, "Invalid customer ID.");
      }
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!customer) {
        throw new ApiError(404, "Customer not found in this workspace.");
      }

      const [purchases, communications] = await Promise.all([
        ctx.permissions.has("sales:view")
          ? db
              .select()
              .from(invoices)
              .where(
                and(
                  eq(invoices.tenantId, ctx.tenantId),
                  eq(invoices.customerId, customerId),
                ),
              )
              .orderBy(desc(invoices.createdAt))
          : [],
        db
          .select()
          .from(customerCommunications)
          .where(
            and(
              eq(customerCommunications.tenantId, ctx.tenantId),
              eq(customerCommunications.customerId, customerId),
            ),
          )
          .orderBy(desc(customerCommunications.createdAt)),
      ]);

      return NextResponse.json({ customer, purchases, communications });
    }

    // List with search, filter, sorting
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const typeFilter = url.searchParams.get("type") || "all";
    const sort = url.searchParams.get("sort") || "newest";

    const orderByClause =
      sort === "name"
        ? asc(customers.name)
        : sort === "spend"
          ? desc(customers.totalSpentCents)
          : desc(customers.createdAt);

    let rows = await db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, ctx.tenantId))
      .orderBy(orderByClause);

    if (typeFilter !== "all") {
      rows = rows.filter((c) => c.customerType === typeFilter);
    }
    if (search) {
      rows = rows.filter(
        (c) =>
          c.name.toLowerCase().includes(search) ||
          c.company.toLowerCase().includes(search) ||
          c.email.toLowerCase().includes(search) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(search)),
      );
    }

    return NextResponse.json({ customers: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

const createCustomerSchema = z.object({
  name: z.string().min(2).max(120),
  company: z.string().min(1).max(140),
  email: z.string().email().max(150),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  customerType: z
    .enum(["business", "enterprise", "smb", "individual"])
    .default("business"),
  tags: z.array(z.string().max(30)).max(10).default([]),
  notes: z.string().max(1000).optional(),
  assignedName: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const body = createCustomerSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .for("update");
      const [created] = await tx
        .insert(customers)
        .values({
          tenantId: ctx.tenantId,
          name: sanitizeText(body.name),
          company: sanitizeText(body.company),
          email: body.email.trim().toLowerCase(),
          phone: body.phone ? sanitizeText(body.phone) : null,
          address: body.address ? sanitizeText(body.address) : null,
          customerType: body.customerType,
          tags: body.tags.map((t) => sanitizeText(t)).filter(Boolean),
          notes: body.notes ? sanitizeText(body.notes) : null,
          assignedUserId: ctx.user.id,
          assignedName: body.assignedName
            ? sanitizeText(body.assignedName)
            : ctx.user.fullName,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "customer.created",
          module: "crm",
          entityType: "customer",
          entityId: created.id,
          summary: `Created customer ${created.name} (${created.company})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ customer: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchCustomerSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["update", "add_communication"]).default("update"),
  name: z.string().min(2).max(120).optional(),
  company: z.string().min(1).max(140).optional(),
  email: z.string().email().max(150).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  customerType: z
    .enum(["business", "enterprise", "smb", "individual"])
    .optional(),
  tags: z.array(z.string().max(30)).optional(),
  notes: z.string().max(1000).optional(),
  assignedName: z.string().max(100).optional(),
  channel: z.enum(["email", "call", "meeting", "note", "whatsapp"]).optional(),
  subject: z.string().min(1).max(160).optional(),
  content: z.string().min(1).max(2000).optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const body = patchCustomerSchema.parse(await readJson(request));

    const [existing] = await db
      .select()
      .from(customers)
      .where(
        and(eq(customers.id, body.id), eq(customers.tenantId, ctx.tenantId)),
      )
      .limit(1);
    if (!existing) {
      throw new ApiError(404, "Customer not found in this workspace.");
    }

    if (body.action === "add_communication") {
      if (!body.subject || !body.content) {
        throw new ApiError(400, "Subject and content are required.");
      }
      const [comm] = await db
        .insert(customerCommunications)
        .values({
          tenantId: ctx.tenantId,
          customerId: existing.id,
          userId: ctx.user.id,
          authorName: ctx.user.fullName,
          channel: body.channel || "note",
          subject: sanitizeText(body.subject),
          content: sanitizeText(body.content),
        })
        .returning();
      return NextResponse.json({ communication: comm }, { status: 201 });
    }

    const updates: Partial<typeof customers.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name) updates.name = sanitizeText(body.name);
    if (body.company) updates.company = sanitizeText(body.company);
    if (body.email) updates.email = body.email.trim().toLowerCase();
    if (body.phone !== undefined) updates.phone = sanitizeText(body.phone);
    if (body.address !== undefined)
      updates.address = sanitizeText(body.address);
    if (body.customerType) updates.customerType = body.customerType;
    if (body.tags)
      updates.tags = body.tags.map((t) => sanitizeText(t)).filter(Boolean);
    if (body.notes !== undefined) updates.notes = sanitizeText(body.notes);
    if (body.assignedName !== undefined)
      updates.assignedName = sanitizeText(body.assignedName);

    const [updated] = await db
      .update(customers)
      .set(updates)
      .where(
        and(
          eq(customers.id, existing.id),
          eq(customers.tenantId, ctx.tenantId),
        ),
      )
      .returning();

    return NextResponse.json({ customer: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:delete");
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "Valid customer id is required.");
    }

    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, "Customer not found in this workspace.");
    }

    await db
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)));

    await recordAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      actorName: ctx.user.fullName,
      action: "customer.deleted",
      module: "crm",
      entityType: "customer",
      entityId: id,
      summary: `Removed customer ${existing.name} (${existing.company})`,
      ipAddress: ctx.ipAddress,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
