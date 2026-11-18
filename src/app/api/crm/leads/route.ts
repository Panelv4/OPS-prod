import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, leads } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { sanitizeText } from "@/lib/security";
import { toCents } from "@/lib/finance";
import { recordAuditLog } from "@/lib/audit";
import { dispatchWorkflowEvent } from "@/lib/automation";

const stageEnum = z.enum([
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:view");
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const priority = url.searchParams.get("priority") || "all";
    const stage = url.searchParams.get("stage") || "all";

    let rows = await db
      .select()
      .from(leads)
      .where(eq(leads.tenantId, ctx.tenantId))
      .orderBy(desc(leads.updatedAt));

    const totalPipelineCents = rows
      .filter((l) => l.stage !== "won" && l.stage !== "lost")
      .reduce((s, l) => s + l.estimatedValueCents, 0);
    const wonValueCents = rows
      .filter((l) => l.stage === "won")
      .reduce((s, l) => s + l.estimatedValueCents, 0);
    const wonCount = rows.filter((l) => l.stage === "won").length;
    const winRatePct =
      rows.length > 0 ? Math.round((wonCount / rows.length) * 100) : 0;

    const upcomingHorizon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const followUpDueCount = rows.filter(
      (l) =>
        l.stage !== "won" &&
        l.stage !== "lost" &&
        l.followUpDate &&
        l.followUpDate <= upcomingHorizon,
    ).length;

    if (priority !== "all") {
      rows = rows.filter((l) => l.priority === priority);
    }
    if (stage !== "all") {
      rows = rows.filter((l) => l.stage === stage);
    }
    if (search) {
      rows = rows.filter(
        (l) =>
          l.title.toLowerCase().includes(search) ||
          l.company.toLowerCase().includes(search) ||
          l.contactName.toLowerCase().includes(search),
      );
    }

    return NextResponse.json({
      leads: rows,
      analytics: {
        totalLeads: rows.length,
        totalPipelineCents,
        wonValueCents,
        winRatePct,
        followUpDueCount,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createLeadSchema = z.object({
  title: z.string().min(2).max(160),
  contactName: z.string().min(2).max(120),
  company: z.string().min(1).max(140),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  source: z.string().max(60).default("Website"),
  estimatedValue: z.number().min(0).default(0),
  estimatedValueCents: z.number().int().min(0).optional(),
  priority: priorityEnum.default("medium"),
  stage: stageEnum.default("new"),
  assignedName: z.string().max(100).optional(),
  followUpDate: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const body = createLeadSchema.parse(await readJson(request));

    const valueCents =
      body.estimatedValueCents !== undefined
        ? body.estimatedValueCents
        : toCents(body.estimatedValue);

    const assignedName = body.assignedName
      ? sanitizeText(body.assignedName)
      : ctx.user.fullName;

    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(leads)
        .values({
          tenantId: ctx.tenantId,
          title: sanitizeText(body.title),
          contactName: sanitizeText(body.contactName),
          company: sanitizeText(body.company),
          email: body.email ? body.email.trim().toLowerCase() : null,
          phone: body.phone ? sanitizeText(body.phone) : null,
          source: sanitizeText(body.source),
          estimatedValueCents: valueCents,
          priority: body.priority,
          stage: body.stage,
          assignedUserId: ctx.user.id,
          assignedName,
          followUpDate: body.followUpDate || null,
          notes: body.notes ? sanitizeText(body.notes) : null,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "lead.created",
          module: "crm",
          entityType: "lead",
          entityId: created.id,
          summary: `Created lead "${created.title}" (${created.company})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      // Fire workflow automation engine on lead.created
      await dispatchWorkflowEvent(
        {
          tenantId: ctx.tenantId,
          triggerEvent: "lead.created",
          eventKey: `lead:${created.id}`,
          payload: {
            leadId: created.id,
            title: created.title,
            company: created.company,
            contactName: created.contactName,
            priority: created.priority,
            estimatedValueCents: created.estimatedValueCents,
            assignedName,
            link: "/app/crm",
          },
          userId: ctx.user.id,
        },
        tx,
      );

      return NextResponse.json({ lead: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchLeadSchema = z.object({
  id: z.number().int().positive(),
  stage: stageEnum.optional(),
  priority: priorityEnum.optional(),
  title: z.string().min(2).max(160).optional(),
  estimatedValue: z.number().min(0).optional(),
  followUpDate: z.string().max(20).optional(),
  assignedName: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  convertToCustomer: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const body = patchLeadSchema.parse(await readJson(request));

    const [existing] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, body.id), eq(leads.tenantId, ctx.tenantId)))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, "Lead not found in this workspace.");
    }

    const updates: Partial<typeof leads.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.stage) updates.stage = body.stage;
    if (body.priority) updates.priority = body.priority;
    if (body.title) updates.title = sanitizeText(body.title);
    if (body.estimatedValue !== undefined) {
      updates.estimatedValueCents = toCents(body.estimatedValue);
    }
    if (body.followUpDate !== undefined)
      updates.followUpDate = body.followUpDate || null;
    if (body.assignedName !== undefined)
      updates.assignedName = sanitizeText(body.assignedName);
    if (body.notes !== undefined) updates.notes = sanitizeText(body.notes);

    let convertedCustomer = null;
    if (body.convertToCustomer && !existing.customerId) {
      const [cust] = await db
        .insert(customers)
        .values({
          tenantId: ctx.tenantId,
          name: existing.contactName,
          company: existing.company,
          email:
            existing.email ||
            `${existing.contactName.toLowerCase().replace(/[^a-z0-9]/g, "")}@${existing.company
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "")}.com`,
          phone: existing.phone,
          customerType: "business",
          tags: ["Converted Lead"],
          notes: existing.notes,
          assignedUserId: ctx.user.id,
          assignedName: existing.assignedName || ctx.user.fullName,
        })
        .returning();
      updates.customerId = cust.id;
      updates.stage = "won";
      convertedCustomer = cust;
    }

    const [updated] = await db
      .update(leads)
      .set(updates)
      .where(and(eq(leads.id, existing.id), eq(leads.tenantId, ctx.tenantId)))
      .returning();

    return NextResponse.json({ lead: updated, convertedCustomer });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "crm:write");
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "Valid lead id required.");
    }
    await db
      .delete(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, ctx.tenantId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
