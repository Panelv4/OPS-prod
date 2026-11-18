"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { formatMoney } from "@/lib/finance";

interface PayslipData {
  payslip: {
    id: number;
    period: string;
    jurisdiction: string;
    statutoryLabel: string;
    baseSalaryCents: number;
    allowancesCents: number;
    statutoryDeductionCents: number;
    taxDeductionCents: number;
    netPayCents: number;
    status: string;
  };
  employee: {
    employeeCode: string;
    fullName: string;
    department: string;
    designation: string;
    joiningDate: string;
    email: string;
  };
  tenant: {
    name: string;
    address: string | null;
    taxId: string | null;
    currency: string;
  };
}

export default function PayslipPage() {
  const params = useParams();
  const { apiFetch } = useWorkspace();
  const [data, setData] = useState<PayslipData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch<PayslipData>(`/api/hrms?payslipId=${params.id}`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Error"));
  }, [apiFetch, params.id]);

  if (err) return <div className="p-10 text-center text-sm text-red-600">{err}</div>;
  if (!data) return <div className="p-10 text-center text-sm text-slate-500">Loading payslip…</div>;

  const { payslip: p, employee: e, tenant: t } = data;
  const gross = p.baseSalaryCents + p.allowancesCents;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 print:bg-white print:p-0 dark:bg-slate-950">
      <div className="no-print mx-auto mb-4 flex max-w-2xl items-center justify-between">
        <Link href="/app/hrms" className="op-btn-secondary text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to HRMS
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="op-btn-primary text-xs"
        >
          <Printer className="h-3.5 w-3.5" /> Print Payslip
        </button>
      </div>

      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-slate-900 shadow-sm print:border-0 print:shadow-none">
        <div className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div>
            <OpsPilotLogo size="sm" />
            <div className="mt-2 text-sm font-semibold">{t.name}</div>
            <div className="text-xs text-slate-500">{t.address}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Confidential Payslip
            </div>
            <div className="mt-1 text-lg font-bold tabular">{p.period}</div>
            <div className="text-xs text-slate-500">
              Jurisdiction: {p.jurisdiction} · {p.status.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500">Employee:</span>{" "}
            <strong className="ml-1">{e.fullName}</strong> ({e.employeeCode})
          </div>
          <div>
            <span className="text-slate-500">Department:</span>{" "}
            <strong className="ml-1">{e.department}</strong>
          </div>
          <div>
            <span className="text-slate-500">Designation:</span>{" "}
            <strong className="ml-1">{e.designation}</strong>
          </div>
          <div>
            <span className="text-slate-500">Joined:</span>{" "}
            <strong className="ml-1">{e.joiningDate}</strong>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 border-t border-slate-200 pt-5 text-xs tabular">
          <div className="space-y-2">
            <div className="font-semibold uppercase text-slate-400">Earnings</div>
            <div className="flex justify-between">
              <span>Base Salary</span>
              <span>{formatMoney(p.baseSalaryCents, t.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>HRA & Allowances</span>
              <span>{formatMoney(p.allowancesCents, t.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <span>Gross Earnings</span>
              <span>{formatMoney(gross, t.currency)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="font-semibold uppercase text-slate-400">Deductions</div>
            <div className="flex justify-between">
              <span>{p.statutoryLabel}</span>
              <span>-{formatMoney(p.statutoryDeductionCents, t.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>Income Tax Withholding</span>
              <span>-{formatMoney(p.taxDeductionCents, t.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <span>Total Deductions</span>
              <span>
                -
                {formatMoney(
                  p.statutoryDeductionCents + p.taxDeductionCents,
                  t.currency
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-xl bg-slate-900 px-5 py-4 text-white tabular">
          <span className="text-xs font-semibold uppercase tracking-wider">
            Net Take-Home Pay
          </span>
          <span className="text-xl font-bold">
            {formatMoney(p.netPayCents, t.currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
