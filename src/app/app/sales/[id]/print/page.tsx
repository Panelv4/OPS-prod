"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { formatMoney } from "@/lib/finance";

interface PrintInvoiceData {
  invoice: {
    id: number;
    docType: string;
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
    notes: string | null;
  };
  customer: {
    name: string;
    company: string;
    email: string;
    phone: string | null;
    address: string | null;
  };
  items: Array<{
    id: number;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    taxRateBps: number;
    taxAmountCents: number;
    lineTotalCents: number;
  }>;
  tenant: {
    name: string;
    address: string | null;
    taxId: string | null;
    taxLabel: string;
    currency: string;
    website: string | null;
  };
}

export default function PrintInvoicePage() {
  const params = useParams();
  const { apiFetch } = useWorkspace();
  const [data, setData] = useState<PrintInvoiceData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<PrintInvoiceData>(`/api/sales/invoices?id=${params.id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"));
  }, [apiFetch, params.id]);

  if (error) {
    return <div className="p-10 text-center text-sm text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="p-10 text-center text-sm text-slate-500">Preparing PDF view…</div>;
  }

  const { invoice: inv, customer, items, tenant } = data;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 print:bg-white print:p-0 dark:bg-slate-950">
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between">
        <Link href="/app/sales" className="op-btn-secondary text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Sales
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="op-btn-primary text-xs"
        >
          <Printer className="h-3.5 w-3.5" />
          Print / Save as PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-10 text-slate-900 shadow-sm print:border-0 print:shadow-none">
        <div className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <OpsPilotLogo size="md" />
            <div className="mt-3 text-sm font-semibold">{tenant.name}</div>
            {tenant.address && (
              <div className="text-xs text-slate-500 max-w-xs">{tenant.address}</div>
            )}
            {tenant.taxId && (
              <div className="mt-1 text-xs font-medium text-slate-700">
                {tenant.taxLabel} ID: {tenant.taxId}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs font-bold tracking-widest text-slate-400 uppercase">
              {inv.docType.replace("_", " ")}
            </div>
            <div className="mt-1 text-xl font-bold tabular">{inv.invoiceNumber}</div>
            <div className="mt-2 inline-block rounded-full border border-slate-300 px-2.5 py-0.5 text-xs font-semibold uppercase">
              {inv.status}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 text-xs">
          <div>
            <div className="font-semibold uppercase text-slate-400">Billed To</div>
            <div className="mt-1 text-sm font-semibold">{customer.company}</div>
            <div>{customer.name}</div>
            <div className="text-slate-600">{customer.email}</div>
            {customer.phone && <div className="text-slate-600">{customer.phone}</div>}
            {customer.address && <div className="text-slate-600">{customer.address}</div>}
          </div>
          <div className="text-right space-y-1 tabular">
            <div>
              <span className="text-slate-500">Issue Date: </span>
              <span className="font-semibold">{inv.issueDate}</span>
            </div>
            <div>
              <span className="text-slate-500">Due Date: </span>
              <span className="font-semibold">{inv.dueDate}</span>
            </div>
            <div>
              <span className="text-slate-500">Currency: </span>
              <span className="font-semibold">{inv.currency}</span>
            </div>
          </div>
        </div>

        <table className="mt-8 w-full text-left text-xs tabular">
          <thead className="border-y border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3 text-right">Qty</th>
              <th className="py-2.5 px-3 text-right">Unit Price</th>
              <th className="py-2.5 px-3 text-right">{tenant.taxLabel}</th>
              <th className="py-2.5 px-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it) => (
              <tr key={it.id}>
                <td className="py-3 px-3 font-medium">{it.description}</td>
                <td className="py-3 px-3 text-right">{it.quantity}</td>
                <td className="py-3 px-3 text-right">
                  {formatMoney(it.unitPriceCents, inv.currency)}
                </td>
                <td className="py-3 px-3 text-right">
                  {(it.taxRateBps / 100).toFixed(1)}% (
                  {formatMoney(it.taxAmountCents, inv.currency)})
                </td>
                <td className="py-3 px-3 text-right font-semibold">
                  {formatMoney(it.lineTotalCents, inv.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-72 space-y-1.5 text-xs tabular">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatMoney(inv.subtotalCents, inv.currency)}</span>
            </div>
            {inv.discountCents > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span>-{formatMoney(inv.discountCents, inv.currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">{tenant.taxLabel} Total</span>
              <span>{formatMoney(inv.taxCents, inv.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold">
              <span>Grand Total</span>
              <span>{formatMoney(inv.totalCents, inv.currency)}</span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>Amount Paid</span>
              <span>{formatMoney(inv.paidCents - inv.refundedCents, inv.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-900 pt-2 text-sm font-bold">
              <span>Balance Due</span>
              <span>{formatMoney(inv.balanceCents, inv.currency)}</span>
            </div>
          </div>
        </div>

        {inv.notes && (
          <div className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Notes: </span>
            {inv.notes}
          </div>
        )}
      </div>
    </div>
  );
}
