"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Sparkles,
  Play,
  CheckCircle2,
  Power,
  RefreshCw,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatusPill,
} from "@/components/ui/primitives";
import type { WorkflowAction, WorkflowCondition } from "@/db/schema";

interface AutomationPayload {
  triggers: Array<{ id: string; label: string }>;
  canWrite: boolean;
  canApprove: boolean;
  workflows: Array<{
    id: number;
    name: string;
    description: string | null;
    triggerEvent: string;
    scheduleExpression: string | null;
    conditions: WorkflowCondition[];
    actions: WorkflowAction[];
    approvalStatus: string;
    approvedByName: string | null;
    isEnabled: boolean;
    generatedByAi: boolean;
    retryLimit: number;
    runCount: number;
    lastRunAt: string | null;
  }>;
  executions: Array<{
    id: number;
    workflowId: number;
    workflowName: string;
    triggerEvent: string;
    status: string;
    attemptCount: number;
    stepLogs: Array<{
      step: string;
      status: string;
      detail: string;
      at: string;
    }>;
    startedAt: string;
  }>;
}

export default function AutomationsPage() {
  const { apiFetch, toast, refreshSession } = useWorkspace();
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [tab, setTab] = useState("workflows");

  const [nlPrompt, setNlPrompt] = useState("");
  const [visualOpen, setVisualOpen] = useState(false);

  const [wfForm, setWfForm] = useState({
    name: "",
    description: "",
    triggerEvent: "lead.created",
    retryLimit: 2,
    condField: "",
    condValue: "",
    delayMinutes: 0,
    actionType: "notify" as WorkflowAction["type"],
    targetRole: "manager",
    actionTitle: "OpsPilot Automated Alert",
    actionMessage: "Triggered by {{title}} ({{company}})",
    requireApprovalStep: false,
  });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<AutomationPayload>("/api/automations");
      setData(res);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load automations",
        "error",
      );
    }
  }, [apiFetch, toast]);

  useLoadEffect(load);

  const generateFromNl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlPrompt.trim()) return;
    try {
      await apiFetch("/api/automations", {
        method: "POST",
        body: JSON.stringify({ mode: "natural_language", prompt: nlPrompt }),
      });
      setNlPrompt("");
      toast("AI generated workflow draft — approve below to activate");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Draft error", "error");
    }
  };

  const createVisual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const conditions: WorkflowCondition[] = wfForm.condField.trim()
        ? [
            {
              field: wfForm.condField.trim(),
              operator: "eq",
              value: wfForm.condValue.trim(),
            },
          ]
        : [];
      const actions: WorkflowAction[] = [];
      if (wfForm.delayMinutes > 0) {
        actions.push({ type: "delay", delayMinutes: wfForm.delayMinutes });
      }
      actions.push({
        type: wfForm.actionType,
        targetRole: wfForm.targetRole,
        title: wfForm.actionTitle,
        message: wfForm.actionMessage,
      });
      if (wfForm.requireApprovalStep) {
        actions.unshift({
          type: "require_approval",
          targetRole: "manager",
          message: "Human checkpoint before performing actions",
        });
      }

      await apiFetch("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          mode: "visual",
          name: wfForm.name,
          description: wfForm.description,
          triggerEvent: wfForm.triggerEvent,
          retryLimit: wfForm.retryLimit,
          conditions,
          actions,
        }),
      });
      setVisualOpen(false);
      setWfForm((p) => ({ ...p, name: "", description: "" }));
      toast("Workflow created — awaiting approval before activation");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const patchWf = async (payload: Record<string, unknown>, msg: string) => {
    try {
      await apiFetch("/api/automations", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast(msg);
      await load();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  const deleteWf = async (id: number) => {
    try {
      await apiFetch(`/api/automations?id=${id}`, { method: "DELETE" });
      toast("Workflow deleted");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  if (!data) {
    return (
      <div className="text-xs text-slate-500">Loading automation engine…</div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workflow Automation Engine"
        description="Visual event & scheduled workflows with conditions, delays, retries, approval gates & AI draft builder"
        actions={
          data.canWrite && (
            <>
              <button
                type="button"
                onClick={() =>
                  patchWf(
                    { action: "run_scheduled_sweep" },
                    "Checked for due events. Matching workflows are queued.",
                  )
                }
                className="op-btn-secondary text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Run Health Sweep
              </button>
              <button
                type="button"
                onClick={() => setVisualOpen(true)}
                className="op-btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Visual Builder
              </button>
            </>
          )
        }
      />

      {/* Natural Language AI Workflow Builder */}
      {data.canWrite && (
        <form
          onSubmit={generateFromNl}
          className="op-card flex flex-col gap-2.5 p-4 sm:flex-row sm:items-center"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <input
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder="Describe a workflow in plain English, e.g. 'When stock falls below threshold wait 15 minutes, notify manager and create a task'"
            className="op-input text-xs flex-1"
          />
          <button type="submit" className="op-btn-primary text-xs shrink-0">
            Generate AI Draft
          </button>
        </form>
      )}

      <SectionTabs
        tabs={[
          { id: "workflows", label: "Workflows", count: data.workflows.length },
          {
            id: "executions",
            label: "Execution History",
            count: data.executions.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "workflows" ? (
        <div className="space-y-3.5">
          {data.workflows.map((wf) => (
            <div key={wf.id} className="op-card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {wf.name}
                    </h3>
                    <StatusPill status={wf.approvalStatus} />
                    {wf.isEnabled ? (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        ACTIVE
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        PAUSED
                      </span>
                    )}
                    {wf.generatedByAi && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        AI Draft
                      </span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="mt-1 text-xs text-slate-500">
                      {wf.description}
                    </p>
                  )}
                </div>

                {/* Governance & Runtime Controls */}
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {data.canApprove && wf.approvalStatus !== "approved" && (
                    <button
                      type="button"
                      onClick={() =>
                        patchWf(
                          {
                            action: "approve",
                            id: wf.id,
                            enableImmediately: true,
                          },
                          `Approved & activated "${wf.name}"`,
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve &
                      Activate
                    </button>
                  )}

                  {data.canWrite && wf.approvalStatus === "approved" && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          patchWf(
                            {
                              action: "toggle",
                              id: wf.id,
                              isEnabled: !wf.isEnabled,
                            },
                            wf.isEnabled
                              ? "Workflow paused"
                              : "Workflow enabled",
                          )
                        }
                        className="op-btn-secondary py-1 px-2.5 text-xs"
                      >
                        <Power className="h-3 w-3" />
                        {wf.isEnabled ? "Disable" : "Enable"}
                      </button>
                      {wf.isEnabled && (
                        <button
                          type="button"
                          onClick={() =>
                            patchWf(
                              { action: "test_run", id: wf.id },
                              `Preview: ${wf.actions.map((a) => a.type.replaceAll("_", " ")).join(" → ")}. Nothing was enqueued.`,
                            )
                          }
                          className="op-btn-primary py-1 px-2.5 text-xs"
                        >
                          <Play className="h-3 w-3" /> Preview steps
                        </button>
                      )}
                    </>
                  )}

                  {data.canWrite && (
                    <button
                      type="button"
                      onClick={() => deleteWf(wf.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-800"
                      title="Delete workflow"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Visual Flow Pipeline */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <div className="rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 font-mono text-[11px] font-medium text-white dark:border-indigo-700 dark:bg-indigo-950">
                  WHEN {wf.triggerEvent}
                </div>
                {(wf.conditions || []).map((c, idx) => (
                  <React.Fragment key={idx}>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      IF {c.field} {c.operator} {c.value}
                    </div>
                  </React.Fragment>
                ))}
                {wf.actions.map((a, idx) => (
                  <React.Fragment key={idx}>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                      THEN {a.type.replace(/_/g, " ")}
                      {a.delayMinutes ? ` (${a.delayMinutes}m)` : ""}
                      {a.targetRole ? ` → ${a.targetRole}` : ""}
                    </div>
                  </React.Fragment>
                ))}
              </div>

              <div className="mt-3 text-[11px] text-slate-400 tabular">
                Runs: {wf.runCount} · Max retries: {wf.retryLimit}
                {wf.approvedByName ? ` · Approved by ${wf.approvedByName}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.executions.map((ex) => (
            <div key={ex.id} className="op-card p-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {ex.workflowName}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-slate-400">
                    {ex.triggerEvent} · Attempt #{ex.attemptCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={ex.status} />
                  {data.canApprove && ex.status === "awaiting_approval" && (
                    <button
                      type="button"
                      onClick={() =>
                        patchWf(
                          { action: "approve_execution", executionId: ex.id },
                          "Approved; the worker can continue.",
                        )
                      }
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      Approve Step
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                {(ex.stepLogs || []).map((log, i) => (
                  <div
                    key={i}
                    className="text-[11px] text-slate-600 dark:text-slate-400"
                  >
                    <strong>{log.step}:</strong> {log.detail}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Visual Workflow Builder Modal */}
      <Modal
        open={visualOpen}
        onClose={() => setVisualOpen(false)}
        title="Visual Workflow Builder"
        subtitle="New workflows require explicit approval before activation"
      >
        <form onSubmit={createVisual} className="space-y-3">
          <div>
            <label htmlFor="automations-field-1" className="op-label">
              Workflow Name
            </label>
            <input
              id="automations-field-1"
              required
              value={wfForm.name}
              onChange={(e) => setWfForm({ ...wfForm, name: e.target.value })}
              placeholder="e.g. High-Value Lead Rapid Escalation"
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="automations-field-2" className="op-label">
                WHEN Trigger Event
              </label>
              <select
                id="automations-field-2"
                value={wfForm.triggerEvent}
                onChange={(e) =>
                  setWfForm({ ...wfForm, triggerEvent: e.target.value })
                }
                className="op-input text-xs"
              >
                {data.triggers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="automations-field-3" className="op-label">
                Retry Attempts on Failure
              </label>
              <input
                id="automations-field-3"
                type="number"
                min="0"
                max="5"
                value={wfForm.retryLimit}
                onChange={(e) =>
                  setWfForm({ ...wfForm, retryLimit: Number(e.target.value) })
                }
                className="op-input tabular"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="automations-field-4" className="op-label">
                Optional Condition Field
              </label>
              <input
                id="automations-field-4"
                value={wfForm.condField}
                onChange={(e) =>
                  setWfForm({ ...wfForm, condField: e.target.value })
                }
                placeholder="e.g. priority"
                className="op-input text-xs"
              />
            </div>
            <div>
              <label htmlFor="automations-field-5" className="op-label">
                Condition Equals
              </label>
              <input
                id="automations-field-5"
                value={wfForm.condValue}
                onChange={(e) =>
                  setWfForm({ ...wfForm, condValue: e.target.value })
                }
                placeholder="e.g. urgent"
                className="op-input text-xs"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="automations-field-6" className="op-label">
                THEN Primary Action
              </label>
              <select
                id="automations-field-6"
                value={wfForm.actionType}
                onChange={(e) =>
                  setWfForm({
                    ...wfForm,
                    actionType: e.target.value as WorkflowAction["type"],
                  })
                }
                className="op-input text-xs"
              >
                <option value="notify">Notify Role</option>
                <option value="create_task">Create Task</option>
                <option value="send_invoice_reminder">Invoice Reminder</option>
                <option value="log_audit">Compliance Audit Log</option>
              </select>
            </div>
            <div>
              <label htmlFor="automations-field-7" className="op-label">
                Target Role
              </label>
              <select
                id="automations-field-7"
                value={wfForm.targetRole}
                onChange={(e) =>
                  setWfForm({ ...wfForm, targetRole: e.target.value })
                }
                className="op-input text-xs"
              >
                <option value="salesperson">Salesperson</option>
                <option value="manager">Manager</option>
                <option value="accountant">Accountant</option>
                <option value="hr_manager">HR Manager</option>
                <option value="employee">Employee</option>
              </select>
            </div>
            <div>
              <label htmlFor="automations-field-8" className="op-label">
                Delay (Minutes)
              </label>
              <input
                id="automations-field-8"
                type="number"
                min="0"
                value={wfForm.delayMinutes}
                onChange={(e) =>
                  setWfForm({ ...wfForm, delayMinutes: Number(e.target.value) })
                }
                className="op-input tabular text-xs"
              />
            </div>
          </div>
          <div>
            <label htmlFor="automations-field-9" className="op-label">
              Notification / Task Message
            </label>
            <input
              id="automations-field-9"
              required
              value={wfForm.actionMessage}
              onChange={(e) =>
                setWfForm({ ...wfForm, actionMessage: e.target.value })
              }
              className="op-input text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={wfForm.requireApprovalStep}
              onChange={(e) =>
                setWfForm({ ...wfForm, requireApprovalStep: e.target.checked })
              }
              className="rounded accent-indigo-600"
            />
            Add manager approval step during execution
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setVisualOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Save Draft
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
