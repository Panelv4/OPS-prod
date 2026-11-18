import { and, desc, eq, gt, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  employees,
  invoices,
  leads,
  leaveRequests,
  products,
  projects,
  purchaseOrders,
  tasks,
  tenants,
  transactions,
  type AiPendingAction,
} from "@/db/schema";
import { formatMoney, toCents } from "@/lib/finance";
import { ApiError } from "./http";
import { effectivePlan } from "./plans";
import { decryptSecret, generateSecureToken } from "@/lib/security";
import { buildWorkflowDraftFromPrompt } from "@/lib/automation";
import type { AuthContext } from "@/lib/auth";

export interface AiQueryResult {
  answer: string;
  toolsUsed: string[];
  structuredData: Record<string, unknown>;
  pendingAction: AiPendingAction | null;
  tokensUsed: number;
  provider: string;
}

/**
 * Deterministic, permission-scoped business facts retriever.
 * Every query is strictly bound to ctx.tenantId and checked against ctx.permissions.
 */
export async function gatherAuthorizedBusinessSnapshot(ctx: AuthContext) {
  const { tenantId, permissions, tenant } = ctx;
  const currency = tenant.currency || "INR";
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthPrefix = today.slice(0, 7);

  const canFinance = permissions.has("finance:view");
  const canSales = permissions.has("sales:view");
  const canCrm = permissions.has("crm:view");
  const canInventory = permissions.has("inventory:view");
  const canProjects = permissions.has("projects:view");
  const canHrms = permissions.has("hrms:view");
  const canProcurement = permissions.has("procurement:view");

  // Finance
  let finance: {
    totalRevenueCents: number;
    totalExpenseCents: number;
    netProfitCents: number;
    monthRevenueCents: number;
    monthExpenseCents: number;
    monthProfitCents: number;
    topExpenses: Array<{
      category: string;
      amountCents: number;
      formatted: string;
    }>;
    largeTransactions: Array<{
      description: string;
      category: string;
      amountCents: number;
      date: string;
    }>;
  } | null = null;

  if (canFinance) {
    const txRows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.status, "posted"),
        ),
      );

    let totalRevenueCents = 0;
    let totalExpenseCents = 0;
    let monthRevenueCents = 0;
    let monthExpenseCents = 0;
    const catMap = new Map<string, number>();

    for (const tx of txRows) {
      const isThisMonth = tx.transactionDate.startsWith(thisMonthPrefix);
      if (tx.direction === "credit") {
        totalRevenueCents += tx.amountCents;
        if (isThisMonth) monthRevenueCents += tx.amountCents;
      } else {
        totalExpenseCents += tx.amountCents;
        if (isThisMonth) monthExpenseCents += tx.amountCents;
        catMap.set(
          tx.category,
          (catMap.get(tx.category) || 0) + tx.amountCents,
        );
      }
    }

    const netProfitCents = totalRevenueCents - totalExpenseCents;
    const monthProfitCents = monthRevenueCents - monthExpenseCents;

    const topExpenses = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amountCents]) => ({
        category,
        amountCents,
        formatted: formatMoney(amountCents, currency),
      }));

    const debitTxs = txRows.filter(
      (t) =>
        t.direction === "debit" &&
        (t.type !== "payroll" ||
          permissions.has("hrms:confidential") ||
          permissions.has("hrms:payroll")),
    );
    const avgDebit =
      debitTxs.length > 0
        ? debitTxs.reduce((s, t) => s + t.amountCents, 0) / debitTxs.length
        : 0;
    const largeTransactions = debitTxs
      .filter((t) => avgDebit > 0 && t.amountCents > avgDebit * 1.75)
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 3)
      .map((t) => ({
        description: t.description,
        category: t.category,
        amountCents: t.amountCents,
        date: t.transactionDate,
      }));

    finance = {
      totalRevenueCents,
      totalExpenseCents,
      netProfitCents,
      monthRevenueCents,
      monthExpenseCents,
      monthProfitCents,
      topExpenses,
      largeTransactions,
    };
  }

  // Sales & Overdue Invoices
  let overdueInvoices: Array<{
    id: number;
    invoiceNumber: string;
    customerName: string;
    company: string;
    dueDate: string;
    balanceCents: number;
    formattedBalance: string;
  }> | null = null;
  let totalReceivablesCents = 0;

  if (canSales) {
    const invRows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        dueDate: invoices.dueDate,
        status: invoices.status,
        balanceCents: invoices.balanceCents,
        customerName: customers.name,
        company: customers.company,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.docType, "invoice"),
          gt(invoices.balanceCents, 0),
          ne(invoices.status, "cancelled"),
        ),
      )
      .orderBy(desc(invoices.balanceCents));

    totalReceivablesCents = invRows.reduce((s, i) => s + i.balanceCents, 0);
    overdueInvoices = invRows
      .filter((i) => i.status === "overdue" || i.dueDate < today)
      .map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        customerName: i.customerName,
        company: i.company,
        dueDate: i.dueDate,
        balanceCents: i.balanceCents,
        formattedBalance: formatMoney(i.balanceCents, currency),
      }));
  }

  // Inventory
  let lowStockProducts: Array<{
    id: number;
    sku: string;
    name: string;
    stockQuantity: number;
    reorderLevel: number;
  }> | null = null;

  if (canInventory) {
    lowStockProducts = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        stockQuantity: products.stockQuantity,
        reorderLevel: products.reorderLevel,
      })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.itemType, "product"),
          eq(products.status, "active"),
          lte(products.stockQuantity, products.reorderLevel),
        ),
      );
  }

  // CRM Leads
  let followupLeads: Array<{
    id: number;
    title: string;
    company: string;
    stage: string;
    priority: string;
    followUpDate: string | null;
    estimatedValueCents: number;
    formattedValue: string;
  }> | null = null;

  if (canCrm) {
    const leadRows = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          ne(leads.stage, "won"),
          ne(leads.stage, "lost"),
        ),
      )
      .orderBy(desc(leads.estimatedValueCents));

    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    followupLeads = leadRows
      .filter(
        (l) =>
          (l.followUpDate && l.followUpDate <= horizon) ||
          l.priority === "high" ||
          l.priority === "urgent",
      )
      .slice(0, 8)
      .map((l) => ({
        id: l.id,
        title: l.title,
        company: l.company,
        stage: l.stage,
        priority: l.priority,
        followUpDate: l.followUpDate,
        estimatedValueCents: l.estimatedValueCents,
        formattedValue: formatMoney(l.estimatedValueCents, currency),
      }));
  }

  // Projects & Tasks
  let delayedProjects: Array<{
    id: number;
    code: string;
    name: string;
    status: string;
    deadline: string;
    budgetCents: number;
    spentCents: number;
  }> | null = null;
  let overdueTaskCount = 0;

  if (canProjects) {
    const projRows = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.tenantId, tenantId), ne(projects.status, "completed")),
      );

    delayedProjects = projRows
      .filter(
        (p) =>
          p.status === "delayed" ||
          p.deadline < today ||
          p.spentCents > p.budgetCents,
      )
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        deadline: p.deadline,
        budgetCents: p.budgetCents,
        spentCents: p.spentCents,
      }));

    const overdueTaskRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          ne(tasks.status, "done"),
          lt(tasks.dueDate, today),
        ),
      );
    overdueTaskCount = overdueTaskRows.length;
  }

  // HRMS & Procurement quick counts
  let activeEmployeeCount: number | null = null;
  let pendingLeaveCount: number | null = null;
  if (canHrms) {
    const empRows = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.employmentStatus, "active"),
        ),
      );
    const lvRows = await db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(leaveRequests.status, "pending"),
        ),
      );
    activeEmployeeCount = empRows.length;
    pendingLeaveCount = lvRows.length;
  }

  let pendingPoCount: number | null = null;
  if (canProcurement) {
    const poRows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          eq(purchaseOrders.status, "pending_approval"),
        ),
      );
    pendingPoCount = poRows.length;
  }

  // Deterministic anomaly detection
  const anomalies: Array<{
    severity: "high" | "medium" | "low";
    area: string;
    detail: string;
  }> = [];
  if (finance) {
    if (finance.monthProfitCents < 0) {
      anomalies.push({
        severity: "high",
        area: "Finance",
        detail: `Current month net cash flow is negative (${formatMoney(
          finance.monthProfitCents,
          currency,
        )}). Expenses exceed monthly inflows.`,
      });
    }
    for (const tx of finance.largeTransactions) {
      anomalies.push({
        severity: "medium",
        area: "Expense Outlier",
        detail: `Above-average outflow of ${formatMoney(
          tx.amountCents,
          currency,
        )} in ${tx.category}: "${tx.description}" (${tx.date}).`,
      });
    }
  }
  if (overdueInvoices && overdueInvoices.length > 0) {
    const overdueSum = overdueInvoices.reduce((s, i) => s + i.balanceCents, 0);
    anomalies.push({
      severity: "high",
      area: "Receivables",
      detail: `${overdueInvoices.length} overdue invoice(s) totaling ${formatMoney(
        overdueSum,
        currency,
      )} remain uncollected.`,
    });
  }
  if (lowStockProducts && lowStockProducts.length > 0) {
    anomalies.push({
      severity: lowStockProducts.some((p) => p.stockQuantity === 0)
        ? "high"
        : "medium",
      area: "Inventory",
      detail: `${lowStockProducts.length} SKU(s) are at or below reorder level (${lowStockProducts
        .map((p) => `${p.name}: ${p.stockQuantity}/${p.reorderLevel}`)
        .join(", ")}).`,
    });
  }
  if (delayedProjects && delayedProjects.length > 0) {
    anomalies.push({
      severity: "medium",
      area: "Projects",
      detail: `${delayedProjects.length} project(s) flagged delayed or over-budget (${delayedProjects
        .map((p) => p.name)
        .join(", ")}).`,
    });
  }

  // Smart recommendations & suggested tasks
  const recommendations: string[] = [];
  if (overdueInvoices && overdueInvoices.length > 0) {
    recommendations.push(
      `Prioritize collection on ${overdueInvoices[0].invoiceNumber} (${overdueInvoices[0].company} — ${overdueInvoices[0].formattedBalance}) to improve working capital.`,
    );
  }
  if (lowStockProducts && lowStockProducts.length > 0) {
    recommendations.push(
      `Issue a vendor purchase order for ${lowStockProducts
        .slice(0, 2)
        .map((p) => p.name)
        .join(" and ")} to avoid fulfillment stockouts.`,
    );
  }
  if (followupLeads && followupLeads.length > 0) {
    recommendations.push(
      `Follow up with ${followupLeads[0].company} on "${followupLeads[0].title}" (${followupLeads[0].formattedValue}, stage: ${followupLeads[0].stage}).`,
    );
  }
  if (finance && finance.topExpenses[0]) {
    recommendations.push(
      `Audit your largest cost driver (${finance.topExpenses[0].category}: ${finance.topExpenses[0].formatted}) for quarterly vendor consolidation.`,
    );
  }

  return {
    currency,
    today,
    thisMonthPrefix,
    finance,
    totalReceivablesCents: canSales ? totalReceivablesCents : null,
    overdueInvoices,
    lowStockProducts,
    followupLeads,
    delayedProjects,
    overdueTaskCount: canProjects ? overdueTaskCount : null,
    activeEmployeeCount,
    pendingLeaveCount,
    pendingPoCount,
    anomalies,
    recommendations,
  };
}

/**
 * Deterministic invoice/receipt parser for raw pasted text or uploaded text preview.
 */
export function extractReceiptOrInvoiceData(rawText: string, currency = "INR") {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const vendorMatch = rawText.match(
    /(?:vendor|from|merchant|supplier|billed by)\s*[:\-]\s*(.+)/i,
  );
  const vendor = vendorMatch?.[1]?.trim() || lines[0] || "Unknown Vendor";

  const invMatch = rawText.match(
    /(?:invoice|receipt|bill|ref)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9-]{3,28})/i,
  );
  const documentNumber = invMatch?.[1] || null;

  const dateMatch = rawText.match(
    /(\d{4}-\d{2}-\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4})/,
  );
  let date: string | null = null;
  if (dateMatch) {
    const raw = dateMatch[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      date = raw;
    } else {
      const parts = raw.split(/[\/-]/);
      date = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  const parseAmount = (regex: RegExp): number | null => {
    const m = rawText.match(regex);
    if (!m) return null;
    const cleaned = m[1].replace(/,/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? toCents(num) : null;
  };

  const totalCents = parseAmount(
    /\b(?:grand\s+total|total\s+amount|amount\s+due|total)\b\s*[:\-]?\s*(?:₹|rs\.?|inr|\$|usd|eur|£)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  const taxCents = parseAmount(
    /(?:gst|tax|vat|igst|cgst)\s*(?:\(\d+%\))?\s*[:\-]?\s*(?:₹|rs\.?|inr|\$|usd|eur|£)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  const subtotalCents =
    parseAmount(
      /(?:subtotal|sub-total|net)\s*[:\-]?\s*(?:₹|rs\.?|inr|\$|usd|eur|£)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ) ??
    (totalCents !== null && taxCents !== null
      ? Math.max(0, totalCents - taxCents)
      : null);

  // Guess category
  const lower = rawText.toLowerCase();
  let suggestedCategory = "Operations & Supplies";
  if (
    lower.includes("aws") ||
    lower.includes("cloud") ||
    lower.includes("software") ||
    lower.includes("saas") ||
    lower.includes("hosting")
  ) {
    suggestedCategory = "Cloud & Software";
  } else if (
    lower.includes("marketing") ||
    lower.includes("ads") ||
    lower.includes("campaign")
  ) {
    suggestedCategory = "Marketing & Ads";
  } else if (
    lower.includes("rent") ||
    lower.includes("office") ||
    lower.includes("coworking")
  ) {
    suggestedCategory = "Office & Rent";
  } else if (
    lower.includes("flight") ||
    lower.includes("hotel") ||
    lower.includes("travel") ||
    lower.includes("cab")
  ) {
    suggestedCategory = "Travel & Client Meals";
  }

  return {
    vendor,
    documentNumber,
    date,
    category: suggestedCategory,
    subtotalCents,
    taxCents,
    totalCents,
    formattedSubtotal:
      subtotalCents === null
        ? "Not found"
        : formatMoney(subtotalCents, currency),
    formattedTax:
      taxCents === null ? "Not found" : formatMoney(taxCents, currency),
    formattedTotal:
      totalCents === null ? "Not found" : formatMoney(totalCents, currency),
    confidence: "Review required",
  };
}

// Explicit product-help requests are the only external surface. No DB facts, ledger summaries or conversation history are sent.
async function optionalHelp(ctx: AuthContext, question: string) {
  const key =
    ctx.tenant.aiApiKeyEncrypted && decryptSecret(ctx.tenant.aiApiKeyEncrypted);
  if (
    !key ||
    process.env.ENABLE_EXTERNAL_AI !== "1" ||
    ctx.tenant.aiProvider !== "openai"
  )
    return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: ctx.tenant.aiModel,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "Give general agency workflow advice. You have no access to company records. Do not give business figures.",
          },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) return null;
    const result = await res.json();
    return typeof result.choices?.[0]?.message?.content === "string"
      ? (result.choices[0].message.content as string)
      : null;
  } catch {
    return null;
  }
}

async function reserveUnits(ctx: AuthContext, units: number) {
  const month = new Date().toISOString().slice(0, 7);
  const used = sql`case when ${tenants.aiUsageMonth} = ${month} then ${tenants.aiTokensUsed} else 0 end`;
  const quota = effectivePlan(ctx.tenant).aiTokenLimit;
  const updated = await db
    .update(tenants)
    .set({ aiTokensUsed: sql`${used} + ${units}`, aiUsageMonth: month })
    .where(
      and(eq(tenants.id, ctx.tenantId), sql`${used} + ${units} <= ${quota}`),
    )
    .returning({ id: tenants.id });
  if (!updated.length)
    throw new ApiError(429, "Monthly AI usage allowance reached.");
}

export async function processAiAssistantQuery(
  ctx: AuthContext,
  question: string,
): Promise<AiQueryResult> {
  if (
    question.toLowerCase().startsWith("help:") &&
    ctx.tenant.aiProvider === "openai"
  ) {
    const units = Buffer.byteLength(question) + 500; // conservative reservation for the bounded external call
    await reserveUnits(ctx, units);
    const help = await optionalHelp(ctx, question.slice(5));
    return {
      answer: help
        ? `General guidance (not workspace data): ${help}`
        : "External help unavailable. Ask a workspace question without the help: prefix for a local answer.",
      tokensUsed: units,
      provider: help ? "openai:help" : "unavailable",
      toolsUsed: [],
      structuredData: {},
      pendingAction: null,
    };
  }
  const snapshot = await gatherAuthorizedBusinessSnapshot(ctx);
  const { currency } = snapshot;
  const q = question.toLowerCase();
  const toolsUsed: string[] = [];
  const sections: string[] = [];
  let pendingAction: AiPendingAction | null = null;
  const structuredData: Record<string, unknown> = {};

  // Workflow drafting intent
  if (
    q.includes("workflow") ||
    q.includes("automate") ||
    (q.startsWith("when ") &&
      (q.includes("notify") || q.includes("remind") || q.includes("create")))
  ) {
    toolsUsed.push("draft_workflow_from_nl");
    if (!ctx.permissions.has("automation:write")) {
      sections.push(
        "Your current role does not have `automation:write` permission to create workflow automations. Contact your workspace Owner or Administrator.",
      );
    } else {
      const draft = buildWorkflowDraftFromPrompt(question);
      structuredData.workflowDraft = draft;
      pendingAction = {
        id: generateSecureToken(8),
        actionType: "create_workflow_draft",
        summary: `Save workflow draft "${draft.name}" (trigger: ${draft.triggerEvent}, ${draft.actions.length} steps) in Pending Approval status`,
        payload: draft as unknown as Record<string, unknown>,
        status: "pending",
      };
      sections.push(
        `I drafted a workflow automation from your instruction:\n\n` +
          `• **Name:** ${draft.name}\n` +
          `• **Trigger:** \`${draft.triggerEvent}\`\n` +
          `• **Conditions:** ${
            draft.conditions.length
              ? draft.conditions
                  .map((c) => `${c.field} ${c.operator} ${c.value}`)
                  .join(", ")
              : "All matching events"
          }\n` +
          `• **Steps:** ${draft.actions.map((a) => a.type).join(" → ")}\n\n` +
          `Confirm below to save this draft. Per OpsPilot governance policy, it will require manager/owner approval before activation.`,
      );
    }
  }

  // Revenue / profit intent
  if (
    q.includes("revenue") ||
    q.includes("income") ||
    q.includes("profit") ||
    q.includes("cash flow") ||
    q.includes("inflow") ||
    q.includes("outflow")
  ) {
    toolsUsed.push("get_financial_summary");
    if (!snapshot.finance) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) is not authorized to view workspace financial ledger totals.",
      );
    } else {
      const f = snapshot.finance;
      structuredData.finance = f;
      sections.push(
        `**Recorded cash flow (${ctx.tenant.name}):** Based on posted entries, not accrual profit.\n` +
          `• **This month (${snapshot.thisMonthPrefix}) inflows:** ${formatMoney(f.monthRevenueCents, currency)}\n` +
          `• **This month outflows:** ${formatMoney(f.monthExpenseCents, currency)}\n` +
          `• **This month net recorded cash:** ${formatMoney(f.monthProfitCents, currency)}\n` +
          `• **Total recorded inflows:** ${formatMoney(f.totalRevenueCents, currency)}\n` +
          `• **Total recorded outflows:** ${formatMoney(f.totalExpenseCents, currency)}\n` +
          `• **Net recorded cash:** ${formatMoney(f.netProfitCents, currency)}`,
      );
    }
  }

  // Overdue payments / invoices
  if (
    q.includes("overdue") ||
    q.includes("unpaid") ||
    q.includes("receivable") ||
    q.includes("invoice")
  ) {
    toolsUsed.push("get_overdue_invoices");
    if (snapshot.overdueInvoices === null) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) does not have `sales:view` permission to inspect customer invoices.",
      );
    } else if (snapshot.overdueInvoices.length === 0) {
      sections.push(
        `**Overdue Invoices:** None. All issued invoices are currently within payment terms. Total open receivables: ${formatMoney(
          snapshot.totalReceivablesCents || 0,
          currency,
        )}.`,
      );
    } else {
      const totalOverdue = snapshot.overdueInvoices.reduce(
        (s, i) => s + i.balanceCents,
        0,
      );
      structuredData.overdueInvoices = snapshot.overdueInvoices;
      sections.push(
        `**Overdue Customer Payments (${snapshot.overdueInvoices.length} invoices — ${formatMoney(
          totalOverdue,
          currency,
        )}):**\n` +
          snapshot.overdueInvoices
            .map(
              (i) =>
                `• **${i.invoiceNumber}** — ${i.company} (${i.customerName}): **${i.formattedBalance}** (due ${i.dueDate})`,
            )
            .join("\n"),
      );
      if (!pendingAction && ctx.permissions.has("sales:write")) {
        pendingAction = {
          id: generateSecureToken(8),
          actionType: "send_overdue_reminders",
          summary: `Record internal collection follow-ups for ${snapshot.overdueInvoices.length} overdue invoice(s) totaling ${formatMoney(
            totalOverdue,
            currency,
          )}`,
          payload: { invoiceIds: snapshot.overdueInvoices.map((i) => i.id) },
          status: "pending",
        };
      }
    }
  }

  // Largest expenses
  if (q.includes("expense") || q.includes("spend") || q.includes("cost")) {
    toolsUsed.push("get_largest_expenses");
    if (!snapshot.finance) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) is not authorized to inspect expense breakdowns.",
      );
    } else if (snapshot.finance.topExpenses.length === 0) {
      sections.push(
        "**Largest Expenses:** No posted expense entries recorded yet.",
      );
    } else {
      structuredData.topExpenses = snapshot.finance.topExpenses;
      sections.push(
        `**Largest Expense Categories (Total: ${formatMoney(
          snapshot.finance.totalExpenseCents,
          currency,
        )}):**\n` +
          snapshot.finance.topExpenses
            .map((e, idx) => `${idx + 1}. **${e.category}:** ${e.formatted}`)
            .join("\n"),
      );
    }
  }

  // Low stock
  if (
    q.includes("stock") ||
    q.includes("inventory") ||
    q.includes("product") ||
    q.includes("sku")
  ) {
    toolsUsed.push("get_low_stock_products");
    if (snapshot.lowStockProducts === null) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) lacks `inventory:view` permission.",
      );
    } else if (snapshot.lowStockProducts.length === 0) {
      sections.push(
        "**Inventory Status:** All active SKUs are stocked above their reorder thresholds.",
      );
    } else {
      structuredData.lowStockProducts = snapshot.lowStockProducts;
      sections.push(
        `**Low-Stock Inventory Alerts (${snapshot.lowStockProducts.length} SKU(s)):**\n` +
          snapshot.lowStockProducts
            .map(
              (p) =>
                `• **${p.name}** (\`${p.sku}\`): **${p.stockQuantity} units** remaining (reorder threshold: ${p.reorderLevel})`,
            )
            .join("\n"),
      );
    }
  }

  // Leads follow-up
  if (
    q.includes("lead") ||
    q.includes("follow-up") ||
    q.includes("follow up") ||
    q.includes("pipeline") ||
    q.includes("deal")
  ) {
    toolsUsed.push("get_followup_leads");
    if (snapshot.followupLeads === null) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) lacks `crm:view` permission.",
      );
    } else if (snapshot.followupLeads.length === 0) {
      sections.push(
        "**CRM Pipeline:** No urgent or upcoming lead follow-ups due in the next 7 days.",
      );
    } else {
      structuredData.followupLeads = snapshot.followupLeads;
      sections.push(
        `**Priority Leads Requiring Follow-Up (${snapshot.followupLeads.length}):**\n` +
          snapshot.followupLeads
            .map(
              (l) =>
                `• **${l.title}** — ${l.company} (${l.formattedValue}) · Stage: \`${l.stage}\` · Priority: \`${l.priority}\`${
                  l.followUpDate ? ` · Follow-up: ${l.followUpDate}` : ""
                }`,
            )
            .join("\n"),
      );
    }
  }

  // Delayed projects & task suggestions
  if (
    q.includes("project") ||
    q.includes("delay") ||
    q.includes("task") ||
    q.includes("suggest")
  ) {
    toolsUsed.push("get_projects_and_task_suggestions");
    if (snapshot.delayedProjects === null) {
      sections.push(
        "**Permission Restricted:** Your role (`" +
          ctx.role +
          "`) lacks `projects:view` permission.",
      );
    } else {
      structuredData.delayedProjects = snapshot.delayedProjects;
      if (snapshot.delayedProjects.length === 0) {
        sections.push(
          `**Project Delivery:** Zero delayed projects. Overdue open tasks: **${snapshot.overdueTaskCount ?? 0}**.`,
        );
      } else {
        sections.push(
          `**Delayed / At-Risk Projects (${snapshot.delayedProjects.length}):**\n` +
            snapshot.delayedProjects
              .map(
                (p) =>
                  `• **${p.name}** (\`${p.code}\`) — Status: \`${p.status}\`, Deadline: ${p.deadline}, Spend: ${formatMoney(
                    p.spentCents,
                    currency,
                  )} / ${formatMoney(p.budgetCents, currency)}`,
              )
              .join("\n") +
            `\n• Open overdue tasks across workspace: **${snapshot.overdueTaskCount ?? 0}**`,
        );
        if (!pendingAction && ctx.permissions.has("projects:write")) {
          const topProj = snapshot.delayedProjects[0];
          pendingAction = {
            id: generateSecureToken(8),
            actionType: "create_task",
            summary: `Create high-priority recovery task for delayed project "${topProj.name}"`,
            payload: {
              projectId: topProj.id,
              title: `Schedule recovery review: ${topProj.name}`,
              description: `Address timeline/budget variance on ${topProj.code} (deadline ${topProj.deadline}).`,
              priority: "urgent",
            },
            status: "pending",
          };
        }
      }
    }
  }

  // Anomalies
  if (
    q.includes("anomal") ||
    q.includes("risk") ||
    q.includes("unusual") ||
    q.includes("alert")
  ) {
    toolsUsed.push("detect_business_anomalies");
    structuredData.anomalies = snapshot.anomalies;
    if (snapshot.anomalies.length === 0) {
      sections.push(
        "**Anomaly Detection:** No critical operational or financial anomalies detected.",
      );
    } else {
      sections.push(
        `**Detected Business Anomalies (${snapshot.anomalies.length}):**\n` +
          snapshot.anomalies
            .map(
              (a) =>
                `• **[${a.severity.toUpperCase()} · ${a.area}]** ${a.detail}`,
            )
            .join("\n"),
      );
    }
  }

  // General executive report / "How is our business performing?" fallback
  if (
    sections.length === 0 ||
    q.includes("perform") ||
    q.includes("report") ||
    q.includes("overview") ||
    q.includes("summary") ||
    q.includes("recommend")
  ) {
    toolsUsed.push("generate_executive_report");
    structuredData.report = {
      anomalies: snapshot.anomalies,
      recommendations: snapshot.recommendations,
    };
    const lines: string[] = [
      `**Executive Performance Report — ${ctx.tenant.name} (${snapshot.today})**`,
    ];
    if (snapshot.finance) {
      lines.push(
        `• **Recorded cash:** Inflows ${formatMoney(
          snapshot.finance.totalRevenueCents,
          currency,
        )} | Outflows ${formatMoney(
          snapshot.finance.totalExpenseCents,
          currency,
        )} | Net cash flow **${formatMoney(
          snapshot.finance.netProfitCents,
          currency,
        )}**`,
      );
    }
    if (snapshot.overdueInvoices !== null) {
      lines.push(
        `• **Receivables:** ${formatMoney(
          snapshot.totalReceivablesCents || 0,
          currency,
        )} open (${snapshot.overdueInvoices.length} overdue invoice(s))`,
      );
    }
    if (snapshot.followupLeads !== null) {
      lines.push(
        `• **CRM:** ${snapshot.followupLeads.length} active lead(s) prioritized for follow-up`,
      );
    }
    if (snapshot.lowStockProducts !== null) {
      lines.push(
        `• **Inventory:** ${snapshot.lowStockProducts.length} SKU(s) at or below reorder level`,
      );
    }
    if (snapshot.delayedProjects !== null) {
      lines.push(
        `• **Delivery:** ${snapshot.delayedProjects.length} delayed project(s), ${
          snapshot.overdueTaskCount ?? 0
        } overdue task(s)`,
      );
    }
    if (snapshot.activeEmployeeCount !== null) {
      lines.push(
        `• **People:** ${snapshot.activeEmployeeCount} active employee(s), ${
          snapshot.pendingLeaveCount ?? 0
        } pending leave request(s)`,
      );
    }
    if (snapshot.recommendations.length > 0) {
      lines.push(
        `\n**Strategic Recommendations:**\n` +
          snapshot.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n"),
      );
    }
    sections.push(lines.join("\n"));
  }

  const deterministicAnswer = sections.join("\n\n");

  const finalAnswer = deterministicAnswer;
  const tokensUsed = Math.max(
    45,
    Math.ceil((question.length + finalAnswer.length) / 4),
  );
  const provider = "deterministic:opspilot-core-v1";
  await reserveUnits(ctx, tokensUsed);

  return {
    answer: finalAnswer,
    toolsUsed: Array.from(new Set(toolsUsed)),
    structuredData,
    pendingAction,
    tokensUsed,
    provider,
  };
}
