import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowExecutions, workflows } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import {
  buildWorkflowDraftFromPrompt,
  runScheduledSweep,
  WORKFLOW_TRIGGERS,
} from "@/lib/automation";
import { sanitizeText } from "@/lib/security";
import { checkCapacity } from "@/lib/entitlements";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "automation:view");
    const tId = ctx.tenantId;

    const [wfRows, execRows] = await Promise.all([
      db
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, tId))
        .orderBy(desc(workflows.createdAt)),
      db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.tenantId, tId))
        .orderBy(desc(workflowExecutions.startedAt))
        .limit(40),
    ]);

    return NextResponse.json({
      triggers: WORKFLOW_TRIGGERS,
      canWrite: ctx.permissions.has("automation:write"),
      canApprove: ctx.permissions.has("automation:approve"),
      workflows: wfRows,
      executions: execRows.map(({ triggerPayload, ...summary }) => summary),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createWfSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("natural_language"),
    prompt: z.string().min(8).max(800),
  }),
  z.object({
    mode: z.literal("visual"),
    name: z.string().min(2).max(140),
    description: z.string().max(500).optional(),
    triggerEvent: z.enum([
      "lead.created",
      "invoice.overdue",
      "invoice.paid",
      "stock.low",
      "leave.requested",
      "task.overdue",
      "po.pending_approval",
      "schedule.daily",
    ]),
    scheduleExpression: z.literal("daily-utc").optional(),
    retryLimit: z.number().int().min(0).max(5).default(2),
    conditions: z
      .array(
        z.object({
          field: z.string().min(1).max(60),
          operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
          value: z.union([z.string(), z.number()]),
        }),
      )
      .default([]),
    actions: z
      .array(
        z.object({
          type: z.enum([
            "notify",
            "create_task",
            "send_invoice_reminder",
            "delay",
            "require_approval",
            "log_audit",
          ]),
          targetRole: z.string().max(40).optional(),
          title: z.string().max(160).optional(),
          message: z.string().max(400).optional(),
          priority: z.string().max(20).optional(),
          delayMinutes: z.number().int().min(1).max(10080).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "automation:write");
    const body = createWfSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      await checkCapacity(tx, tId, "workflow");
      if (body.mode === "natural_language") {
        const draft = buildWorkflowDraftFromPrompt(body.prompt);
        const [created] = await tx
          .insert(workflows)
          .values({
            tenantId: tId,
            name: draft.name,
            description: draft.description,
            triggerEvent: draft.triggerEvent,
            scheduleExpression: draft.scheduleExpression,
            conditions: draft.conditions,
            actions: draft.actions,
            approvalStatus: "pending_approval",
            isEnabled: false,
            generatedByAi: true,
            retryLimit: 2,
            createdByUserId: ctx.user.id,
          })
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "workflow.ai_drafted",
            module: "automation",
            entityType: "workflow",
            entityId: created.id,
            summary: `AI generated workflow draft "${created.name}" (requires approval)`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ workflow: created }, { status: 201 });
      }

      const [created] = await tx
        .insert(workflows)
        .values({
          tenantId: tId,
          name: sanitizeText(body.name),
          description: body.description ? sanitizeText(body.description) : null,
          triggerEvent: body.triggerEvent,
          scheduleExpression: body.scheduleExpression || null,
          conditions: body.conditions,
          actions: body.actions,
          approvalStatus: "pending_approval",
          isEnabled: false,
          generatedByAi: false,
          retryLimit: body.retryLimit,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "workflow.created",
          module: "automation",
          entityType: "workflow",
          entityId: created.id,
          summary: `Created workflow "${created.name}" in pending approval state`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ workflow: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchWfSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    id: z.number().int().positive(),
    enableImmediately: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("toggle"),
    id: z.number().int().positive(),
    isEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal("test_run"),
    id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("approve_execution"),
    executionId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("run_scheduled_sweep"),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "automation:write");
    const body = patchWfSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    if (body.action === "run_scheduled_sweep") {
      const summary = await runScheduledSweep(tId, ctx.user.id);
      return NextResponse.json({ summary });
    }

    if (body.action === "approve_execution") {
      if (!ctx.permissions.has("automation:approve")) {
        throw new ApiError(403, "Missing automation:approve permission.");
      }
      const [exec] = await db
        .select()
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.id, body.executionId),
            eq(workflowExecutions.tenantId, tId),
          ),
        )
        .limit(1);
      if (!exec) throw new ApiError(404, "Execution record not found.");

      const logs = [
        ...(exec.stepLogs || []),
        {
          step: "Human Approval",
          status: "completed",
          detail: `Approved by ${ctx.user.fullName}`,
          at: new Date().toISOString(),
        },
      ];
      const [updated] = await db
        .update(workflowExecutions)
        .set({
          status: "queued",
          stepLogs: logs,
          runAfter: new Date(),
        })
        .where(
          and(
            eq(workflowExecutions.id, exec.id),
            eq(workflowExecutions.tenantId, tId),
            eq(workflowExecutions.status, "awaiting_approval"),
          ),
        )
        .returning();

      if (!updated)
        throw new ApiError(409, "Execution is not awaiting approval.");
      return NextResponse.json({
        execution: { id: updated.id, status: updated.status },
      });
    }

    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, body.id), eq(workflows.tenantId, tId)))
      .limit(1);
    if (!wf) throw new ApiError(404, "Workflow not found in workspace.");

    if (body.action === "approve") {
      if (!ctx.permissions.has("automation:approve")) {
        throw new ApiError(403, "Missing automation:approve permission.");
      }
      const [updated] = await db
        .update(workflows)
        .set({
          approvalStatus: "approved",
          approvedByName: ctx.user.fullName,
          isEnabled: body.enableImmediately,
          updatedAt: new Date(),
        })
        .where(and(eq(workflows.id, wf.id), eq(workflows.tenantId, tId)))
        .returning();

      await recordAuditLog({
        tenantId: tId,
        userId: ctx.user.id,
        actorName: ctx.user.fullName,
        action: "workflow.approved",
        module: "automation",
        entityType: "workflow",
        entityId: wf.id,
        summary: `Approved workflow "${wf.name}" (active: ${updated.isEnabled})`,
        ipAddress: ctx.ipAddress,
      });

      return NextResponse.json({ workflow: updated });
    }

    if (body.action === "toggle") {
      if (body.isEnabled && wf.approvalStatus !== "approved") {
        throw new ApiError(
          400,
          "Workflow must be approved before it can be activated.",
        );
      }
      const [updated] = await db
        .update(workflows)
        .set({ isEnabled: body.isEnabled, updatedAt: new Date() })
        .where(and(eq(workflows.id, wf.id), eq(workflows.tenantId, tId)))
        .returning();
      return NextResponse.json({ workflow: updated });
    }

    // A preview must never dispatch jobs, send mail or mutate real customer data.
    return NextResponse.json({
      preview: {
        trigger: wf.triggerEvent,
        steps: wf.actions.map((a) => a.type),
        enqueued: false,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "automation:write");
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "Valid workflow id required.");
    }
    await db
      .delete(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
