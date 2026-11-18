"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { formatBytes, PageHeader, StatCard } from "@/components/ui/primitives";
import type { PlanDefinition } from "@/lib/permissions";

interface BillingPayload {
  currentPlan: string;
  billingStatus: string;
  mode: "test" | "off";
  hasCustomer: boolean;
  plans: PlanDefinition[];
  invoices: {
    id: string;
    amountCents: number;
    refundedCents: number;
    currency: string;
    periodEnd: string;
  }[];
  usage: {
    seatsUsed: number;
    seatsLimit: number;
    workflowsUsed: number;
    workflowsLimit: number;
    aiTokensUsed: number;
    aiTokensLimit: number;
    storageBytesUsed: number;
    apiCallsCount: number;
  };
  history: Array<{
    id: number;
    previousPlan: string;
    newPlan: string;
    amountInr: number;
    description: string;
    actorName: string;
    createdAt: string;
  }>;
}

export default function BillingPage() {
  const { apiFetch, toast, can } = useWorkspace();
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const res = await apiFetch<BillingPayload>("/api/billing");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    }
  }, [apiFetch]);

  useLoadEffect(load, 0, can("workspace:billing"));

  const openHosted = async (plan?: string) => {
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing", {
        method: "POST",
        body: JSON.stringify(
          plan ? { action: "checkout", plan } : { action: "portal" },
        ),
      });
      window.location.assign(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not open billing", "error");
    }
  };
  if (!can("workspace:billing"))
    return <p>Only the workspace owner can view billing.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!data) {
    return <div className="text-xs text-slate-500">Loading billing…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing, Usage & Commercial Plans"
        description={
          data.mode === "test"
            ? "Stripe sandbox only. No real charges. Plan changes require confirmed settlement."
            : "Paid checkout is disabled. Prices below are proposals, not an offer to charge."
        }
        actions={
          data.mode === "test" &&
          data.hasCustomer && (
            <button className="op-btn-secondary" onClick={() => openHosted()}>
              Manage test subscription
            </button>
          )
        }
      />

      {/* Tenant Usage Telemetry */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Team Seats"
          value={`${data.usage.seatsUsed} / ${data.usage.seatsLimit}`}
          subtext={`Active plan: ${data.currentPlan.toUpperCase()}`}
        />
        <StatCard
          label="AI Token Meter"
          value={data.usage.aiTokensUsed.toLocaleString()}
          subtext={`Limit: ${data.usage.aiTokensLimit.toLocaleString()} / mo`}
        />
        <StatCard
          label="Workflows Configured"
          value={`${data.usage.workflowsUsed} / ${data.usage.workflowsLimit}`}
          subtext="Event & scheduled automations"
        />
        <StatCard
          label="Vault Storage & API"
          value={formatBytes(data.usage.storageBytesUsed)}
          subtext={`${data.usage.apiCallsCount.toLocaleString()} workspace API calls`}
        />
      </div>

      {/* Plans Grid */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {data.plans.map((p) => {
          const isCurrent = p.id === data.currentPlan;
          return (
            <div
              key={p.id}
              className={`flex flex-col rounded-2xl border p-5 ${
                isCurrent
                  ? "border-indigo-600 ring-1 ring-indigo-600 bg-white dark:bg-[#111827]"
                  : "border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {p.name}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-3 text-2xl font-bold tabular text-slate-900 dark:text-white">
                {p.priceDisplay}
              </div>
              <div className="text-[11px] text-slate-500">{p.period}</div>
              <ul className="mt-4 flex-1 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {data.mode === "test" && p.id !== "community" && (
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => openHosted(p.id)}
                  className={`mt-5 h-9 rounded-lg text-xs font-semibold ${
                    isCurrent
                      ? "bg-slate-100 text-slate-400 cursor-default dark:bg-slate-800"
                      : "op-btn-primary w-full"
                  }`}
                >
                  {isCurrent
                    ? "Active Plan"
                    : p.id === "custom"
                      ? "Request Custom"
                      : `Select ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-ons & History */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="op-card p-5">
          <h3 className="text-sm font-semibold">
            Subscription invoices (test mode)
          </h3>
          {!data.invoices.length && (
            <p className="mt-3 text-xs text-slate-500">No verified payments.</p>
          )}
          {data.invoices.map((i) => (
            <p key={i.id} className="py-2 text-xs">
              {i.id} · USD {(i.amountCents / 100).toFixed(2)} · refunded{" "}
              {(i.refundedCents / 100).toFixed(2)}
            </p>
          ))}
        </div>
        <div className="op-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
            Subscription Audit History
          </h3>
          <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
            {data.history.map((h) => (
              <div key={h.id} className="py-2.5">
                <div className="font-medium text-slate-900 dark:text-white">
                  {h.description}
                </div>
                <div className="text-[11px] text-slate-500">
                  {h.actorName} · {new Date(h.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
            {data.history.length === 0 && (
              <p className="py-4 text-slate-500">
                No plan changes recorded yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
