"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import { CustomerImport } from "@/components/app/CustomerImport";
import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  Calendar,
  UserPlus,
  MessageSquare,
  ArrowRight,
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

const STAGES = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

interface CustomerRow {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  address: string | null;
  customerType: string;
  tags: string[];
  notes: string | null;
  assignedName: string | null;
  totalSpentCents: number;
  createdAt: string;
}

interface LeadRow {
  id: number;
  customerId: number | null;
  title: string;
  contactName: string;
  company: string;
  email: string | null;
  source: string;
  estimatedValueCents: number;
  priority: string;
  stage: string;
  assignedName: string | null;
  followUpDate: string | null;
  notes: string | null;
}

interface CustomerDetail {
  customer: CustomerRow;
  purchases: Array<{
    id: number;
    invoiceNumber: string;
    docType: string;
    status: string;
    totalCents: number;
    issueDate: string;
  }>;
  communications: Array<{
    id: number;
    authorName: string;
    channel: string;
    subject: string;
    content: string;
    createdAt: string;
  }>;
}

export default function CrmPage() {
  const searchParams = useSearchParams();
  const { session, apiFetch, can, toast, refreshSession } = useWorkspace();
  const currency = session?.tenant.currency || "INR";

  const [tab, setTab] = useState(
    searchParams.get("new") === "customer" ? "customers" : "pipeline",
  );
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [analytics, setAnalytics] = useState({
    totalPipelineCents: 0,
    wonValueCents: 0,
    winRatePct: 0,
    followUpDueCount: 0,
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const [newCustomerOpen, setNewCustomerOpen] = useState(
    searchParams.get("new") === "customer",
  );
  const [newLeadOpen, setNewLeadOpen] = useState(
    searchParams.get("new") === "lead",
  );
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerDetail | null>(null);

  // Forms
  const [custForm, setCustForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    address: "",
    customerType: "business",
    tags: "",
    notes: "",
  });
  const [leadForm, setLeadForm] = useState(() => ({
    title: "",
    contactName: "",
    company: "",
    email: "",
    source: "Website",
    estimatedValue: "150000",
    priority: "high",
    stage: "new",
    followUpDate: new Date(Date.now() + 3 * 86400000)
      .toISOString()
      .slice(0, 10),
    notes: "",
  }));
  const [commForm, setCommForm] = useState({
    channel: "call",
    subject: "",
    content: "",
  });

  const loadData = useCallback(async () => {
    try {
      const [leadRes, custRes] = await Promise.all([
        apiFetch<{ leads: LeadRow[]; analytics: typeof analytics }>(
          `/api/crm/leads?search=${encodeURIComponent(search)}&priority=${priorityFilter}`,
        ),
        apiFetch<{ customers: CustomerRow[] }>(
          `/api/crm/customers?search=${encodeURIComponent(
            search,
          )}&type=${typeFilter}&sort=${sortBy}`,
        ),
      ]);
      setLeads(leadRes.leads);
      setAnalytics(leadRes.analytics);
      setCustomers(custRes.customers);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load CRM", "error");
    }
  }, [apiFetch, search, priorityFilter, typeFilter, sortBy, toast]);

  useLoadEffect(loadData, 120);

  const createCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/crm/customers", {
        method: "POST",
        body: JSON.stringify({
          ...custForm,
          tags: custForm.tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setNewCustomerOpen(false);
      setCustForm({
        name: "",
        company: "",
        email: "",
        phone: "",
        address: "",
        customerType: "business",
        tags: "",
        notes: "",
      });
      toast("Customer profile created");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const createLead = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/crm/leads", {
        method: "POST",
        body: JSON.stringify({
          ...leadForm,
          estimatedValue: Number(leadForm.estimatedValue) || 0,
        }),
      });
      setNewLeadOpen(false);
      setLeadForm({
        title: "",
        contactName: "",
        company: "",
        email: "",
        source: "Website",
        estimatedValue: "150000",
        priority: "high",
        stage: "new",
        followUpDate: new Date(Date.now() + 3 * 86400000)
          .toISOString()
          .slice(0, 10),
        notes: "",
      });
      toast("Lead created & sales workflow triggered");
      await loadData();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const updateLeadStage = async (id: number, stage: string) => {
    try {
      await apiFetch("/api/crm/leads", {
        method: "PATCH",
        body: JSON.stringify({ id, stage }),
      });
      toast(`Moved deal to ${stage}`);
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const convertLead = async (id: number) => {
    try {
      await apiFetch("/api/crm/leads", {
        method: "PATCH",
        body: JSON.stringify({ id, convertToCustomer: true }),
      });
      toast("Converted lead to Customer & marked Won");
      loadData();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const openCustomerDetail = async (id: number) => {
    try {
      const res = await apiFetch<CustomerDetail>(`/api/crm/customers?id=${id}`);
      setSelectedCustomer(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const addCommunication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      await apiFetch("/api/crm/customers", {
        method: "PATCH",
        body: JSON.stringify({
          id: selectedCustomer.customer.id,
          action: "add_communication",
          ...commForm,
        }),
      });
      setCommForm({ channel: "call", subject: "", content: "" });
      toast("Logged customer communication");
      openCustomerDetail(selectedCustomer.customer.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="CRM & Sales Pipeline"
        description="Manage customer accounts, communications, lead follow-ups, and Kanban conversion stages"
        actions={
          can("crm:write") && (
            <>
              <CustomerImport onComplete={loadData} />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                className="op-btn-secondary text-xs"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add Customer
              </button>
              <button
                type="button"
                onClick={() => setNewLeadOpen(true)}
                className="op-btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                New Lead
              </button>
            </>
          )
        }
      />

      {/* Sales Analytics Row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open Pipeline Value"
          value={formatMoney(analytics.totalPipelineCents, currency)}
          subtext={`${leads.filter((l) => l.stage !== "won" && l.stage !== "lost").length} active opportunities`}
        />
        <StatCard
          label="Closed-Won Revenue"
          value={formatMoney(analytics.wonValueCents, currency)}
          subtext={`Conversion rate: ${analytics.winRatePct}%`}
          tone="positive"
        />
        <StatCard
          label="Active Customers"
          value={customers.length}
          subtext="With full purchase & comms history"
        />
        <StatCard
          label="Follow-Up Reminders"
          value={analytics.followUpDueCount}
          subtext="Due within the next 5 days"
          tone={analytics.followUpDueCount > 0 ? "warning" : "default"}
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: "pipeline",
            label: "Sales Pipeline (Kanban)",
            count: leads.length,
          },
          { id: "customers", label: "Customers", count: customers.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Filters Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === "pipeline"
                ? "Search deals, contacts, companies…"
                : "Search customers, companies, tags…"
            }
            className="op-input pl-9"
          />
        </div>
        {tab === "pipeline" ? (
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="op-input w-auto"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        ) : (
          <>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="op-input w-auto"
            >
              <option value="all">All Types</option>
              <option value="enterprise">Enterprise</option>
              <option value="business">Business</option>
              <option value="smb">SMB</option>
              <option value="individual">Individual</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="op-input w-auto"
            >
              <option value="newest">Sort: Newest</option>
              <option value="spend">Sort: Highest Spend</option>
              <option value="name">Sort: Name (A–Z)</option>
            </select>
          </>
        )}
      </div>

      {tab === "pipeline" ? (
        <div className="flex gap-3.5 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage === stage.id);
            const colTotal = stageLeads.reduce(
              (s, l) => s + l.estimatedValueCents,
              0,
            );
            return (
              <div
                key={stage.id}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      {stage.label}
                    </span>
                    <span className="rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[10px] font-semibold text-slate-700 tabular dark:bg-slate-800 dark:text-slate-300">
                      {stageLeads.length}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 tabular">
                    {formatMoney(colTotal, currency, true)}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs dark:border-slate-800 dark:bg-[#111827]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                          {lead.title}
                        </div>
                        <StatusPill status={lead.priority} />
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {lead.company} · {lead.contactName}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 tabular dark:text-white">
                          {formatMoney(lead.estimatedValueCents, currency)}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {lead.source}
                        </span>
                      </div>
                      {lead.followUpDate && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
                          <Calendar className="h-3 w-3" />
                          <span>Follow-up: {lead.followUpDate}</span>
                        </div>
                      )}
                      {can("crm:write") && (
                        <div className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                          <select
                            aria-label="Change stage"
                            value={lead.stage}
                            onChange={(e) =>
                              updateLeadStage(lead.id, e.target.value)
                            }
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            {STAGES.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.label}
                              </option>
                            ))}
                          </select>
                          {!lead.customerId && lead.stage !== "lost" && (
                            <button
                              type="button"
                              onClick={() => convertLead(lead.id)}
                              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              Convert <ArrowRight className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400 dark:border-slate-800">
                      No deals in {stage.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Customer & Company</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3 text-right">Lifetime Spend</th>
                <th className="px-4 py-3 text-right">History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-white">
                      {c.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.company} · {c.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.customerType} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {c.assignedName || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular text-slate-900 dark:text-white">
                    {formatMoney(c.totalSpentCents, currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openCustomerDetail(c.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      360° View
                    </button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-xs text-slate-500"
                  >
                    No customers match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Customer Modal */}
      <Modal
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        title="New Customer Profile"
        subtitle="Add a business or individual customer to your CRM"
      >
        <form onSubmit={createCustomer} className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="crm-field-1" className="op-label">
                Contact Name
              </label>
              <input
                id="crm-field-1"
                required
                value={custForm.name}
                onChange={(e) =>
                  setCustForm({ ...custForm, name: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="crm-field-2" className="op-label">
                Company
              </label>
              <input
                id="crm-field-2"
                required
                value={custForm.company}
                onChange={(e) =>
                  setCustForm({ ...custForm, company: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="crm-field-3" className="op-label">
                Email
              </label>
              <input
                id="crm-field-3"
                type="email"
                required
                value={custForm.email}
                onChange={(e) =>
                  setCustForm({ ...custForm, email: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="crm-field-4" className="op-label">
                Phone
              </label>
              <input
                id="crm-field-4"
                value={custForm.phone}
                onChange={(e) =>
                  setCustForm({ ...custForm, phone: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="crm-field-5" className="op-label">
                Customer Type
              </label>
              <select
                id="crm-field-5"
                value={custForm.customerType}
                onChange={(e) =>
                  setCustForm({ ...custForm, customerType: e.target.value })
                }
                className="op-input"
              >
                <option value="enterprise">Enterprise</option>
                <option value="business">Business</option>
                <option value="smb">SMB</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            <div>
              <label htmlFor="crm-field-6" className="op-label">
                Tags (comma separated)
              </label>
              <input
                id="crm-field-6"
                value={custForm.tags}
                onChange={(e) =>
                  setCustForm({ ...custForm, tags: e.target.value })
                }
                placeholder="Retainer, SaaS, Priority"
                className="op-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="crm-field-7" className="op-label">
              Address
            </label>
            <input
              id="crm-field-7"
              value={custForm.address}
              onChange={(e) =>
                setCustForm({ ...custForm, address: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div>
            <label htmlFor="crm-field-8" className="op-label">
              Notes
            </label>
            <textarea
              id="crm-field-8"
              rows={2}
              value={custForm.notes}
              onChange={(e) =>
                setCustForm({ ...custForm, notes: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewCustomerOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Save Customer
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Lead Modal */}
      <Modal
        open={newLeadOpen}
        onClose={() => setNewLeadOpen(false)}
        title="Create Sales Opportunity / Lead"
        subtitle="Automatically triggers active lead.created workflows"
      >
        <form onSubmit={createLead} className="space-y-3.5">
          <div>
            <label htmlFor="crm-field-9" className="op-label">
              Opportunity Title
            </label>
            <input
              id="crm-field-9"
              required
              value={leadForm.title}
              onChange={(e) =>
                setLeadForm({ ...leadForm, title: e.target.value })
              }
              placeholder="e.g. Annual Platform Modernization"
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="crm-field-10" className="op-label">
                Contact Name
              </label>
              <input
                id="crm-field-10"
                required
                value={leadForm.contactName}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, contactName: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="crm-field-11" className="op-label">
                Company
              </label>
              <input
                id="crm-field-11"
                required
                value={leadForm.company}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, company: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="op-label">Est. Value ({currency})</label>
              <input
                type="number"
                min="0"
                value={leadForm.estimatedValue}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, estimatedValue: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label htmlFor="crm-field-12" className="op-label">
                Priority
              </label>
              <select
                id="crm-field-12"
                value={leadForm.priority}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, priority: e.target.value })
                }
                className="op-input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="crm-field-13" className="op-label">
                Source
              </label>
              <input
                id="crm-field-13"
                value={leadForm.source}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, source: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="crm-field-14" className="op-label">
                Email
              </label>
              <input
                id="crm-field-14"
                type="email"
                value={leadForm.email}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, email: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="crm-field-15" className="op-label">
                Follow-Up Date
              </label>
              <input
                id="crm-field-15"
                type="date"
                value={leadForm.followUpDate}
                onChange={(e) =>
                  setLeadForm({ ...leadForm, followUpDate: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewLeadOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Create Lead
            </button>
          </div>
        </form>
      </Modal>

      {/* Customer 360 Detail Modal */}
      <Modal
        open={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomer(null)}
        title={
          selectedCustomer
            ? `${selectedCustomer.customer.name} — ${selectedCustomer.customer.company}`
            : ""
        }
        subtitle={
          selectedCustomer
            ? `${selectedCustomer.customer.email} · ${
                selectedCustomer.customer.phone || "No phone"
              } · ${selectedCustomer.customer.address || ""}`
            : ""
        }
        maxWidth="max-w-2xl"
      >
        {selectedCustomer && (
          <div className="space-y-5">
            {selectedCustomer.customer.notes && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                {selectedCustomer.customer.notes}
              </div>
            )}

            {/* Purchase History */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Purchase & Invoice History ({selectedCustomer.purchases.length})
              </h3>
              {selectedCustomer.purchases.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No invoices issued yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {selectedCustomer.purchases.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {p.invoiceNumber}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {p.issueDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <StatusPill status={p.status} />
                        <span className="font-semibold tabular">
                          {formatMoney(p.totalCents, currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Communication History */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Communication Timeline ({selectedCustomer.communications.length}
                )
              </h3>
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {selectedCustomer.communications.map((cm) => (
                  <div
                    key={cm.id}
                    className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        [{cm.channel.toUpperCase()}] {cm.subject}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {cm.authorName}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">
                      {cm.content}
                    </p>
                  </div>
                ))}
              </div>

              {can("crm:write") && (
                <form
                  onSubmit={addCommunication}
                  className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Log New Interaction
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      value={commForm.channel}
                      onChange={(e) =>
                        setCommForm({ ...commForm, channel: e.target.value })
                      }
                      className="op-input text-xs"
                    >
                      <option value="call">Phone Call</option>
                      <option value="email">Email</option>
                      <option value="meeting">Meeting</option>
                      <option value="note">Internal Note</option>
                    </select>
                    <input
                      required
                      value={commForm.subject}
                      onChange={(e) =>
                        setCommForm({ ...commForm, subject: e.target.value })
                      }
                      placeholder="Subject / Summary"
                      className="op-input text-xs sm:col-span-2"
                    />
                  </div>
                  <textarea
                    required
                    rows={2}
                    value={commForm.content}
                    onChange={(e) =>
                      setCommForm({ ...commForm, content: e.target.value })
                    }
                    placeholder="Key takeaways and next steps…"
                    className="op-input text-xs"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="op-btn-primary text-xs py-1.5"
                    >
                      Log Interaction
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
