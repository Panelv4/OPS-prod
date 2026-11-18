import { projectTime, documents, invoices, transactions } from "@/db/schema";
import { sum, sql, ne, isNotNull } from "drizzle-orm";
import { canAccessDocument } from "@/lib/permissions";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, projects, taskComments, tasks } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { toCents } from "@/lib/finance";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { createNotification, recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "projects:view");
    const tId = ctx.tenantId;
    const url = new URL(request.url);
    const taskIdParam = url.searchParams.get("taskId");

    if (taskIdParam) {
      const taskId = Number(taskIdParam);
      const comments = await db
        .select()
        .from(taskComments)
        .where(
          and(eq(taskComments.tenantId, tId), eq(taskComments.taskId, taskId)),
        )
        .orderBy(desc(taskComments.createdAt));
      return NextResponse.json({ comments });
    }

    const [projRows, taskRows, custRows, timeRows, billed, cash] =
      await Promise.all([
        db
          .select()
          .from(projects)
          .where(eq(projects.tenantId, tId))
          .orderBy(desc(projects.createdAt)),
        db
          .select()
          .from(tasks)
          .where(eq(tasks.tenantId, tId))
          .orderBy(desc(tasks.createdAt)),
        ctx.permissions.has("crm:view")
          ? db
              .select({ id: customers.id, company: customers.company })
              .from(customers)
              .where(eq(customers.tenantId, tId))
          : [],
        db
          .select({
            id: projectTime.projectId,
            minutes: sum(projectTime.minutes),
          })
          .from(projectTime)
          .where(eq(projectTime.tenantId, tId))
          .groupBy(projectTime.projectId),
        ctx.permissions.has("sales:view")
          ? db
              .select({
                id: invoices.projectId,
                amount: sum(invoices.totalCents),
                due: sum(invoices.balanceCents),
              })
              .from(invoices)
              .where(
                and(
                  eq(invoices.tenantId, tId),
                  isNotNull(invoices.projectId),
                  eq(invoices.docType, "invoice"),
                  ne(invoices.status, "cancelled"),
                ),
              )
              .groupBy(invoices.projectId)
          : [],
        ctx.permissions.has("finance:view")
          ? db
              .select({
                id: transactions.projectId,
                net: sql<string>`sum(case when ${transactions.direction}='credit' then ${transactions.amountCents} else -${transactions.amountCents} end)`,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.tenantId, tId),
                  isNotNull(transactions.projectId),
                  eq(transactions.status, "posted"),
                ),
              )
              .groupBy(transactions.projectId)
          : [],
      ]);

    const custMap = new Map(custRows.map((c) => [c.id, c.company]));
    const projMap = new Map(projRows.map((p) => [p.id, p.name]));

    const enrichedProjects = projRows.map((p) => {
      const pTasks = taskRows.filter((t) => t.projectId === p.id);
      const doneCount = pTasks.filter((t) => t.status === "done").length;
      return {
        ...p,
        clientCompany: p.customerId ? custMap.get(p.customerId) || null : null,
        billedCents: ctx.permissions.has("sales:view")
          ? Number(billed.find((row) => row.id === p.id)?.amount || 0)
          : null,
        dueCents: ctx.permissions.has("sales:view")
          ? Number(billed.find((row) => row.id === p.id)?.due || 0)
          : null,
        netCashCents: ctx.permissions.has("finance:view")
          ? Number(cash.find((row) => row.id === p.id)?.net || 0)
          : null,
        loggedMinutes: Number(
          timeRows.find((t) => t.id === p.id)?.minutes || 0,
        ),
        totalTasks: pTasks.length,
        completedTasks: doneCount,
        progressPct:
          pTasks.length > 0 ? Math.round((doneCount / pTasks.length) * 100) : 0,
      };
    });

    const enrichedTasks = taskRows.map((t) => ({
      ...t,
      projectName: t.projectId
        ? projMap.get(t.projectId) || null
        : "General Workspace",
    }));

    return NextResponse.json({
      currency: ctx.tenant.currency,
      projects: enrichedProjects,
      tasks: enrichedTasks,
      clients: custRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const postProjectSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("log_time"),
    projectId: z.number().int().positive(),
    minutes: z.number().int().min(1).max(1440),
    workDate: z.iso.date(),
  }),
  z.object({
    action: z.literal("create_project"),
    name: z.string().min(2).max(160),
    description: z.string().max(1000).optional(),
    customerId: z.number().int().positive().nullable().optional(),
    budget: z.number().min(0).default(0),
    status: z
      .enum(["planning", "active", "delayed", "on_hold", "completed"])
      .default("active"),
    startDate: z.string().optional(),
    deadline: z.string().min(8),
    teamMembers: z.array(z.string().max(80)).default([]),
  }),
  z.object({
    action: z.literal("create_task"),
    projectId: z.number().int().positive().nullable().optional(),
    title: z.string().min(2).max(200),
    description: z.string().max(1000).optional(),
    assigneeName: z.string().max(100).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    status: z.enum(["todo", "in_progress", "review", "done"]).default("todo"),
    dueDate: z.string().optional(),
    attachmentDocumentId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    action: z.literal("add_comment"),
    taskId: z.number().int().positive(),
    content: z.string().min(1).max(1500),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "projects:write");
    const body = postProjectSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      if (body.action === "log_time") {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(eq(projects.id, body.projectId), eq(projects.tenantId, tId)),
          );
        if (!project) throw new ApiError(404, "Project not found.");
        const [entry] = await tx
          .insert(projectTime)
          .values({
            tenantId: tId,
            userId: ctx.user.id,
            projectId: project.id,
            minutes: body.minutes,
            workDate: body.workDate,
          })
          .returning({ id: projectTime.id });
        return NextResponse.json({ entry }, { status: 201 });
      }
      if (body.action === "create_project") {
        const code = `PRJ-${generateSecureToken(2).toUpperCase()}`;
        const [proj] = await tx
          .insert(projects)
          .values({
            tenantId: tId,
            customerId: body.customerId ?? null,
            code,
            name: sanitizeText(body.name),
            description: body.description
              ? sanitizeText(body.description)
              : null,
            budgetCents: toCents(body.budget),
            spentCents: 0,
            status: body.status,
            startDate: body.startDate || new Date().toISOString().slice(0, 10),
            deadline: body.deadline,
            teamMembers: body.teamMembers
              .map((m) => sanitizeText(m))
              .filter(Boolean),
            ownerName: ctx.user.fullName,
          })
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "project.created",
            module: "projects",
            entityType: "project",
            entityId: proj.id,
            summary: `Created project ${proj.code}: ${proj.name}`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ project: proj }, { status: 201 });
      }

      if (body.action === "create_task") {
        if (body.attachmentDocumentId) {
          const [doc] = await tx
            .select({ visibility: documents.visibility })
            .from(documents)
            .where(
              and(
                eq(documents.tenantId, tId),
                eq(documents.id, body.attachmentDocumentId),
              ),
            );
          if (
            !doc ||
            !ctx.permissions.has("documents:view") ||
            !canAccessDocument(doc.visibility, ctx.role, ctx.permissions)
          )
            throw new ApiError(404, "Document unavailable.");
        }
        if (body.projectId) {
          const [p] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(eq(projects.id, body.projectId), eq(projects.tenantId, tId)),
            )
            .limit(1);
          if (!p) throw new ApiError(404, "Project not found in workspace.");
        }

        const assigneeName = body.assigneeName
          ? sanitizeText(body.assigneeName)
          : ctx.user.fullName;

        const [task] = await tx
          .insert(tasks)
          .values({
            tenantId: tId,
            projectId: body.projectId ?? null,
            title: sanitizeText(body.title),
            description: body.description
              ? sanitizeText(body.description)
              : null,
            assigneeName,
            priority: body.priority,
            status: body.status,
            dueDate: body.dueDate || null,
            attachmentDocumentId: body.attachmentDocumentId ?? null,
            createdByUserId: ctx.user.id,
          })
          .returning();

        await createNotification(
          {
            tenantId: tId,
            title: `Task Assigned: ${task.title}`,
            message: `Assigned to ${assigneeName} (${task.priority} priority).`,
            type: "info",
            link: "/app/projects",
          },
          tx,
        );

        return NextResponse.json({ task }, { status: 201 });
      }

      // add_comment
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, body.taskId), eq(tasks.tenantId, tId)))
        .limit(1);
      if (!task) throw new ApiError(404, "Task not found in workspace.");

      const [comment] = await tx
        .insert(taskComments)
        .values({
          tenantId: tId,
          taskId: task.id,
          userId: ctx.user.id,
          authorName: ctx.user.fullName,
          content: sanitizeText(body.content),
        })
        .returning();

      return NextResponse.json({ comment }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchProjectSchema = z.discriminatedUnion("entity", [
  z.object({
    entity: z.literal("task"),
    id: z.number().int().positive(),
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    assigneeName: z.string().max(100).optional(),
    dueDate: z.string().optional(),
  }),
  z.object({
    entity: z.literal("project"),
    id: z.number().int().positive(),
    status: z
      .enum(["planning", "active", "delayed", "on_hold", "completed"])
      .optional(),
    spent: z.number().min(0).optional(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "projects:write");
    const body = patchProjectSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    if (body.entity === "task") {
      const updates: Partial<typeof tasks.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.status) updates.status = body.status;
      if (body.priority) updates.priority = body.priority;
      if (body.assigneeName !== undefined) {
        updates.assigneeName = sanitizeText(body.assigneeName);
      }
      if (body.dueDate !== undefined) updates.dueDate = body.dueDate || null;

      const [updated] = await db
        .update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, body.id), eq(tasks.tenantId, tId)))
        .returning();
      if (!updated) throw new ApiError(404, "Task not found in workspace.");
      return NextResponse.json({ task: updated });
    }

    const updates: Partial<typeof projects.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.status) updates.status = body.status;
    if (body.spent !== undefined) updates.spentCents = toCents(body.spent);

    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, body.id), eq(projects.tenantId, tId)))
      .returning();
    if (!updated) throw new ApiError(404, "Project not found in workspace.");
    return NextResponse.json({ project: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "projects:write");
    const url = new URL(request.url);
    const taskId = Number(url.searchParams.get("taskId"));
    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new ApiError(400, "Valid taskId required.");
    }
    await db
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, ctx.tenantId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
