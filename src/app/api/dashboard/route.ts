import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  auditLogs,
  milestones,
  customers,
  employees,
  invoices,
  leads,
  products,
  projects,
  tasks,
  transactions,
} from "@/db/schema";
import { handleApiError, requireAuth } from "@/lib/auth";
import { DEFAULT_DASHBOARD_WIDGETS } from "@/lib/permissions";

const STAGE_ORDER = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

function getLastSixMonths(): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    result.push(`${yyyy}-${mm}`);
  }
  return result;
}

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "dashboard:view");
    const tId = ctx.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const months = getLastSixMonths();

    const [
      txRows,
      invRows,
      custRows,
      leadRows,
      empRows,
      attRows,
      taskRows,
      projRows,
      prodRows,
      activityRows,
    ] = await Promise.all([
      ctx.permissions.has("finance:view")
        ? db
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, tId),
                eq(transactions.status, "posted"),
              ),
            )
        : [],
      ctx.permissions.has("sales:view")
        ? db.select().from(invoices).where(eq(invoices.tenantId, tId))
        : [],
      ctx.permissions.has("crm:view")
        ? db.select().from(customers).where(eq(customers.tenantId, tId))
        : [],
      ctx.permissions.has("crm:view")
        ? db.select().from(leads).where(eq(leads.tenantId, tId))
        : [],
      ctx.permissions.has("hrms:view")
        ? db.select().from(employees).where(eq(employees.tenantId, tId))
        : [],
      ctx.permissions.has("hrms:view")
        ? db
            .select()
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.tenantId, tId),
                eq(attendanceRecords.date, today),
              ),
            )
        : [],
      ctx.permissions.has("projects:view")
        ? db.select().from(tasks).where(eq(tasks.tenantId, tId))
        : [],
      ctx.permissions.has("projects:view")
        ? db.select().from(projects).where(eq(projects.tenantId, tId))
        : [],
      ctx.permissions.has("inventory:view")
        ? db
            .select()
            .from(products)
            .where(
              and(eq(products.tenantId, tId), eq(products.status, "active")),
            )
        : [],
      ctx.permissions.has("workspace:audit")
        ? db
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.tenantId, tId))
            .orderBy(desc(auditLogs.createdAt))
            .limit(10)
        : [],
    ]);

    // Financial KPIs & Monthly Trend
    let revenueCents = 0;
    let expenseCents = 0;
    const monthBuckets = new Map<
      string,
      { revenue: number; expenses: number }
    >();
    for (const m of months) {
      monthBuckets.set(m, { revenue: 0, expenses: 0 });
    }
    const expenseByCategory = new Map<string, number>();

    for (const tx of txRows) {
      const ym = tx.transactionDate.slice(0, 7);
      const bucket = monthBuckets.get(ym);
      if (tx.direction === "credit") {
        revenueCents += tx.amountCents;
        if (bucket) bucket.revenue += tx.amountCents;
      } else {
        expenseCents += tx.amountCents;
        if (bucket) bucket.expenses += tx.amountCents;
        expenseByCategory.set(
          tx.category,
          (expenseByCategory.get(tx.category) || 0) + tx.amountCents,
        );
      }
    }

    const profitCents = revenueCents - expenseCents;
    const currentYm = months[months.length - 1];
    const currentBucket = monthBuckets.get(currentYm) || {
      revenue: 0,
      expenses: 0,
    };

    const outstandingInvoices = invRows.filter(
      (i) =>
        i.docType === "invoice" &&
        i.status !== "cancelled" &&
        i.status !== "paid" &&
        i.balanceCents > 0,
    );
    const outstandingCents = outstandingInvoices.reduce(
      (s, i) => s + i.balanceCents,
      0,
    );
    const overdueCount = outstandingInvoices.filter(
      (i) => i.status === "overdue" || i.dueDate < today,
    ).length;

    // CRM & Ops metrics
    const newLeadsCount = leadRows.filter((l) => l.stage === "new").length;
    const activeDeals = leadRows.filter(
      (l) => l.stage !== "won" && l.stage !== "lost",
    );
    const activeDealsValueCents = activeDeals.reduce(
      (s, l) => s + l.estimatedValueCents,
      0,
    );
    const wonLeadsCount = leadRows.filter((l) => l.stage === "won").length;
    const conversionRatePct =
      leadRows.length > 0
        ? Math.round((wonLeadsCount / leadRows.length) * 100)
        : 0;

    const activeEmployees = empRows.filter(
      (e) => e.employmentStatus === "active",
    );
    const presentToday = attRows.filter(
      (a) =>
        a.status === "present" || a.status === "remote" || a.status === "late",
    ).length;

    const pendingTasks = taskRows.filter((t) => t.status !== "done");
    const activeProjects = projRows.filter(
      (p) => p.status === "active" || p.status === "delayed",
    );
    const delayedProjectsCount = projRows.filter(
      (p) => p.status === "delayed",
    ).length;

    const lowStockItems = prodRows
      .filter(
        (p) => p.itemType === "product" && p.stockQuantity <= p.reorderLevel,
      )
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        stockQuantity: p.stockQuantity,
        reorderLevel: p.reorderLevel,
        category: p.category,
      }));

    // Chart 1: Revenue, Expense & Profit trends (major currency units for charts)
    const financialTrends = months.map((m) => {
      const b = monthBuckets.get(m) || { revenue: 0, expenses: 0 };
      const rev = Math.round(b.revenue / 100);
      const exp = Math.round(b.expenses / 100);
      return {
        month: formatMonthShort(m),
        revenue: rev,
        expenses: exp,
        profit: rev - exp,
      };
    });

    // Chart 2: Sales Pipeline & Conversion
    const salesConversion = STAGE_ORDER.map((stage) => {
      const matching = leadRows.filter((l) => l.stage === stage);
      return {
        stage: stage.charAt(0).toUpperCase() + stage.slice(1),
        count: matching.length,
        value: Math.round(
          matching.reduce((s, l) => s + l.estimatedValueCents, 0) / 100,
        ),
      };
    });

    // Chart 3: Expense categories
    const expenseCategories = Array.from(expenseByCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, cents]) => ({
        category,
        amount: Math.round(cents / 100),
        amountCents: cents,
      }));

    // Chart 4: Customer & Lead acquisition by month
    const customerAcquisition = months.map((m, idx) => {
      const newCustInMonth = custRows.filter(
        (c) => c.createdAt.toISOString().slice(0, 7) === m,
      ).length;
      const cumulative = custRows.filter(
        (c) => c.createdAt.toISOString().slice(0, 7) <= m,
      ).length;
      return {
        month: formatMonthShort(m),
        customers: cumulative,
        newCustomers: newCustInMonth,
        activeAccounts: Math.max(
          cumulative,
          idx === months.length - 1 ? custRows.length : 0,
        ),
      };
    });

    const widgets =
      Array.isArray(ctx.tenant.dashboardWidgets) &&
      ctx.tenant.dashboardWidgets.length > 0
        ? ctx.tenant.dashboardWidgets
        : DEFAULT_DASHBOARD_WIDGETS;

    const setup =
      ctx.role === "owner"
        ? await db
            .select({ step: milestones.step })
            .from(milestones)
            .where(eq(milestones.tenantId, tId))
        : [];
    return NextResponse.json({
      setup: setup.map((r) => r.step),
      currency: ctx.tenant.currency,
      kpis: {
        revenueCents,
        monthRevenueCents: currentBucket.revenue,
        expenseCents,
        monthExpenseCents: currentBucket.expenses,
        profitCents,
        monthProfitCents: currentBucket.revenue - currentBucket.expenses,
        outstandingCents,
        overdueInvoicesCount: overdueCount,
        customersCount: custRows.length,
        newLeadsCount,
        activeDealsCount: activeDeals.length,
        activeDealsValueCents,
        conversionRatePct,
        employeesCount: activeEmployees.length,
        attendancePresentToday: presentToday,
        pendingTasksCount: pendingTasks.length,
        activeProjectsCount: activeProjects.length,
        delayedProjectsCount,
        inventoryAlertsCount: lowStockItems.length,
      },
      charts: {
        financialTrends,
        salesConversion,
        expenseCategories,
        customerAcquisition,
      },
      lowStockItems,
      recentActivities: activityRows,
      widgets,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
