"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  UserPlus,
  Clock,
  CalendarDays,
  Check,
  X,
  FileSpreadsheet,
  Lock,
  Printer,
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

interface HrmsPayload {
  currency: string;
  canConfidential: boolean;
  canPayroll: boolean;
  canWrite: boolean;
  jurisdictions: Array<{ code: string; name: string; statutoryLabel: string }>;
  employees: Array<{
    id: number;
    employeeCode: string;
    fullName: string;
    email: string;
    phone: string | null;
    department: string;
    designation: string;
    joiningDate: string;
    employmentStatus: string;
    managerName: string | null;
    jurisdiction: string;
    baseSalaryCents: number;
    allowancesCents: number;
    leaveBalanceAnnual: number;
    leaveBalanceSick: number;
    salaryRedacted: boolean;
  }>;
  attendance: Array<{
    id: number;
    employeeId: number;
    employeeName: string;
    department: string;
    date: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    status: string;
    workMinutes: number;
    notes: string | null;
  }>;
  leaves: Array<{
    id: number;
    employeeId: number;
    employeeName: string;
    department: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
    status: string;
    reviewerName: string | null;
  }>;
  payroll: Array<{
    id: number;
    employeeName: string;
    employeeCode: string;
    department: string;
    period: string;
    jurisdiction: string;
    statutoryLabel: string;
    baseSalaryCents: number;
    allowancesCents: number;
    statutoryDeductionCents: number;
    taxDeductionCents: number;
    netPayCents: number;
    status: string;
  }>;
}

const emptyEmployeeForm = {
  fullName: "",
  email: "",
  phone: "",
  department: "Engineering",
  designation: "Software Engineer",
  managerName: "",
  jurisdiction: "",
  baseSalary: "",
  allowances: "0",
  taxRateBps: "",
  confidentialNotes: "",
};

export default function HrmsPage() {
  const searchParams = useSearchParams();
  const { apiFetch, toast, refreshSession } = useWorkspace();
  const [data, setData] = useState<HrmsPayload | null>(null);
  const [tab, setTab] = useState("employees");

  const [empModal, setEmpModal] = useState(
    searchParams.get("new") === "employee",
  );
  const [leaveModal, setLeaveModal] = useState(false);
  const [payrollModal, setPayrollModal] = useState(false);

  const [empForm, setEmpForm] = useState(emptyEmployeeForm);

  const [attEmpId, setAttEmpId] = useState("");
  const [leaveForm, setLeaveForm] = useState(() => ({
    employeeId: "",
    leaveType: "annual",
    startDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
    days: 2,
    reason: "",
  }));
  const [payrollPeriod, setPayrollPeriod] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [payrollJurisdiction, setPayrollJurisdiction] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<HrmsPayload>("/api/hrms");
      setData(res);
      if (!attEmpId && res.employees[0]) {
        setAttEmpId(String(res.employees[0].id));
        setLeaveForm((p) => ({
          ...p,
          employeeId: String(res.employees[0].id),
        }));
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load HRMS",
        "error",
      );
    }
  }, [apiFetch, attEmpId, toast]);

  useLoadEffect(load);

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/hrms", {
        method: "POST",
        body: JSON.stringify({
          action: "create_employee",
          ...empForm,
          baseSalary: Number(empForm.baseSalary) || 0,
          allowances: Number(empForm.allowances) || 0,
          taxRateBps: Number(empForm.taxRateBps),
        }),
      });
      setEmpModal(false);
      setEmpForm(emptyEmployeeForm);
      toast("Employee onboarded");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const logAttendance = async (
    mode: "check_in" | "check_out" | "mark_absent",
  ) => {
    if (!attEmpId) return;
    try {
      await apiFetch("/api/hrms", {
        method: "POST",
        body: JSON.stringify({
          action: "attendance",
          employeeId: Number(attEmpId),
          mode,
        }),
      });
      toast(`Attendance recorded (${mode.replace("_", " ")})`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const submitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/hrms", {
        method: "POST",
        body: JSON.stringify({
          action: "request_leave",
          ...leaveForm,
          employeeId: Number(leaveForm.employeeId),
          days: Number(leaveForm.days),
        }),
      });
      setLeaveModal(false);
      setLeaveForm((p) => ({ ...p, reason: "" }));
      toast("Leave application submitted & HR notified");
      await load();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const reviewLeave = async (
    leaveId: number,
    decision: "approved" | "rejected",
  ) => {
    try {
      await apiFetch("/api/hrms", {
        method: "PATCH",
        body: JSON.stringify({ action: "review_leave", leaveId, decision }),
      });
      toast(`Leave request ${decision}`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const processPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ createdCount: number }>("/api/hrms", {
        method: "POST",
        body: JSON.stringify({
          action: "run_payroll",
          period: payrollPeriod,
          jurisdictionOverride: payrollJurisdiction || undefined,
        }),
      });
      setPayrollModal(false);
      toast(`Processed ${res.createdCount} payslip(s) for ${payrollPeriod}`);
      setTab("payroll");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Payroll error", "error");
    }
  };

  const payPayslip = async (payrollId: number) => {
    try {
      await apiFetch("/api/hrms", {
        method: "PATCH",
        body: JSON.stringify({ action: "pay_payslip", payrollId }),
      });
      toast("Salary payment recorded in the ledger; no money was transferred");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  if (!data) {
    return (
      <div className="text-xs text-slate-500">Loading people & payroll…</div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayAtt = data.attendance.filter((a) => a.date === today);
  const pendingLeaves = data.leaves.filter((l) => l.status === "pending");

  return (
    <div>
      <PageHeader
        title="People & payroll estimates"
        description="Estimates use simplified regional rates. Review locally before disbursing pay; this is not accounting or legal advice."
        actions={
          <>
            <button
              type="button"
              onClick={() => setLeaveModal(true)}
              className="op-btn-secondary text-xs"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Apply Leave
            </button>
            {data.canPayroll && (
              <button
                type="button"
                onClick={() => setPayrollModal(true)}
                className="op-btn-secondary text-xs"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Run Payroll
              </button>
            )}
            {data.canWrite && (
              <button
                type="button"
                onClick={() => setEmpModal(true)}
                className="op-btn-primary text-xs"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add Employee
              </button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Headcount"
          value={
            data.employees.filter((e) => e.employmentStatus === "active").length
          }
          subtext={`${data.employees.length} total employee records`}
        />
        <StatCard
          label="Checked In Today"
          value={todayAtt.filter((a) => a.status !== "absent").length}
          subtext={`${todayAtt.filter((a) => a.status === "late").length} late arrival(s)`}
          tone="positive"
        />
        <StatCard
          label="Pending Leave Requests"
          value={pendingLeaves.length}
          subtext="Awaiting HR / Manager approval"
          tone={pendingLeaves.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Payslips Generated"
          value={data.canConfidential ? data.payroll.length : "Restricted"}
          subtext="Jurisdiction statutory rules active"
        />
      </div>

      <SectionTabs
        tabs={[
          { id: "employees", label: "Employees", count: data.employees.length },
          {
            id: "attendance",
            label: "Attendance",
            count: data.attendance.length,
          },
          {
            id: "leaves",
            label: "Leave & Calendar",
            count: data.leaves.length,
          },
          ...(data.canConfidential
            ? [
                {
                  id: "payroll",
                  label: "Payroll & Payslips",
                  count: data.payroll.length,
                },
              ]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "employees" && (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department & Role</th>
                <th className="px-4 py-3">Manager</th>
                <th className="px-4 py-3">Leave Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Monthly Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.employees.map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-white">
                      {e.fullName}{" "}
                      <span className="text-xs font-mono text-slate-400">
                        {e.employeeCode}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {e.email} · Joined {e.joiningDate}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {e.designation}
                    </div>
                    <div className="text-slate-500">
                      {e.department} · {e.jurisdiction}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    {e.managerName || "Board"}
                  </td>
                  <td className="px-4 py-3 text-xs tabular">
                    {e.leaveBalanceAnnual}d annual · {e.leaveBalanceSick}d sick
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={e.employmentStatus} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold tabular">
                    {e.salaryRedacted ? (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <Lock className="h-3 w-3" /> Confidential
                      </span>
                    ) : (
                      formatMoney(
                        e.baseSalaryCents + e.allowancesCents,
                        data.currency,
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "attendance" && (
        <div className="space-y-4">
          <div className="op-card flex flex-wrap items-center gap-3 p-4">
            <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <select
              value={attEmpId}
              onChange={(e) => setAttEmpId(e.target.value)}
              className="op-input w-auto text-xs"
            >
              {data.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} ({e.employeeCode})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => logAttendance("check_in")}
              className="op-btn-primary text-xs py-1.5"
            >
              Check In
            </button>
            <button
              type="button"
              onClick={() => logAttendance("check_out")}
              className="op-btn-secondary text-xs py-1.5"
            >
              Check Out
            </button>
            {data.canWrite && (
              <button
                type="button"
                onClick={() => logAttendance("mark_absent")}
                className="op-btn-secondary text-xs py-1.5 text-red-600"
              >
                Mark Absent
              </button>
            )}
          </div>

          <div className="op-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Check Out</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {data.attendance.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 tabular font-medium">{a.date}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {a.employeeName}
                      </span>{" "}
                      <span className="text-slate-400">· {a.department}</span>
                    </td>
                    <td className="px-4 py-3 tabular">
                      {a.checkInTime || "—"}
                    </td>
                    <td className="px-4 py-3 tabular">
                      {a.checkOutTime || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {a.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "leaves" && (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Calendar Window</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {data.leaves.map((lv) => (
                <tr key={lv.id}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {lv.employeeName}
                    <div className="text-[11px] font-normal text-slate-500">
                      {lv.department}
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize">{lv.leaveType}</td>
                  <td className="px-4 py-3 tabular">
                    {lv.startDate} → {lv.endDate} ({lv.days}d)
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {lv.reason}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={lv.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {data.canWrite && lv.status === "pending" ? (
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => reviewLeave(lv.id, "approved")}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                        >
                          <Check className="h-3 w-3" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewLeave(lv.id, "rejected")}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900"
                        >
                          <X className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        {lv.reviewerName ? `By ${lv.reviewerName}` : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payroll" && data.canConfidential && (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Jurisdiction</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions & Tax</th>
                <th className="px-4 py-3 text-right">Net Pay</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular">
              {data.payroll.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-semibold">{p.period}</td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {p.employeeName} ({p.employeeCode})
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.jurisdiction}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(
                      p.baseSalaryCents + p.allowancesCents,
                      data.currency,
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    -
                    {formatMoney(
                      p.statutoryDeductionCents + p.taxDeductionCents,
                      data.currency,
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">
                    {formatMoney(p.netPayCents, data.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Link
                        href={`/app/hrms/payslip/${p.id}`}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                        title="View Payslip"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Link>
                      {data.canPayroll && p.status !== "paid" && (
                        <button
                          type="button"
                          onClick={() => payPayslip(p.id)}
                          className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-indigo-600"
                        >
                          Disburse
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Employee Modal */}
      <Modal
        open={empModal}
        onClose={() => setEmpModal(false)}
        title="Onboard Employee"
        subtitle="Salary and confidential records are protected by RBAC"
      >
        <form onSubmit={createEmployee} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="hrms-field-1" className="op-label">
                Full Name
              </label>
              <input
                id="hrms-field-1"
                required
                value={empForm.fullName}
                onChange={(e) =>
                  setEmpForm({ ...empForm, fullName: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="hrms-field-2" className="op-label">
                Work Email
              </label>
              <input
                id="hrms-field-2"
                type="email"
                required
                value={empForm.email}
                onChange={(e) =>
                  setEmpForm({ ...empForm, email: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="hrms-field-3" className="op-label">
                Department
              </label>
              <input
                id="hrms-field-3"
                required
                value={empForm.department}
                onChange={(e) =>
                  setEmpForm({ ...empForm, department: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="hrms-field-4" className="op-label">
                Designation
              </label>
              <input
                id="hrms-field-4"
                required
                value={empForm.designation}
                onChange={(e) =>
                  setEmpForm({ ...empForm, designation: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="hrms-field-5" className="op-label">
                Jurisdiction
              </label>
              <select
                id="hrms-field-5"
                required
                value={empForm.jurisdiction}
                onChange={(e) =>
                  setEmpForm({ ...empForm, jurisdiction: e.target.value })
                }
                className="op-input"
              >
                <option value="" disabled>
                  Choose an estimate profile
                </option>
                {data.jurisdictions.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.code} — {j.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="hrms-field-6" className="op-label">
                Base Salary / mo
              </label>
              <input
                id="hrms-field-6"
                type="number"
                min="0"
                value={empForm.baseSalary}
                onChange={(e) =>
                  setEmpForm({ ...empForm, baseSalary: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label htmlFor="hrms-field-7" className="op-label">
                Allowances / mo
              </label>
              <input
                id="hrms-field-7"
                type="number"
                min="0"
                value={empForm.allowances}
                onChange={(e) =>
                  setEmpForm({ ...empForm, allowances: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
          </div>
          <div>
            <label htmlFor="payroll-estimate-rate" className="op-label">
              Estimated income tax rate (basis points; 100 = 1%)
            </label>
            <input
              id="payroll-estimate-rate"
              required
              className="op-input"
              type="number"
              min="0"
              max="5000"
              value={empForm.taxRateBps}
              onChange={(e) =>
                setEmpForm({ ...empForm, taxRateBps: e.target.value })
              }
            />
            <label htmlFor="hrms-field-8" className="op-label">
              Reporting Manager
            </label>
            <input
              id="hrms-field-8"
              value={empForm.managerName}
              onChange={(e) =>
                setEmpForm({ ...empForm, managerName: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEmpModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Add Employee
            </button>
          </div>
        </form>
      </Modal>

      {/* Apply Leave Modal */}
      <Modal
        open={leaveModal}
        onClose={() => setLeaveModal(false)}
        title="Submit Leave Application"
        subtitle="Automatically routes to HR & Manager via workflow automation"
      >
        <form onSubmit={submitLeave} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="hrms-field-9" className="op-label">
                Employee
              </label>
              <select
                id="hrms-field-9"
                required
                value={leaveForm.employeeId}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, employeeId: e.target.value })
                }
                className="op-input"
              >
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="hrms-field-10" className="op-label">
                Leave Type
              </label>
              <select
                id="hrms-field-10"
                value={leaveForm.leaveType}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, leaveType: e.target.value })
                }
                className="op-input"
              >
                <option value="annual">Annual Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="casual">Casual Leave</option>
                <option value="unpaid">Unpaid Leave</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="hrms-field-11" className="op-label">
                Start Date
              </label>
              <input
                id="hrms-field-11"
                type="date"
                required
                value={leaveForm.startDate}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, startDate: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="hrms-field-12" className="op-label">
                End Date
              </label>
              <input
                id="hrms-field-12"
                type="date"
                required
                value={leaveForm.endDate}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, endDate: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="hrms-field-13" className="op-label">
                Total Days
              </label>
              <input
                id="hrms-field-13"
                type="number"
                min="1"
                required
                value={leaveForm.days}
                onChange={(e) =>
                  setLeaveForm({ ...leaveForm, days: Number(e.target.value) })
                }
                className="op-input tabular"
              />
            </div>
          </div>
          <div>
            <label htmlFor="hrms-field-14" className="op-label">
              Reason
            </label>
            <textarea
              id="hrms-field-14"
              required
              rows={2}
              value={leaveForm.reason}
              onChange={(e) =>
                setLeaveForm({ ...leaveForm, reason: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setLeaveModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Submit Request
            </button>
          </div>
        </form>
      </Modal>

      {/* Run Payroll Modal */}
      <Modal
        open={payrollModal}
        onClose={() => setPayrollModal(false)}
        title="Calculate monthly payroll estimates"
        subtitle="Uses the selected estimate profile and entered rates. Verify with your payroll adviser before recording a payment."
      >
        <form onSubmit={processPayroll} className="space-y-3.5">
          <div>
            <label htmlFor="hrms-field-15" className="op-label">
              Payroll Period (YYYY-MM)
            </label>
            <input
              id="hrms-field-15"
              type="month"
              required
              value={payrollPeriod}
              onChange={(e) => setPayrollPeriod(e.target.value)}
              className="op-input tabular"
            />
          </div>
          <div>
            <label htmlFor="hrms-field-16" className="op-label">
              Jurisdiction Tax Rule
            </label>
            <select
              id="hrms-field-16"
              value={payrollJurisdiction}
              onChange={(e) => setPayrollJurisdiction(e.target.value)}
              className="op-input"
            >
              <option value="">
                Use each employee&apos;s assigned jurisdiction
              </option>
              {data.jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPayrollModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Compute Payslips
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
