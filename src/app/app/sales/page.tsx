"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Printer,
  CreditCard,
  RotateCcw,
  Bell,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatCard,
  StatusPill,
} from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";

interface InvoiceRow {
  id: number;
  docType: "quotation" | "sales_order" | "invoice";
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  balanceCents: number;
  currency: string;
  reminderCount: number;
  customerId: number;
  customerName: string;
  customerCompany: string;
}

interface CustomerOption {
  id: number;
  name: string;
  company: string;
}

interface ProductOption {
  id: number;
  sku: string;
  name: string;
  sellingPriceCents: number;
  taxRateBps: number;
}

export default function SalesPage() {
  const searchParams = useSearchParams();
  const { session, apiFetch, can, toast, refreshSession } = useWorkspace();
  const currency = session?.tenant.currency || "INR";

  const [tab, setTab] = useState("all");
  const [docs, setDocs] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get("project") || "");
  const [projectOptions, setProjectOptions] = useState<
    { id: number; name: string; customerId: number | null }[]
  >([]);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [createOpen, setCreateOpen] = useState(
    searchParams.get("new") === "invoice",
  );
  const [payModal, setPayModal] = useState<InvoiceRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("RTGS / Bank Transfer");

  const [refundModal, setRefundModal] = useState<InvoiceRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const [docType, setDocType] = useState<
    "quotation" | "sales_order" | "invoice"
  >("invoice");
  const [customerId, setCustomerId] = useState(
    searchParams.get("customer") || "",
  );
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
  );
  const [orderDiscount, setOrderDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([
    {
      productId: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxPct: (session?.tenant.defaultTaxBps || 0) / 100,
    },
  ]);

  const loadData = useCallback(async () => {
    try {
      const invRes = await apiFetch<{ invoices: InvoiceRow[] }>(
        `/api/sales/invoices?docType=${tab}`,
      );
      setDocs(invRes.invoices);

      if (can("crm:view")) {
        const cRes = await apiFetch<{ customers: CustomerOption[] }>(
          "/api/crm/customers",
        );
        setCustomers(cRes.customers);
        if (!customerId && cRes.customers[0]) {
          setCustomerId(String(cRes.customers[0].id));
        }
      }
      if (can("projects:view"))
        setProjectOptions(
          (await apiFetch<{ projects: typeof projectOptions }>("/api/projects"))
            .projects,
        );
      if (can("inventory:view")) {
        const pRes = await apiFetch<{ products: ProductOption[] }>(
          "/api/inventory",
        );
        setProducts(pRes.products);
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Error loading sales",
        "error",
      );
    }
  }, [apiFetch, tab, can, customerId, toast]);

  useLoadEffect(loadData, 120);

  const selectProduct = (idx: number, prodId: string) => {
    const prod = products.find((p) => String(p.id) === prodId);
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              productId: prodId,
              description: prod ? prod.name : it.description,
              unitPrice: prod ? prod.sellingPriceCents / 100 : it.unitPrice,
              taxPct: prod ? prod.taxRateBps / 100 : it.taxPct,
            }
          : it,
      ),
    );
  };

  // Live deterministic preview calculation
  const preview = items.reduce(
    (acc, it) => {
      const gross = Math.max(0, it.quantity) * Math.max(0, it.unitPrice);
      const disc = Math.min(gross, Math.max(0, it.discount));
      const net = gross - disc;
      const tax =
        Math.round(
          (Math.round(net * 100) * Math.round(Math.max(0, it.taxPct) * 100)) /
            10000,
        ) / 100;
      return {
        subtotal: acc.subtotal + gross,
        discount: acc.discount + disc,
        tax: acc.tax + tax,
        total: acc.total + net + tax,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
  const finalTotal = Math.max(0, preview.total - (Number(orderDiscount) || 0));

  const createDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/sales/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId),
          projectId: projectId ? Number(projectId) : null,
          docType,
          dueDate,
          orderDiscount: Number(orderDiscount) || 0,
          notes,
          items: items.map((it) => ({
            productId: it.productId ? Number(it.productId) : null,
            description: it.description,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            discount: Number(it.discount) || 0,
            taxRateBps: Math.round((Number(it.taxPct) || 0) * 100),
          })),
        }),
      });
      setCreateOpen(false);
      setItems([
        {
          productId: "",
          description: "",
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          taxPct: (session?.tenant.defaultTaxBps || 0) / 100,
        },
      ]);
      setNotes("");
      toast(`Created ${docType.replace("_", " ")}`);
      loadData();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to create document",
        "error",
      );
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    try {
      await apiFetch("/api/sales/invoices", {
        method: "PATCH",
        body: JSON.stringify({
          id: payModal.id,
          action: "record_payment",
          amount: Number(payAmount),
          paymentMethod: payMethod,
        }),
      });
      setPayModal(null);
      toast("Payment recorded & posted to Finance ledger");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Payment error", "error");
    }
  };

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundModal) return;
    try {
      await apiFetch("/api/sales/invoices", {
        method: "PATCH",
        body: JSON.stringify({
          id: refundModal.id,
          action: "refund",
          amount: Number(refundAmount),
          reason: refundReason,
        }),
      });
      setRefundModal(null);
      toast("Refund recorded in the workspace ledger");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Refund error", "error");
    }
  };

  const quickPatch = async (id: number, action: string, okMsg: string) => {
    try {
      await apiFetch("/api/sales/invoices", {
        method: "PATCH",
        body: JSON.stringify({ id, action }),
      });
      toast(okMsg);
      await loadData();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  const onlyInvoices = docs.filter((d) => d.docType === "invoice");
  const billedCents = onlyInvoices.reduce((s, d) => s + d.totalCents, 0);
  const collectedCents = onlyInvoices.reduce(
    (s, d) => s + (d.paidCents - d.refundedCents),
    0,
  );
  const balanceCents = onlyInvoices.reduce((s, d) => s + d.balanceCents, 0);

  return (
    <div>
      <PageHeader
        title="Sales, Orders & Invoicing"
        description="Quotations, sales orders, GST/VAT tax invoices, partial payments, refunds & PDF generation"
        actions={
          can("sales:write") && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="op-btn-primary text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              New Document
            </button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Invoiced Volume"
          value={formatMoney(billedCents, currency)}
          subtext={`${onlyInvoices.length} issued invoice(s)`}
        />
        <StatCard
          label="Net Collected"
          value={formatMoney(collectedCents, currency)}
          subtext="Auto-reconciled with Finance ledger"
          tone="positive"
        />
        <StatCard
          label="Outstanding Receivables"
          value={formatMoney(balanceCents, currency)}
          subtext="Across unpaid & partial invoices"
          tone={balanceCents > 0 ? "warning" : "default"}
        />
      </div>

      <SectionTabs
        tabs={[
          { id: "all", label: "All Documents" },
          { id: "invoice", label: "Invoices" },
          { id: "sales_order", label: "Sales Orders" },
          { id: "quotation", label: "Quotations" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="op-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Document #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance Due</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {docs.map((d) => (
              <tr
                key={d.id}
                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {d.invoiceNumber}
                  </div>
                  <div className="text-[11px] uppercase text-slate-400">
                    {d.docType.replace("_", " ")}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    {d.customerCompany}
                  </div>
                  <div className="text-xs text-slate-500">{d.customerName}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 tabular">
                  <div>Issued: {d.issueDate}</div>
                  <div>Due: {d.dueDate}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={d.status} />
                  {d.reminderCount > 0 && (
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {d.reminderCount} reminder(s)
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular text-slate-900 dark:text-white">
                  {formatMoney(d.totalCents, d.currency)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular text-slate-700 dark:text-slate-300">
                  {formatMoney(d.balanceCents, d.currency)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link
                      href={`/app/sales/${d.id}/print`}
                      title="Print / Download PDF"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Link>

                    {can("sales:write") && d.docType === "quotation" && (
                      <button
                        type="button"
                        onClick={() =>
                          quickPatch(
                            d.id,
                            "convert_to_order",
                            "Converted quotation to Sales Order",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        To Order <ArrowRight className="h-3 w-3" />
                      </button>
                    )}

                    {can("sales:write") && d.docType === "sales_order" && (
                      <button
                        type="button"
                        onClick={() =>
                          quickPatch(
                            d.id,
                            "convert_to_invoice",
                            "Converted sales order to Invoice",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300"
                      >
                        To Invoice <ArrowRight className="h-3 w-3" />
                      </button>
                    )}

                    {can("sales:write") &&
                      d.docType === "invoice" &&
                      d.balanceCents > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPayModal(d);
                              setPayAmount(String(d.balanceCents / 100));
                            }}
                            title="Record payment received"
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 dark:bg-indigo-600"
                          >
                            <CreditCard className="h-3 w-3" />
                            Record payment
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              quickPatch(
                                d.id,
                                "send_reminder",
                                `Internal reminder created for ${d.invoiceNumber}`,
                              )
                            }
                            title="Create internal reminder"
                            className="rounded-lg border border-slate-200 p-1.5 text-amber-600 hover:bg-amber-50 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <Bell className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                    {can("sales:refund") &&
                      d.docType === "invoice" &&
                      d.paidCents - d.refundedCents > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRefundModal(d);
                            setRefundAmount(
                              String((d.paidCents - d.refundedCents) / 100),
                            );
                          }}
                          title="Issue Refund"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-xs text-slate-500"
                >
                  No sales documents in this view yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invoice / Order / Quotation Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Invoice, Sales Order or Quotation"
        subtitle="Uses deterministic integer-cents discount and tax calculation"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={createDocument} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="sales-field-1" className="op-label">
                Document Type
              </label>
              <select
                id="sales-field-1"
                value={docType}
                onChange={(e) =>
                  setDocType(
                    e.target.value as "quotation" | "sales_order" | "invoice",
                  )
                }
                className="op-input"
              >
                <option value="invoice">Tax Invoice</option>
                <option value="sales_order">Sales Order</option>
                <option value="quotation">Quotation</option>
              </select>
            </div>
            <div>
              <label htmlFor="sales-field-2" className="op-label">
                Customer
              </label>
              <select
                id="sales-field-2"
                required
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setProjectId("");
                }}
                className="op-input"
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company} ({c.name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="invoice-project" className="op-label">
                Client project (optional)
              </label>
              <select
                id="invoice-project"
                className="op-input"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Unallocated</option>
                {projectOptions
                  .filter((p) => p.customerId === Number(customerId))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="sales-field-3" className="op-label">
                Due / Valid Until
              </label>
              <input
                id="sales-field-3"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="op-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Line Items
              </label>
              <button
                type="button"
                onClick={() =>
                  setItems([
                    ...items,
                    {
                      productId: "",
                      description: "",
                      quantity: 1,
                      unitPrice: 0,
                      discount: 0,
                      taxPct: (session?.tenant.defaultTaxBps || 0) / 100,
                    },
                  ])
                }
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                + Add line
              </button>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 sm:grid-cols-12 dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="sm:col-span-5 space-y-1.5">
                  <select
                    value={item.productId}
                    onChange={(e) => selectProduct(idx, e.target.value)}
                    className="op-input text-xs py-1.5"
                  >
                    <option value="">Custom item or pick catalog SKU…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    value={item.description}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Item description"
                    className="op-input text-xs py-1.5"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-slate-500">Qty</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, quantity: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="op-input text-xs py-1.5 tabular"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-slate-500">Rate</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={item.unitPrice}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, unitPrice: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="op-input text-xs py-1.5 tabular"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-slate-500">Tax %</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={item.taxPct}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, taxPct: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="op-input text-xs py-1.5 tabular"
                  />
                </div>
                <div className="sm:col-span-1 flex items-end justify-end">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setItems(items.filter((_, i) => i !== idx))
                      }
                      className="rounded p-1.5 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="op-label">Order Discount ({currency})</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={orderDiscount}
                onChange={(e) => setOrderDiscount(e.target.value)}
                className="op-input tabular"
              />
              <label htmlFor="sales-field-4" className="op-label mt-2">
                Notes / Payment Terms
              </label>
              <input
                id="sales-field-4"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Net 15 · Wire / UPI accepted"
                className="op-input"
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5 tabular dark:border-slate-800 dark:bg-slate-900">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal</span>
                <span>
                  {formatMoney(Math.round(preview.subtotal * 100), currency)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Tax ({session?.tenant.taxLabel || "GST"})</span>
                <span>
                  {formatMoney(Math.round(preview.tax * 100), currency)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Discount</span>
                <span>
                  -
                  {formatMoney(
                    Math.round(
                      (preview.discount + (Number(orderDiscount) || 0)) * 100,
                    ),
                    currency,
                  )}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                <span>Total Payable</span>
                <span>
                  {formatMoney(Math.round(finalTotal * 100), currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Issue Document
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Partial / Full Payment Modal */}
      <Modal
        open={Boolean(payModal)}
        onClose={() => setPayModal(null)}
        title={`Record Payment — ${payModal?.invoiceNumber || ""}`}
        subtitle={
          payModal
            ? `Remaining balance: ${formatMoney(payModal.balanceCents, payModal.currency)}. Record money already received; this does not charge the client.`
            : ""
        }
      >
        <form onSubmit={submitPayment} className="space-y-3.5">
          <div>
            <label htmlFor="invoice-payment-amount" className="op-label">
              Payment Amount ({payModal?.currency}) — supports partial or full
            </label>
            <input
              type="number"
              required
              step="0.01"
              min="0.01"
              id="invoice-payment-amount"
              max={payModal ? payModal.balanceCents / 100 : undefined}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              className="op-input tabular"
            />
          </div>
          <div>
            <label htmlFor="sales-field-5" className="op-label">
              Payment Method
            </label>
            <select
              id="sales-field-5"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              className="op-input"
            >
              <option>RTGS / Bank Transfer</option>
              <option>UPI / IMPS</option>
              <option>Corporate Card</option>
              <option>Cheque</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPayModal(null)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Confirm Payment
            </button>
          </div>
        </form>
      </Modal>

      {/* Refund Modal */}
      <Modal
        open={Boolean(refundModal)}
        onClose={() => setRefundModal(null)}
        title={`Issue Refund — ${refundModal?.invoiceNumber || ""}`}
        subtitle="Records a refund in the ledger; this does not move money"
      >
        <form onSubmit={submitRefund} className="space-y-3.5">
          <div>
            <label className="op-label">
              Refund Amount ({refundModal?.currency})
            </label>
            <input
              type="number"
              required
              step="0.01"
              min="0.01"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="op-input tabular"
            />
          </div>
          <div>
            <label htmlFor="sales-field-6" className="op-label">
              Reason for Refund
            </label>
            <input
              id="sales-field-6"
              required
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. Service credit adjustment"
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRefundModal(null)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Process Refund
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
