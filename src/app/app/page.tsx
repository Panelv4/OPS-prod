"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  SlidersHorizontal,
  Sparkles,
  Plus,
  AlertTriangle,
  ArrowUpRight,
  Users,
  ReceiptText,
  Landmark,
  UserCheck,
  FolderKanban,
  CheckSquare,
  Package,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Modal, PageHeader, StatCard } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";
import type { DashboardWidgetConfig } from "@/db/schema";

interface DashboardPayload {
  setup: string[];
  currency: string;
  kpis: {
    revenueCents: number;
    monthRevenueCents: number;
    expenseCents: number;
    monthExpenseCents: number;
    profitCents: number;
    monthProfitCents: number;
    outstandingCents: number;
    overdueInvoicesCount: number;
    customersCount: number;
    newLeadsCount: number;
    activeDealsCount: number;
    activeDealsValueCents: number;
    conversionRatePct: number;
    employeesCount: number;
    attendancePresentToday: number;
    pendingTasksCount: number;
    activeProjectsCount: number;
    delayedProjectsCount: number;
    inventoryAlertsCount: number;
  };
  charts: {
    financialTrends: Array<{
      month: string;
      revenue: number;
      expenses: number;
      profit: number;
    }>;
    salesConversion: Array<{ stage: string; count: number; value: number }>;
    expenseCategories: Array<{
      category: string;
      amount: number;
      amountCents: number;
    }>;
    customerAcquisition: Array<{
      month: string;
      customers: number;
      newCustomers: number;
    }>;
  };
  lowStockItems: Array<{
    id: number;
    sku: string;
    name: string;
    stockQuantity: number;
    reorderLevel: number;
    category: string;
  }>;
  recentActivities: Array<{
    id: number;
    actorName: string;
    module: string;
    summary: string;
    createdAt: string;
  }>;
  widgets: DashboardWidgetConfig[];
}

export default function DashboardPage() {
  const { session, apiFetch, can, toast } = useWorkspace();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidgetConfig[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<DashboardPayload>("/api/dashboard");
      setData(res);
      setWidgets(res.widgets || []);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load dashboard",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, toast]);

  useLoadEffect(load);

  const isVisible = (id: string) => {
    const found = widgets.find((w) => w.id === id);
    return found ? found.visible : true;
  };

  const saveWidgets = async () => {
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_widgets",
          dashboardWidgets: widgets,
        }),
      });
      setCustomizeOpen(false);
      toast("Saved dashboard widget preferences");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Unable to save widgets",
        "error",
      );
    }
  };

  if (!loading && !data)
    return (
      <p role="alert">
        Could not load the dashboard.{" "}
        <button className="op-btn-secondary" onClick={load}>
          Try again
        </button>
      </p>
    );
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
            />
          ))}
        </div>
      </div>
    );
  }

  const { kpis, charts, currency } = data;

  const quickActions = [
    {
      label: "Create Customer",
      href: "/app/crm?new=customer",
      icon: Users,
      perm: "crm:write",
    },
    {
      label: "Create Invoice",
      href: "/app/sales?new=invoice",
      icon: ReceiptText,
      perm: "sales:write",
    },
    {
      label: "Add Expense",
      href: "/app/finance?new=expense",
      icon: Landmark,
      perm: "finance:write",
    },
    {
      label: "Add Employee",
      href: "/app/hrms?new=employee",
      icon: UserCheck,
      perm: "hrms:write",
    },
    {
      label: "Add Task",
      href: "/app/projects?new=task",
      icon: CheckSquare,
      perm: "projects:write",
    },
    {
      label: "Create Project",
      href: "/app/projects?new=project",
      icon: FolderKanban,
      perm: "projects:write",
    },
    {
      label: "Add Product",
      href: "/app/inventory?new=product",
      icon: Package,
      perm: "inventory:write",
    },
  ].filter((a) => can(a.perm));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${session?.user.fullName.split(" ")[0]}`}
        description={`Live operating overview for ${session?.tenant.name} · Based on the workspace records you can access`}
        actions={
          <>
            {can("dashboard:customize") && (
              <button
                type="button"
                onClick={() => setCustomizeOpen(true)}
                className="op-btn-secondary text-xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Customize Widgets
              </button>
            )}
            <Link href="/app/ai" className="op-btn-primary text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Ask OpsPilot AI
            </Link>
          </>
        }
      />

      {session?.role === "owner" && data.setup.length < 4 && (
        <section className="op-card p-5 space-y-3" aria-label="Workspace setup">
          <h2 className="font-semibold">
            Your first client engagement · {data.setup.length}/4
          </h2>
          <p className="text-sm text-slate-500">
            Start with a real client when ready, or{" "}
            <Link href="/demo" className="underline">
              try a separate sample
            </Link>
            . Review currency and tax in Settings before invoicing.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              ["customer", "Add or import a customer", "/app/crm?new=customer"],
              [
                "project",
                "Set a project budget and deadline",
                "/app/projects?new=project",
              ],
              [
                "financial",
                "Create an invoice or financial record",
                "/app/sales?new=invoice",
              ],
              [
                "invitation",
                "Invite a team member and choose a role",
                "/app/settings",
              ],
            ].map(([step, label, href]) => (
              <li key={step}>
                <Link
                  className="op-btn-secondary w-full justify-start"
                  href={href}
                >
                  {data.setup.includes(step) ? "✓" : "○"} {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Row 1: Primary Financial KPIs */}
      {can("finance:view") && isVisible("financial_kpis") && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Recorded inflows"
            value={formatMoney(kpis.revenueCents, currency)}
            subtext={`This month: ${formatMoney(kpis.monthRevenueCents, currency)}`}
            tone="positive"
          />
          <StatCard
            label="Recorded outflows"
            value={formatMoney(kpis.expenseCents, currency)}
            subtext={`This month: ${formatMoney(kpis.monthExpenseCents, currency)}`}
          />
          <StatCard
            label="Net recorded cash"
            value={formatMoney(kpis.profitCents, currency)}
            subtext={`Month net: ${formatMoney(kpis.monthProfitCents, currency)}`}
            tone={kpis.profitCents >= 0 ? "positive" : "danger"}
          />
          <StatCard
            label="Outstanding Payments"
            value={formatMoney(kpis.outstandingCents, currency)}
            subtext={
              kpis.overdueInvoicesCount > 0
                ? `${kpis.overdueInvoicesCount} overdue invoice(s)`
                : "Zero overdue invoices"
            }
            tone={kpis.overdueInvoicesCount > 0 ? "warning" : "positive"}
          />
        </div>
      )}

      {/* Row 2: CRM, HRMS, Projects & Inventory Pulse */}
      {isVisible("operations_kpis") && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            { label: "Customers", val: kpis.customersCount, href: "/app/crm" },
            { label: "New Leads", val: kpis.newLeadsCount, href: "/app/crm" },
            {
              label: "Active Deals",
              val: kpis.activeDealsCount,
              href: "/app/crm",
            },
            { label: "Employees", val: kpis.employeesCount, href: "/app/hrms" },
            {
              label: "Attendance",
              val: `${kpis.attendancePresentToday}/${kpis.employeesCount}`,
              href: "/app/hrms",
            },
            {
              label: "Pending Tasks",
              val: kpis.pendingTasksCount,
              href: "/app/projects",
            },
            {
              label: "Active Projects",
              val: kpis.activeProjectsCount,
              href: "/app/projects",
            },
            {
              label: "Stock Alerts",
              val: kpis.inventoryAlertsCount,
              href: "/app/inventory",
              alert: kpis.inventoryAlertsCount > 0,
            },
          ]
            .filter((m) => can(`${m.href.slice(5)}:view`))
            .map((m) => (
              <Link
                key={m.label}
                href={m.href}
                className="op-card p-3.5 transition-colors hover:border-slate-300 dark:hover:border-slate-700"
              >
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                  {m.label}
                </div>
                <div
                  className={`mt-1 text-lg font-semibold tabular ${
                    m.alert
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {m.val}
                </div>
              </Link>
            ))}
        </div>
      )}

      {/* Quick Actions Strip */}
      {isVisible("quick_actions") && quickActions.length > 0 && (
        <div className="op-card p-4">
          <div className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Quick Actions
          </div>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((qa) => {
              const Icon = qa.icon;
              return (
                <Link
                  key={qa.label}
                  href={qa.href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500"
                >
                  <Plus className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                  <span>{qa.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts Row 1: Financial Trends & Sales Pipeline */}
      <div className="grid gap-6 lg:grid-cols-3">
        {can("finance:view") && isVisible("revenue_chart") && (
          <div className="op-card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recorded cash flow
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Last 6 months posted ledger flow ({currency})
                </p>
              </div>
              <Link
                href="/app/finance"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Ledger <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.financialTrends}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#4F46E5"
                        stopOpacity={0.22}
                      />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#059669"
                        stopOpacity={0.18}
                      />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Inflows"
                    stroke="#4F46E5"
                    strokeWidth={2}
                    fill="url(#revGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    name="Outflows"
                    stroke="#64748B"
                    strokeWidth={1.75}
                    fill="transparent"
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    name="Net recorded cash"
                    stroke="#059669"
                    strokeWidth={2}
                    fill="url(#profGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {can("crm:view") && isVisible("pipeline_chart") && (
          <div className="op-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Sales Conversion Pipeline
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Win rate: {kpis.conversionRatePct}% · Open{" "}
                  {formatMoney(kpis.activeDealsValueCents, currency, true)}
                </p>
              </div>
              <Link
                href="/app/crm"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                CRM
              </Link>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.salesConversion} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={78}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Deals"
                    fill="#4F46E5"
                    radius={[0, 5, 5, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Charts Row 2: Expense Categories & Customer Acquisition */}
      {can("finance:view") && isVisible("expense_chart") && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="op-card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Expense Categories Breakdown
            </h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Verified outflow distribution across cost centers
            </p>
            {charts.expenseCategories.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No posted expenses yet.
              </p>
            ) : (
              <div className="space-y-3">
                {charts.expenseCategories.map((cat) => {
                  const pct =
                    kpis.expenseCents > 0
                      ? Math.round((cat.amountCents / kpis.expenseCents) * 100)
                      : 0;
                  return (
                    <div key={cat.category}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {cat.category}
                        </span>
                        <span className="text-slate-600 tabular dark:text-slate-400">
                          {formatMoney(cat.amountCents, currency)} ({pct}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-slate-900 dark:bg-indigo-500"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="op-card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Customer Acquisition Growth
            </h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Cumulative active customer accounts in workspace
            </p>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.customerAcquisition}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="customers"
                    name="Total Customers"
                    stroke="#0F172A"
                    strokeWidth={2.2}
                    dot={{ r: 3.5, fill: "#4F46E5" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Alerts & Live Audit Feed */}
      {isVisible("alerts_activity") && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="op-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Inventory Low-Stock Alerts
              </h2>
              <Link
                href="/app/inventory"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Manage Inventory
              </Link>
            </div>
            {data.lowStockItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                All physical SKUs are stocked above reorder thresholds.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.lowStockItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {item.sku} · {item.category}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700 tabular dark:bg-amber-950/50 dark:text-amber-300">
                      {item.stockQuantity} / {item.reorderLevel} min
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="op-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Recent Business Activity
              </h2>
              <Link
                href="/app/settings"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Audit Log
              </Link>
            </div>
            {data.recentActivities.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No recent activity recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentActivities.slice(0, 6).map((act) => (
                  <div key={act.id} className="py-2.5 text-xs">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {act.summary}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {act.actorName} ·{" "}
                      <span className="uppercase">{act.module}</span> ·{" "}
                      {new Date(act.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customize Widgets Modal */}
      <Modal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title="Customize Dashboard Widgets"
        subtitle="Toggle sections displayed on your workspace overview"
      >
        <div className="space-y-2.5">
          {widgets.map((w) => (
            <label
              key={w.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm dark:border-slate-800"
            >
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {w.label}
              </span>
              <input
                type="checkbox"
                checked={w.visible}
                onChange={(e) =>
                  setWidgets((prev) =>
                    prev.map((x) =>
                      x.id === w.id ? { ...x, visible: e.target.checked } : x,
                    ),
                  )
                }
                className="h-4 w-4 rounded accent-indigo-600"
              />
            </label>
          ))}
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setCustomizeOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveWidgets}
              className="op-btn-primary"
            >
              Save Layout
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
