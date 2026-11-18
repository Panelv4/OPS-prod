import { and, eq, lt, lte, ne, sql, inArray } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  invoices,
  products,
  tasks,
  workflowExecutions,
  workflows,
  type WorkflowAction,
  type WorkflowCondition,
} from "@/db/schema";
import { createNotification, recordAuditLog } from "@/lib/audit";

export const WORKFLOW_TRIGGERS = [
  { id: "lead.created", label: "When a new lead is created" },
  { id: "invoice.overdue", label: "When an invoice becomes overdue" },
  { id: "invoice.paid", label: "When an invoice is paid in full" },
  {
    id: "stock.low",
    label: "When product stock falls below reorder threshold",
  },
  { id: "leave.requested", label: "When an employee submits a leave request" },
  { id: "task.overdue", label: "When a task passes its deadline" },
  {
    id: "po.pending_approval",
    label: "When a purchase order requires approval",
  },
  { id: "schedule.daily", label: "Scheduled daily business health sweep" },
] as const;

function evaluateCondition(
  cond: WorkflowCondition,
  payload: Record<string, unknown>,
): boolean {
  const actual = payload[cond.field];
  if (actual === undefined || actual === null) return false;
  switch (cond.operator) {
    case "eq":
      return String(actual).toLowerCase() === String(cond.value).toLowerCase();
    case "neq":
      return String(actual).toLowerCase() !== String(cond.value).toLowerCase();
    case "gt":
      return Number(actual) > Number(cond.value);
    case "lt":
      return Number(actual) < Number(cond.value);
    case "contains":
      return String(actual)
        .toLowerCase()
        .includes(String(cond.value).toLowerCase());
    default:
      return false;
  }
}

function interpolateTemplate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = payload[key];
    return val != null ? String(val) : key;
  });
}

async function executeSingleAction(
  params: {
    tenantId: number;
    workflowName: string;
    action: WorkflowAction;
    payload: Record<string, unknown>;
    userId?: number | null;
  },
  store: Database,
): Promise<{ status: string; detail: string; haltedForApproval?: boolean }> {
  const { tenantId, workflowName, action, payload, userId } = params;
  const title = interpolateTemplate(
    action.title || `Automation: ${workflowName}`,
    payload,
  );
  const message = interpolateTemplate(
    action.message || `Triggered by ${workflowName}`,
    payload,
  );

  switch (action.type) {
    case "notify": {
      await createNotification(
        {
          tenantId,
          targetRole: action.targetRole || null,
          title,
          message,
          type: "automation",
          link:
            typeof payload.link === "string"
              ? payload.link
              : "/app/automations",
        },
        store,
      );
      return {
        status: "completed",
        detail: `Sent in-app notification "${title}"${
          action.targetRole ? ` to role ${action.targetRole}` : ""
        }`,
      };
    }
    case "create_task": {
      const due = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await store.insert(tasks).values({
        tenantId,
        title,
        description: message,
        assigneeName:
          typeof payload.assignedName === "string"
            ? payload.assignedName
            : "Operations",
        priority: action.priority || "high",
        status: "todo",
        dueDate: due,
        createdByUserId: userId ?? null,
      });
      return {
        status: "completed",
        detail: `Created task "${title}" due ${due}`,
      };
    }
    case "send_invoice_reminder": {
      const invoiceId = Number(payload.invoiceId);
      if (Number.isInteger(invoiceId) && invoiceId > 0) {
        const [inv] = await store
          .select()
          .from(invoices)
          .where(
            and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)),
          )
          .limit(1);
        if (inv) {
          await store
            .update(invoices)
            .set({
              reminderCount: inv.reminderCount + 1,
              lastReminderAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(eq(invoices.id, inv.id), eq(invoices.tenantId, tenantId)),
            );
        }
      }
      await createNotification(
        {
          tenantId,
          targetRole: "accountant",
          title: title || "Overdue Invoice Reminder Dispatched",
          message,
          type: "warning",
          link: "/app/sales",
        },
        store,
      );
      return {
        status: "completed",
        detail: `Created overdue payment reminder (${message})`,
      };
    }
    case "delay": {
      const mins = action.delayMinutes ?? 15;
      return {
        status: "completed",
        detail: `Registered ${mins}-minute delay timer checkpoint before next step`,
      };
    }
    case "require_approval": {
      await createNotification(
        {
          tenantId,
          targetRole: action.targetRole || "manager",
          title: `Approval Required: ${workflowName}`,
          message,
          type: "alert",
          link: "/app/automations",
        },
        store,
      );
      return {
        status: "awaiting_approval",
        detail: `Paused execution awaiting human approval from ${
          action.targetRole || "manager"
        }`,
        haltedForApproval: true,
      };
    }
    case "log_audit": {
      await recordAuditLog(
        {
          tenantId,
          userId: userId ?? null,
          actorName: "OpsPilot Automation",
          action: "workflow.action",
          module: "automation",
          entityType: "workflow",
          summary: message,
          metadata: payload,
        },
        store,
      );
      return {
        status: "completed",
        detail: `Recorded compliance audit entry: ${message}`,
      };
    }
    default:
      return { status: "skipped", detail: "Unknown action step skipped" };
  }
}

export async function dispatchWorkflowEvent(
  params: {
    tenantId: number;
    triggerEvent: string;
    payload: Record<string, unknown>;
    userId?: number | null;
    workflowId?: number;
    eventKey?: string;
  },
  store: Database = db,
) {
  const matches = await store
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.tenantId, params.tenantId),
        eq(workflows.triggerEvent, params.triggerEvent),
        eq(workflows.approvalStatus, "approved"),
        eq(workflows.isEnabled, true),
        params.workflowId ? eq(workflows.id, params.workflowId) : undefined,
      ),
    );
  const executionIds: number[] = [];
  for (const wf of matches) {
    if (!wf.conditions.every((cond) => evaluateCondition(cond, params.payload)))
      continue;
    const [row] = await store
      .insert(workflowExecutions)
      .values({
        tenantId: params.tenantId,
        workflowId: wf.id,
        workflowName: wf.name,
        triggerEvent: params.triggerEvent,
        eventKey: params.eventKey,
        triggerPayload: params.payload,
        status: "queued",
        attemptCount: 0,
      })
      .onConflictDoNothing()
      .returning({ id: workflowExecutions.id });
    if (row) executionIds.push(row.id);
  }
  return { queuedCount: executionIds.length, executionIds };
}

/** Exactly one database step per transaction. Row lock + savepoint make retries of local effects atomic. */
export async function advanceWorkflow() {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(workflowExecutions)
      .where(
        and(
          inArray(workflowExecutions.status, ["queued", "scheduled"]),
          lte(workflowExecutions.runAfter, new Date()),
        ),
      )
      .orderBy(workflowExecutions.runAfter, workflowExecutions.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return false;
    const where = and(
      eq(workflowExecutions.id, job.id),
      eq(workflowExecutions.tenantId, job.tenantId),
    );
    const [wf] = await tx
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.id, job.workflowId),
          eq(workflows.tenantId, job.tenantId),
        ),
      )
      .for("share");
    if (!wf || !wf.isEnabled || wf.approvalStatus !== "approved") {
      await tx
        .update(workflowExecutions)
        .set({ status: "canceled", completedAt: new Date() })
        .where(where);
      return true;
    }
    try {
      await tx.transaction(async (step) => {
        const action = wf.actions[job.nextStep];
        const now = new Date();
        const result = action
          ? await executeSingleAction(
              {
                tenantId: job.tenantId,
                workflowName: wf.name,
                action,
                payload: job.triggerPayload,
              },
              step,
            )
          : null;
        const next = job.nextStep + 1;
        const status = result?.haltedForApproval
          ? "awaiting_approval"
          : action?.type === "delay"
            ? "scheduled"
            : next >= wf.actions.length
              ? "completed"
              : "queued";
        const runAfter =
          action?.type === "delay"
            ? new Date(now.getTime() + (action.delayMinutes ?? 15) * 60_000)
            : now;
        const logs = action
          ? [
              ...job.stepLogs,
              {
                step: action.type,
                status,
                detail: `Step ${next}`,
                at: now.toISOString(),
              },
            ]
          : job.stepLogs;
        await step
          .update(workflowExecutions)
          .set({
            status,
            nextStep: next,
            runAfter,
            attemptCount: 0,
            errorMessage: null,
            stepLogs: logs,
            completedAt: status === "completed" ? now : null,
          })
          .where(where);
        if (status === "completed")
          await step
            .update(workflows)
            .set({ runCount: sql`${workflows.runCount} + 1`, lastRunAt: now })
            .where(eq(workflows.id, wf.id));
      });
    } catch {
      const attempts = job.attemptCount + 1;
      await tx
        .update(workflowExecutions)
        .set({
          status: attempts > wf.retryLimit ? "failed" : "scheduled",
          attemptCount: attempts,
          runAfter: new Date(Date.now() + 2 ** attempts * 1000),
          errorMessage: "Step failed. Inspect configuration before retrying.",
        })
        .where(where);
    }
    return true;
  });
}

/**
 * Runs scheduled sweeps for overdue invoices, overdue tasks, low-stock items,
 * and schedule.daily workflows within a specific tenant workspace.
 */
export async function runScheduledSweep(
  tenantId: number,
  userId?: number | null,
  store: Database = db,
): Promise<{
  overdueInvoicesTriggered: number;
  lowStockTriggered: number;
  overdueTasksTriggered: number;
  dailyTriggered: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Overdue invoices
  const overdueInvs = await store
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.docType, "invoice"),
        lt(invoices.dueDate, today),
        ne(invoices.status, "paid"),
        ne(invoices.status, "cancelled"),
        ne(invoices.status, "refunded"),
      ),
    );

  let overdueInvoicesTriggered = 0;
  for (const inv of overdueInvs) {
    if (inv.status !== "overdue" && inv.balanceCents > 0) {
      await store
        .update(invoices)
        .set({ status: "overdue", updatedAt: new Date() })
        .where(and(eq(invoices.id, inv.id), eq(invoices.tenantId, tenantId)));
    }
    const res = await dispatchWorkflowEvent(
      {
        tenantId,
        eventKey: `overdue:${today}:${inv.id}`,
        triggerEvent: "invoice.overdue",
        payload: {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          dueDate: inv.dueDate,
          balanceCents: inv.balanceCents,
          link: "/app/sales",
        },
        userId,
      },
      store,
    );
    overdueInvoicesTriggered += res.queuedCount;
  }

  // 2. Low-stock products
  const lowProducts = await store
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.itemType, "product"),
        eq(products.status, "active"),
        lte(products.stockQuantity, products.reorderLevel),
      ),
    );

  let lowStockTriggered = 0;
  for (const prod of lowProducts) {
    const res = await dispatchWorkflowEvent(
      {
        tenantId,
        eventKey: `low:${today}:${prod.id}`,
        triggerEvent: "stock.low",
        payload: {
          productId: prod.id,
          name: prod.name,
          sku: prod.sku,
          stockQuantity: prod.stockQuantity,
          reorderLevel: prod.reorderLevel,
          link: "/app/inventory",
        },
        userId,
      },
      store,
    );
    lowStockTriggered += res.queuedCount;
  }

  // 3. Overdue tasks
  const overdueTaskRows = await store
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        ne(tasks.status, "done"),
        lt(tasks.dueDate, today),
      ),
    );

  let overdueTasksTriggered = 0;
  for (const task of overdueTaskRows) {
    const res = await dispatchWorkflowEvent(
      {
        tenantId,
        eventKey: `task:${today}:${task.id}`,
        triggerEvent: "task.overdue",
        payload: {
          taskId: task.id,
          title: task.title,
          assignedName: task.assigneeName || "Assignee",
          dueDate: task.dueDate,
          priority: task.priority,
          link: "/app/projects",
        },
        userId,
      },
      store,
    );
    overdueTasksTriggered += res.queuedCount;
  }

  // 4. Daily schedule workflows
  const daily = await dispatchWorkflowEvent(
    {
      tenantId,
      eventKey: `daily:${today}`,
      triggerEvent: "schedule.daily",
      payload: {
        date: today,
        overdueInvoiceCount: overdueInvs.length,
        lowStockCount: lowProducts.length,
        overdueTaskCount: overdueTaskRows.length,
        link: "/app",
      },
      userId,
    },
    store,
  );

  return {
    overdueInvoicesTriggered,
    lowStockTriggered,
    overdueTasksTriggered,
    dailyTriggered: daily.queuedCount,
  };
}

/**
 * Converts a natural-language description into a structured OpsPilot workflow draft.
 * Drafts ALWAYS start in `pending_approval` with `isEnabled: false` per safety rules.
 */
export function buildWorkflowDraftFromPrompt(prompt: string): {
  name: string;
  description: string;
  triggerEvent: string;
  scheduleExpression: string | null;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
} {
  const lower = prompt.toLowerCase();
  let triggerEvent = "lead.created";
  let name = "New Lead Response Automation";
  let scheduleExpression: string | null = null;
  const conditions: WorkflowCondition[] = [];
  const actions: WorkflowAction[] = [];

  if (
    lower.includes("invoice") &&
    (lower.includes("overdue") ||
      lower.includes("late") ||
      lower.includes("unpaid"))
  ) {
    triggerEvent = "invoice.overdue";
    name = "Overdue Invoice Reminder & Follow-Up";
    actions.push({
      type: "send_invoice_reminder",
      title: "Overdue Invoice {{invoiceNumber}}",
      message:
        "Invoice {{invoiceNumber}} (due {{dueDate}}) requires collection follow-up.",
    });
  } else if (lower.includes("invoice") && lower.includes("paid")) {
    triggerEvent = "invoice.paid";
    name = "Invoice Payment Confirmation Workflow";
    actions.push({
      type: "notify",
      targetRole: "accountant",
      title: "Payment Received: {{invoiceNumber}}",
      message: "Full settlement recorded for invoice {{invoiceNumber}}.",
    });
  } else if (
    lower.includes("stock") ||
    lower.includes("inventory") ||
    lower.includes("reorder")
  ) {
    triggerEvent = "stock.low";
    name = "Low Inventory Threshold Alert";
    actions.push({
      type: "notify",
      targetRole: "manager",
      title: "Low Stock: {{name}} ({{sku}})",
      message:
        "Current stock is {{stockQuantity}} units (reorder threshold: {{reorderLevel}}).",
    });
  } else if (
    lower.includes("leave") ||
    lower.includes("vacation") ||
    lower.includes("pto")
  ) {
    triggerEvent = "leave.requested";
    name = "Employee Leave Review Notification";
    actions.push({
      type: "notify",
      targetRole: "hr_manager",
      title: "Leave Request from {{employeeName}}",
      message:
        "{{employeeName}} requested {{days}} day(s) of {{leaveType}} leave.",
    });
  } else if (
    lower.includes("purchase order") ||
    lower.includes("vendor") ||
    lower.includes("procurement")
  ) {
    triggerEvent = "po.pending_approval";
    name = "Purchase Order Approval Gate";
    actions.unshift({
      type: "require_approval",
      targetRole: "manager",
      title: "Approve PO {{poNumber}}",
      message: "Purchase order {{poNumber}} is awaiting managerial sign-off.",
    });
  } else if (
    lower.includes("task") &&
    (lower.includes("overdue") ||
      lower.includes("late") ||
      lower.includes("deadline"))
  ) {
    triggerEvent = "task.overdue";
    name = "Overdue Task Escalation";
    actions.push({
      type: "notify",
      targetRole: "employee",
      title: "Task Overdue: {{title}}",
      message:
        "Task '{{title}}' assigned to {{assignedName}} passed its deadline ({{dueDate}}).",
    });
  } else if (
    lower.includes("daily") ||
    lower.includes("every day") ||
    lower.includes("morning") ||
    lower.includes("schedule")
  ) {
    triggerEvent = "schedule.daily";
    scheduleExpression = "daily-utc";
    name = "Daily Operations Briefing";
    actions.push({
      type: "notify",
      targetRole: "manager",
      title: "Daily OpsPilot Digest ({{date}})",
      message:
        "Overdue invoices: {{overdueInvoiceCount}}, Low stock items: {{lowStockCount}}, Overdue tasks: {{overdueTaskCount}}.",
    });
  } else {
    triggerEvent = "lead.created";
    name = "New Lead Sales Assignment & Follow-Up";
    if (lower.includes("high") || lower.includes("urgent")) {
      conditions.push({ field: "priority", operator: "eq", value: "high" });
      name = "High-Priority Lead Rapid Response";
    }
    actions.push({
      type: "notify",
      targetRole: "salesperson",
      title: "New Lead: {{title}}",
      message:
        "Lead '{{title}}' from {{company}} assigned to {{assignedName}}.",
    });
  }

  // Optional numeric threshold parsing (e.g. "above 50000" or "over 10000")
  const amountMatch = lower.match(
    /(?:above|over|greater than|exceeds)\s+₹?([\d,]+)/,
  );
  if (amountMatch) {
    const rawNum = Number(amountMatch[1].replace(/,/g, ""));
    if (Number.isFinite(rawNum) && rawNum > 0) {
      const field =
        triggerEvent === "lead.created"
          ? "estimatedValueCents"
          : triggerEvent === "invoice.overdue"
            ? "balanceCents"
            : "totalCents";
      conditions.push({ field, operator: "gt", value: rawNum * 100 });
    }
  }

  // Optional delay step
  const delayMatch = lower.match(
    /(?:wait|delay|after)\s+(\d+)\s*(minute|min|hour|hr)/,
  );
  if (delayMatch) {
    const qty = Number(delayMatch[1]);
    const unit = delayMatch[2];
    const delayMinutes = unit.startsWith("h") ? qty * 60 : qty;
    actions.unshift({
      type: "delay",
      delayMinutes: Math.min(10080, Math.max(1, delayMinutes)),
    });
  }

  // Optional task creation step
  if (
    lower.includes("create a task") ||
    lower.includes("create task") ||
    lower.includes("follow-up task") ||
    lower.includes("follow up")
  ) {
    actions.push({
      type: "create_task",
      priority: "high",
      title: `Follow up: ${name}`,
      message: `Auto-generated follow-up action from workflow "${name}".`,
    });
  }

  // Optional approval step
  if (
    lower.includes("require approval") ||
    lower.includes("manager approval") ||
    (lower.includes("approv") && triggerEvent !== "po.pending_approval")
  ) {
    actions.unshift({
      type: "require_approval",
      targetRole: "manager",
      title: `Approval Gate: ${name}`,
      message:
        "Requires explicit manager confirmation before performing workflow actions.",
    });
  }

  // Optional audit trail
  actions.push({
    type: "log_audit",
    message: `Executed workflow "${name}" on event ${triggerEvent}.`,
  });

  return {
    name,
    description: prompt.trim(),
    triggerEvent,
    scheduleExpression,
    conditions,
    actions,
  };
}
