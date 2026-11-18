"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Plus, RotateCcw, Paperclip } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatCard,
  StatusPill,
} from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";

interface FinancePayload {
  currency: string;
  summary: {
    totalIncomeCents: number;
    totalExpenseCents: number;
    netProfitCents: number;
    receivablesCents: number;
    payablesCents: number;
  };
  profitAndLoss: {
    incomeCategories: Array<{ category: string; amountCents: number }>;
    expenseCategories: Array<{ category: string; amountCents: number }>;
  };
  monthlyReport: Array<{
    month: string;
    incomeCents: number;
    expenseCents: number;
    netCashFlowCents: number;
    income: number;
    expenses: number;
    net: number;
  }>;
  receivables: Array<{
    id: number;
    invoiceNumber: string;
    dueDate: string;
    status: string;
    balanceCents: number;
    customerCompany: string;
  }>;
  payables: Array<{
    id: number;
    poNumber: string;
    expectedDate: string | null;
    status: string;
    balanceCents: number;
    vendorName: string;
  }>;
  transactions: Array<{
    id: number;
    entryNumber: string;
    type: string;
    direction: string;
    category: string;
    amountCents: number;
    paymentMethod: string;
    transactionDate: string;
    description: string;
    receiptDocumentId: number | null;
    status: string;
    actorName: string;
  }>;
}

export default function FinancePage() {
  const searchParams = useSearchParams();
  const { apiFetch, can, toast } = useWorkspace();
  const [data, setData] = useState<FinancePayload | null>(null);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [docs, setDocs] = useState<Array<{ id: number; title: string }>>([]);
  const [tab, setTab] = useState("ledger");
  const [dirFilter, setDirFilter] = useState("all");

  const [txModal, setTxModal] = useState(searchParams.get("new") === "expense");
  const [txForm, setTxForm] = useState({
    type: "expense" as "income" | "expense",
    category: "Cloud & Software",
    amount: "",
    paymentMethod: "Bank Transfer",
    transactionDate: new Date().toISOString().slice(0, 10),
    description: "",
    projectId: "",
    receiptDocumentId: "",
  });

  const [reverseTarget, setReverseTarget] = useState<{
    id: number;
    entryNumber: string;
  } | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<FinancePayload>(
        `/api/finance?direction=${dirFilter}`,
      );
      setData(res);
      if (can("projects:view"))
        setProjects(
          (await apiFetch<{ projects: typeof projects }>("/api/projects"))
            .projects,
        );
      if (can("documents:view")) {
        const dRes = await apiFetch<{
          documents: Array<{ id: number; title: string }>;
        }>("/api/documents");
        setDocs(dRes.documents);
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load ledger",
        "error",
      );
    }
  }, [apiFetch, dirFilter, can, toast]);

  useLoadEffect(load);

  const submitTx = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/finance", {
        method: "POST",
        body: JSON.stringify({
          ...txForm,
          projectId: txForm.projectId ? Number(txForm.projectId) : null,
          amount: Number(txForm.amount),
          receiptDocumentId: txForm.receiptDocumentId
            ? Number(txForm.receiptDocumentId)
            : null,
        }),
      });
      setTxModal(false);
      setTxForm((p) => ({
        ...p,
        amount: "",
        description: "",
        receiptDocumentId: "",
      }));
      toast("Ledger entry posted with immutable audit log");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const submitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    try {
      await apiFetch("/api/finance", {
        method: "PATCH",
        body: JSON.stringify({ id: reverseTarget.id, reason: reverseReason }),
      });
      setReverseTarget(null);
      setReverseReason("");
      toast("Posted reversing journal entry");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Reversal error", "error");
    }
  };

  if (!data) {
    return (
      <div className="text-xs text-slate-500">Loading financial ledger…</div>
    );
  }

  const { summary, currency } = data;

  return (
    <div>
      <PageHeader
        title="Finance & cash ledger"
        description="Recorded payments, expenses, receivables and payables. Cash movement is not an accrual profit and loss statement."
        actions={
          can("finance:write") && (
            <>
              <button
                type="button"
                onClick={() => {
                  setTxForm((p) => ({
                    ...p,
                    type: "income",
                    category: "Client Retainers",
                  }));
                  setTxModal(true);
                }}
                className="op-btn-secondary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Record Income
              </button>
              <button
                type="button"
                onClick={() => {
                  setTxForm((p) => ({
                    ...p,
                    type: "expense",
                    category: "Cloud & Software",
                  }));
                  setTxModal(true);
                }}
                className="op-btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Expense
              </button>
            </>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Recorded inflows"
          value={formatMoney(summary.totalIncomeCents, currency)}
          tone="positive"
        />
        <StatCard
          label="Recorded outflows"
          value={formatMoney(summary.totalExpenseCents, currency)}
        />
        <StatCard
          label="Net recorded cash"
          value={formatMoney(summary.netProfitCents, currency)}
          tone={summary.netProfitCents >= 0 ? "positive" : "danger"}
        />
        <StatCard
          label="Receivables (AR)"
          value={formatMoney(summary.receivablesCents, currency)}
          tone="warning"
        />
        <StatCard
          label="Payables (AP)"
          value={formatMoney(summary.payablesCents, currency)}
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: "ledger",
            label: "Ledger entries",
            count: data.transactions.length,
          },
          { id: "pnl", label: "Cash flow" },
          {
            id: "arap",
            label: "Receivables & Payables",
            count: data.receivables.length + data.payables.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "ledger" && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <select
              value={dirFilter}
              onChange={(e) => setDirFilter(e.target.value)}
              className="op-input w-auto text-xs"
            >
              <option value="all">All Entries</option>
              <option value="credit">Credits (Inflows)</option>
              <option value="debit">Debits (Outflows)</option>
            </select>
            <span className="text-xs text-slate-500">
              Historical entries cannot be overwritten — use Reversal to adjust.
            </span>
          </div>
          <div className="op-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Entry #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category & Description</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.transactions.map((t) => (
                  <tr
                    key={t.id}
                    className={
                      t.status === "reversed"
                        ? "opacity-55"
                        : "hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium">
                      {t.entryNumber}
                    </td>
                    <td className="px-4 py-3 text-xs tabular text-slate-600 dark:text-slate-400">
                      {t.transactionDate}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>{t.description}</span>
                        {t.receiptDocumentId && (
                          <Paperclip className="h-3 w-3 text-indigo-500" />
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {t.category} · Posted by {t.actorName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {t.paymentMethod}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={t.status} />
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular ${
                        t.direction === "credit"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-900 dark:text-white"
                      }`}
                    >
                      {t.direction === "credit" ? "+" : "-"}
                      {formatMoney(t.amountCents, currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {can("finance:reverse") && t.status === "posted" && (
                        <button
                          type="button"
                          onClick={() =>
                            setReverseTarget({
                              id: t.id,
                              entryNumber: t.entryNumber,
                            })
                          }
                          title="Post reversing entry"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pnl" && (
        <div className="space-y-6">
          <div className="op-card p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Monthly Cash Flow Statement
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              Monthly posted inflows vs outflows and net cash position
            </p>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyReport}>
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
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="income"
                    name="Inflows"
                    fill="#059669"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Outflows"
                    fill="#475569"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="net"
                    name="Net Cash Flow"
                    fill="#4F46E5"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="op-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                Recorded inflows by category
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.profitAndLoss.incomeCategories.map((c) => (
                  <div
                    key={c.category}
                    className="flex justify-between py-2 text-xs tabular"
                  >
                    <span>{c.category}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatMoney(c.amountCents, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="op-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                Recorded outflows by category
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.profitAndLoss.expenseCategories.map((c) => (
                  <div
                    key={c.category}
                    className="flex justify-between py-2 text-xs tabular"
                  >
                    <span>{c.category}</span>
                    <span className="font-semibold">
                      {formatMoney(c.amountCents, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "arap" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="op-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Customer Receivables ({data.receivables.length})
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.receivables.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2.5 text-xs"
                >
                  <div>
                    <div className="font-semibold">{r.invoiceNumber}</div>
                    <div className="text-slate-500">
                      {r.customerCompany} · Due {r.dueDate}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    <span className="font-semibold tabular">
                      {formatMoney(r.balanceCents, currency)}
                    </span>
                  </div>
                </div>
              ))}
              {data.receivables.length === 0 && (
                <p className="py-4 text-xs text-slate-500">
                  No open receivables.
                </p>
              )}
            </div>
          </div>

          <div className="op-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Vendor Payables ({data.payables.length})
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.payables.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2.5 text-xs"
                >
                  <div>
                    <div className="font-semibold">{p.poNumber}</div>
                    <div className="text-slate-500">{p.vendorName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={p.status} />
                    <span className="font-semibold tabular">
                      {formatMoney(p.balanceCents, currency)}
                    </span>
                  </div>
                </div>
              ))}
              {data.payables.length === 0 && (
                <p className="py-4 text-xs text-slate-500">
                  No open vendor payables.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Post Transaction Modal */}
      <Modal
        open={txModal}
        onClose={() => setTxModal(false)}
        title={
          txForm.type === "income"
            ? "Record Income Entry"
            : "Record Expense Entry"
        }
        subtitle="Records a cash entry; no funds are transferred"
      >
        <form onSubmit={submitTx} className="space-y-3.5">
          <label className="op-label">
            Allocate to project (optional)
            <select
              className="op-input"
              value={txForm.projectId}
              onChange={(e) =>
                setTxForm({ ...txForm, projectId: e.target.value })
              }
            >
              <option value="">Unallocated</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="finance-field-1" className="op-label">
                Entry Type
              </label>
              <select
                id="finance-field-1"
                value={txForm.type}
                onChange={(e) =>
                  setTxForm({
                    ...txForm,
                    type: e.target.value as "income" | "expense",
                  })
                }
                className="op-input"
              >
                <option value="expense">Expense (Debit)</option>
                <option value="income">Income (Credit)</option>
              </select>
            </div>
            <div>
              <label htmlFor="finance-field-2" className="op-label">
                Category
              </label>
              <input
                id="finance-field-2"
                required
                value={txForm.category}
                onChange={(e) =>
                  setTxForm({ ...txForm, category: e.target.value })
                }
                list="fin-categories"
                className="op-input"
              />
              <datalist id="fin-categories">
                <option value="Cloud & Software" />
                <option value="Office & Rent" />
                <option value="Marketing & Ads" />
                <option value="Travel & Client Meals" />
                <option value="Operations & Supplies" />
                <option value="Client Retainers" />
                <option value="Hardware Sales" />
              </datalist>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="op-label">Amount ({currency})</label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                value={txForm.amount}
                onChange={(e) =>
                  setTxForm({ ...txForm, amount: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label htmlFor="finance-field-3" className="op-label">
                Transaction Date
              </label>
              <input
                id="finance-field-3"
                type="date"
                required
                value={txForm.transactionDate}
                onChange={(e) =>
                  setTxForm({ ...txForm, transactionDate: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="finance-field-4" className="op-label">
              Description
            </label>
            <input
              id="finance-field-4"
              required
              value={txForm.description}
              onChange={(e) =>
                setTxForm({ ...txForm, description: e.target.value })
              }
              placeholder="Vendor, invoice ref, or business purpose"
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="finance-field-5" className="op-label">
                Payment Method
              </label>
              <select
                id="finance-field-5"
                value={txForm.paymentMethod}
                onChange={(e) =>
                  setTxForm({ ...txForm, paymentMethod: e.target.value })
                }
                className="op-input"
              >
                <option>Bank Transfer</option>
                <option>Corporate Card</option>
                <option>UPI / IMPS</option>
                <option>RTGS</option>
                <option>Cash</option>
              </select>
            </div>
            <div>
              <label htmlFor="finance-field-6" className="op-label">
                Receipt Attachment (Optional)
              </label>
              <select
                id="finance-field-6"
                value={txForm.receiptDocumentId}
                onChange={(e) =>
                  setTxForm({ ...txForm, receiptDocumentId: e.target.value })
                }
                className="op-input"
              >
                <option value="">No document attached</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTxModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Post to Ledger
            </button>
          </div>
        </form>
      </Modal>

      {/* Reverse Entry Modal */}
      <Modal
        open={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        title={`Reverse Ledger Entry ${reverseTarget?.entryNumber || ""}`}
        subtitle="Preserves the historical record and posts a counter-balancing audit reversal"
      >
        <form onSubmit={submitReversal} className="space-y-3.5">
          <div>
            <label htmlFor="finance-field-7" className="op-label">
              Mandatory Audit Reason
            </label>
            <input
              id="finance-field-7"
              required
              minLength={3}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. Duplicate vendor charge rectified"
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReverseTarget(null)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Confirm Reversal
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
