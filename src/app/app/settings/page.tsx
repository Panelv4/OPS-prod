"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import { UserPlus, Copy, Save } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatusPill,
} from "@/components/ui/primitives";
import type { WorkspaceRole } from "@/db/schema";

interface WorkspacePayload {
  workspace: {
    id: number;
    name: string;
    slug: string;
    industry: string;
    currency: string;
    jurisdiction: string;
    taxLabel: string;
    defaultTaxBps: number;
    taxId: string | null;
    address: string | null;
    website: string | null;
  };
  members: Array<{
    id: number;
    userId: number;
    fullName: string;
    email: string;
    role: WorkspaceRole;
    title: string | null;
    status: string;
  }>;
  invitations: Array<{
    id: number;
    email: string;
    role: WorkspaceRole;
    status: string;
    expiresAt: string;
  }>;
  rolePermissions: Record<string, string[]>;
  allRoles: Array<{ id: WorkspaceRole; label: string; description: string }>;
  allPermissions: string[];
  auditLogs: Array<{
    id: number;
    actorName: string;
    action: string;
    module: string;
    summary: string;
    createdAt: string;
  }>;
}

export default function SettingsPage() {
  const { session, apiFetch, can, toast, refreshSession } = useWorkspace();
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [tab, setTab] = useState("workspace");

  const [wsForm, setWsForm] = useState({
    name: "",
    industry: "",
    currency: "INR",
    jurisdiction: "IN",
    taxLabel: "GST",
    defaultTaxBps: 1800,
    taxId: "",
    address: "",
    website: "",
  });

  const [joinCode, setJoinCode] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<WorkspaceRole>("employee");

  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>("manager");
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});

  // Account settings
  const [acctName, setAcctName] = useState(session?.user.fullName || "");
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [prefs, setPrefs] = useState(
    session?.user.notificationPrefs || {
      inApp: true,
      email: false,
      invoiceAlerts: true,
      leadAlerts: true,
      stockAlerts: true,
      hrAlerts: true,
      taskAlerts: true,
      automationAlerts: true,
    },
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<WorkspacePayload>("/api/workspace");
      setData(res);
      setWsForm({
        name: res.workspace.name,
        industry: res.workspace.industry,
        currency: res.workspace.currency,
        jurisdiction: res.workspace.jurisdiction,
        taxLabel: res.workspace.taxLabel,
        defaultTaxBps: res.workspace.defaultTaxBps,
        taxId: res.workspace.taxId || "",
        address: res.workspace.address || "",
        website: res.workspace.website || "",
      });
      setMatrix(res.rolePermissions);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load settings",
        "error",
      );
    }
  }, [apiFetch, toast]);

  useLoadEffect(load);

  const saveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_settings",
          ...wsForm,
          defaultTaxBps: Number(wsForm.defaultTaxBps),
        }),
      });
      toast("Workspace settings saved");
      await refreshSession();
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    }
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/workspace/members", {
        method: "POST",
        body: JSON.stringify({ email: invEmail, role: invRole }),
      });
      setInviteOpen(false);
      setInvEmail("");
      toast("Invitation queued for email delivery.");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Invite failed", "error");
    }
  };

  const changeMemberRole = async (memberId: number, role: WorkspaceRole) => {
    try {
      await apiFetch("/api/workspace/members", {
        method: "PATCH",
        body: JSON.stringify({ memberId, role }),
      });
      toast("Member role updated");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  };

  const togglePerm = (perm: string) => {
    if (selectedRole === "owner") return;
    setMatrix((prev) => {
      const cur = new Set(prev[selectedRole] || []);
      if (cur.has(perm)) cur.delete(perm);
      else cur.add(perm);
      return { ...prev, [selectedRole]: Array.from(cur) };
    });
  };

  const saveMatrix = async () => {
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_role_permissions",
          rolePermissions: matrix,
        }),
      });
      toast("Configurable RBAC permissions updated & audited");
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          fullName: acctName,
          notificationPrefs: prefs,
          currentPassword: curPwd || undefined,
          newPassword: newPwd || undefined,
        }),
      });
      setCurPwd("");
      setNewPwd("");
      toast("Account & notification preferences updated");
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  };

  if (!data) {
    return <div className="text-xs text-slate-500">Loading settings…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Workspace, Team & Security Settings"
        description="Multi-tenant configuration, invitations, configurable 7-role RBAC permissions & immutable audit logs"
        actions={
          can("workspace:users") && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="op-btn-primary text-xs"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite Member
            </button>
          )
        }
      />

      <details className="op-card my-3 p-3 text-xs">
        <summary>Have an invitation to another workspace?</summary>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch("/api/workspace", {
                method: "PATCH",
                body: JSON.stringify({
                  action: "accept_invitation",
                  inviteCode: joinCode,
                }),
              });
              setJoinCode("");
              await refreshSession();
            } catch (err) {
              toast(
                err instanceof Error ? err.message : "Unable to join",
                "error",
              );
            }
          }}
        >
          <input
            aria-label="Workspace invitation code"
            required
            type="password"
            autoComplete="one-time-code"
            className="op-input max-w-xs"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button className="op-btn-secondary">Accept and switch</button>
        </form>
      </details>
      <SectionTabs
        tabs={[
          { id: "workspace", label: "Workspace Config" },
          { id: "team", label: "Team & Invites", count: data.members.length },
          { id: "rbac", label: "Role Permissions (RBAC)" },
          { id: "account", label: "My Account & Notifications" },
          ...(can("workspace:audit")
            ? [
                {
                  id: "audit",
                  label: "Audit Trail",
                  count: data.auditLogs.length,
                },
              ]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "workspace" && (
        <form
          onSubmit={saveWorkspace}
          className="op-card max-w-2xl p-6 space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-field-1" className="op-label">
                Workspace Name
              </label>
              <input
                id="settings-field-1"
                required
                value={wsForm.name}
                onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="settings-field-2" className="op-label">
                Industry
              </label>
              <input
                id="settings-field-2"
                value={wsForm.industry}
                onChange={(e) =>
                  setWsForm({ ...wsForm, industry: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="settings-field-3" className="op-label">
                Currency
              </label>
              <select
                id="settings-field-3"
                disabled
                title="Historical records use this currency"
                value={wsForm.currency}
                onChange={(e) =>
                  setWsForm({ ...wsForm, currency: e.target.value })
                }
                className="op-input"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
                <option value="SGD">SGD (S$)</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
                <option value="AED">AED</option>
              </select>
            </div>
            <div>
              <label htmlFor="settings-field-4" className="op-label">
                Jurisdiction
              </label>
              <select
                id="settings-field-4"
                value={wsForm.jurisdiction}
                onChange={(e) =>
                  setWsForm({ ...wsForm, jurisdiction: e.target.value })
                }
                className="op-input"
              >
                <option value="IN">India (IN)</option>
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="SG">Singapore (SG)</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
                <option value="AE">UAE (AE)</option>
              </select>
            </div>
            <div>
              <label htmlFor="settings-field-5" className="op-label">
                GSTIN / Tax ID
              </label>
              <input
                id="settings-field-5"
                value={wsForm.taxId}
                onChange={(e) =>
                  setWsForm({ ...wsForm, taxId: e.target.value })
                }
                className="op-input font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label htmlFor="settings-field-6" className="op-label">
              Registered Business Address
            </label>
            <input
              id="settings-field-6"
              value={wsForm.address}
              onChange={(e) =>
                setWsForm({ ...wsForm, address: e.target.value })
              }
              className="op-input"
            />
          </div>
          {can("workspace:manage") && (
            <button type="submit" className="op-btn-primary text-xs">
              <Save className="h-3.5 w-3.5" /> Save Workspace Settings
            </button>
          )}
        </form>
      )}

      {tab === "team" && (
        <div className="space-y-6">
          <div className="op-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Assigned Role</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {m.fullName}
                      </div>
                      <div className="text-slate-500">{m.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {can("workspace:users") && m.role !== "owner" ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeMemberRole(
                              m.id,
                              e.target.value as WorkspaceRole,
                            )
                          }
                          className="op-input w-auto text-xs py-1"
                        >
                          {data.allRoles
                            .filter((r) => r.id !== "owner")
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <StatusPill status={m.role} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.invitations.length > 0 && (
            <div className="op-card p-5">
              <h3 className="mb-3 text-sm font-semibold">
                Pending & Historical Invitations
              </h3>
              <div className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {data.invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div>
                      <strong>{inv.email}</strong> · Role:{" "}
                      <span className="capitalize">
                        {inv.role.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={inv.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "rbac" && (
        <div className="op-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {data.allRoles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRole(r.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    selectedRole === r.id
                      ? "bg-slate-900 text-white dark:bg-indigo-600"
                      : "border border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {session?.role === "owner" && selectedRole !== "owner" && (
              <button
                type="button"
                onClick={saveMatrix}
                className="op-btn-primary text-xs"
              >
                <Save className="h-3.5 w-3.5" /> Save Role Matrix
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.allPermissions.map((perm) => {
              const checked =
                selectedRole === "owner" ||
                (matrix[selectedRole] || []).includes(perm);
              return (
                <label
                  key={perm}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                >
                  <span className="font-mono text-[11px]">{perm}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      session?.role !== "owner" ||
                      selectedRole === "owner" ||
                      perm === "workspace:billing"
                    }
                    onChange={() => togglePerm(perm)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {tab === "account" && (
        <form onSubmit={saveAccount} className="op-card max-w-xl p-6 space-y-4">
          <div>
            <label htmlFor="settings-field-7" className="op-label">
              Full Name
            </label>
            <input
              id="settings-field-7"
              required
              value={acctName}
              onChange={(e) => setAcctName(e.target.value)}
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-field-8" className="op-label">
                Current Password (to change)
              </label>
              <input
                id="settings-field-8"
                type="password"
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="settings-field-9" className="op-label">
                New Password
              </label>
              <input
                id="settings-field-9"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="op-input"
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="text-xs font-semibold">
              Notification Preferences
            </div>
            {(
              [
                ["inApp", "In-app notification center"],
                ["email", "Email notifications (when SMTP configured)"],
                ["invoiceAlerts", "Overdue invoice & payment reminders"],
                ["leadAlerts", "New CRM lead & pipeline updates"],
                ["stockAlerts", "Low inventory threshold alerts"],
                ["hrAlerts", "Leave & payroll notifications"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={prefs[k]}
                  onChange={(e) =>
                    setPrefs({ ...prefs, [k]: e.target.checked })
                  }
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>
            ))}
          </div>

          <button type="submit" className="op-btn-primary text-xs">
            Update Account
          </button>
        </form>
      )}

      {tab === "audit" && (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Module / Action</th>
                <th className="px-4 py-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {data.auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 text-slate-500 tabular whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{log.actorName}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                    {log.action}
                  </td>
                  <td className="px-4 py-2.5">{log.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Member Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Workspace Member"
        subtitle="Generates a single-use SHA-256 verified workspace invitation code"
      >
        <form onSubmit={sendInvite} className="space-y-3">
          <div>
            <label htmlFor="settings-field-10" className="op-label">
              Invitee Email
            </label>
            <input
              id="settings-field-10"
              type="email"
              required
              value={invEmail}
              onChange={(e) => setInvEmail(e.target.value)}
              placeholder="colleague@company.in"
              className="op-input"
            />
          </div>
          <div>
            <label htmlFor="settings-field-11" className="op-label">
              Role
            </label>
            <select
              id="settings-field-11"
              value={invRole}
              onChange={(e) => setInvRole(e.target.value as WorkspaceRole)}
              className="op-input"
            >
              {data.allRoles
                .filter((r) => r.id !== "owner")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} — {r.description}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Generate Invitation
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
