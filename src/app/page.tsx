"use client";

import React from "react";
import Link from "next/link";

import {
  ArrowRight,
  Users,
  ReceiptText,
  Landmark,
  UserCheck,
  Package,
  Truck,
  FolderKanban,
  FileText,
  Sparkles,
  Workflow,
  ShieldCheck,
  BarChart3,
  Check,
  Building2,
} from "lucide-react";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";
import { DEFAULT_PLANS } from "@/lib/permissions";

const MODULES = [
  {
    icon: Users,
    title: "CRM & Sales Pipeline",
    desc: "Customer 360 profiles, Kanban deal stages, follow-up tracking, and conversion intelligence.",
  },
  {
    icon: ReceiptText,
    title: "Sales & Invoicing",
    desc: "Issue quotes and invoices with configurable tax. Print documents and record partial payments or refunds.",
  },
  {
    icon: Landmark,
    title: "Finance & Ledger",
    desc: "Record inflows and outflows, review receivables and payables, and correct entries by reversal.",
  },
  {
    icon: UserCheck,
    title: "HRMS & Payroll",
    desc: "Track attendance and leave, and review illustrative payroll estimates before recording payment.",
  },
  {
    icon: Package,
    title: "Inventory Control",
    desc: "Product & service SKUs, stock valuation, traceable movement logs, and low-stock alerts.",
  },
  {
    icon: Truck,
    title: "Procurement & Vendors",
    desc: "Supplier profiles, PO approval gates, goods-received inventory sync, and recorded vendor payments.",
  },
  {
    icon: FolderKanban,
    title: "Projects & Tasks",
    desc: "Client project budgets, Kanban, List & Calendar task views, comments, and team alerts.",
  },
  {
    icon: FileText,
    title: "Document Vault",
    desc: "Role-scoped permissions, validated uploads, version history, previews, and expiry reminders.",
  },
  {
    icon: Sparkles,
    title: "OpsPilot Intelligence",
    desc: "Deterministic business AI over authorized data, executive reports, anomalies & receipt parsing.",
  },
  {
    icon: Workflow,
    title: "Workflow Automation",
    desc: "Event & scheduled automations, conditions, delays, approval gates, retries & NL draft builder.",
  },
  {
    icon: BarChart3,
    title: "Live Executive Analytics",
    desc: "Review six months of recorded cash movement, pipeline stages and expense categories.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-Tenant Security",
    desc: "Workspace-scoped records, seven member roles, protected writes and an audit history.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0B0F17]/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <OpsPilotLogo size="md" />
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex dark:text-slate-300">
            <a
              href="#modules"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Modules
            </a>
            <a
              href="#intelligence"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Intelligence & Automation
            </a>
            <a
              href="#pricing"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggleButton />
            <Link
              href="/login"
              className="hidden text-sm font-medium text-slate-700 hover:text-slate-900 sm:inline-block px-2.5 py-1.5 dark:text-slate-300 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="op-btn-primary text-xs sm:text-sm"
            >
              Start Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-slate-200/70 pt-16 pb-20 sm:pt-24 sm:pb-28 dark:border-slate-800/70">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Building2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>A workspace for small service agencies</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl sm:leading-[1.08] dark:text-white">
              From client brief
              <br />
              <span className="text-slate-500 dark:text-slate-400">
                to outstanding balance.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400">
              See what your agency promised, what the team delivered, and what
              is left to collect. Follow one client from an agreed brief to a
              project, a team handoff, and a recorded payment in the same
              workspace.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="op-btn-primary h-11 w-full px-6 text-sm sm:w-auto"
              >
                Explore sample workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/register"
                className="op-btn-secondary h-11 w-full px-6 text-sm sm:w-auto"
              >
                Create an empty workspace
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-500">
              Local preview · Use fictional data only · No live charges
            </p>
          </div>

          {/* Crisp Executive Architecture Preview Window */}
          <div className="mt-14 rounded-2xl border border-slate-200 bg-slate-50/70 p-2 shadow-xl shadow-slate-900/[0.04] dark:border-slate-800 dark:bg-slate-900/50">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-[#111827]">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Agency workflow · illustrative walkthrough
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  Sample
                </span>
              </div>
              <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 dark:bg-slate-800">
                {[
                  {
                    k: "01 · Pipeline",
                    v: "Client brief",
                    s: "Capture the opportunity",
                  },
                  {
                    k: "02 · Delivery",
                    v: "Project budget",
                    s: "Assign tasks and log time",
                  },
                  {
                    k: "03 · Billing",
                    v: "First invoice",
                    s: "Review tax and line items",
                  },
                  {
                    k: "04 · Collections",
                    v: "Open balance",
                    s: "Record payments and expenses",
                  },
                ].map((m) => (
                  <div key={m.k} className="bg-white p-5 dark:bg-[#111827]">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {m.k}
                    </div>
                    <div className="mt-1.5 text-xl font-semibold text-slate-900 tabular sm:text-2xl dark:text-white">
                      {m.v}
                    </div>
                    <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                      {m.s}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 12 Unified Modules */}
      <section id="modules" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wider text-indigo-600 uppercase dark:text-indigo-400">
              Inside the workspace
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Start with one client engagement.
            </h2>
            <p className="mt-3 text-base text-slate-600 dark:text-slate-400">
              Connect the brief, the work and the invoice. Use other modules
              only where they fit your team’s process.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <div
                  key={mod.title}
                  className="op-card p-5 transition-colors hover:border-slate-300 dark:hover:border-slate-700"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-indigo-400">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">
                    {mod.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {mod.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Intelligence & Automation Split */}
      <section
        id="intelligence"
        className="border-y border-slate-200/80 bg-slate-50/70 py-20 dark:border-slate-800/80 dark:bg-[#0E1420]"
      >
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-2">
          <div className="op-card p-7">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <Sparkles className="h-4 w-4" />
              OPSPILOT INTELLIGENCE
            </div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Financial answers from your ledger, not a language model.
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Business questions use permission-scoped workspace records. Ask
              for overdue invoices, anomaly sweeps, executive briefings, or
              receipt extraction — with mandatory human confirmation before any
              action runs.
            </p>
            <div className="mt-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/70">
              <div className="font-medium text-slate-900 dark:text-white">
                &ldquo;Which customers have overdue payments and which SKUs are
                low?&rdquo;
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                → Verified via{" "}
                <code className="text-indigo-600 dark:text-indigo-400">
                  get_overdue_invoices
                </code>{" "}
                &{" "}
                <code className="text-indigo-600 dark:text-indigo-400">
                  get_low_stock_products
                </code>{" "}
                · RBAC checked · AES-256 encrypted BYO LLM keys supported.
              </div>
            </div>
          </div>

          <div className="op-card p-7">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <Workflow className="h-4 w-4" />
              WORKFLOW AUTOMATION ENGINE
            </div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Describe rules in plain English. Approve to activate.
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Combine event triggers, threshold conditions, delays, multi-step
              actions, automatic retries, and manager sign-off gates with full
              execution history.
            </p>
            <div className="mt-5 space-y-2 text-xs">
              {[
                "WHEN lead.created → Notify assigned salesperson & create follow-up task",
                "WHEN invoice.overdue → Create internal collection reminder & alert accountant",
                "WHEN stock.low → Alert inventory manager & log restock requirement",
              ].map((rule) => (
                <div
                  key={rule}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
                >
                  {rule}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Commercial Pricing */}
      <section id="pricing" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-wider text-indigo-600 uppercase dark:text-indigo-400">
              Transparent Commercial Pricing
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Simple pricing for the whole workspace.
            </h2>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Proposed monthly USD pricing for discovery. Paid plans are not on
              sale. Start free; no live charges.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            {DEFAULT_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`flex flex-col rounded-2xl border p-5 ${
                  plan.highlighted
                    ? "border-slate-900 bg-slate-900 text-white shadow-lg dark:border-indigo-500 dark:bg-indigo-950/40"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"
                }`}
              >
                <div className="text-sm font-semibold">{plan.name}</div>
                <div className="mt-3 flex items-baseline gap-1 tabular">
                  <span className="text-3xl font-bold tracking-tight">
                    {plan.priceDisplay}
                  </span>
                </div>
                <div
                  className={`text-xs ${
                    plan.highlighted
                      ? "text-slate-300"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {plan.period}
                </div>
                <p
                  className={`mt-3 text-xs leading-relaxed ${
                    plan.highlighted
                      ? "text-slate-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {plan.tagline}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-xs">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                          plan.highlighted
                            ? "text-indigo-300"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`mt-6 inline-flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                    plan.highlighted
                      ? "bg-white text-slate-900 hover:bg-slate-100"
                      : "border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
                  }`}
                >
                  Start with Free
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-10 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <OpsPilotLogo size="sm" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} OpsPilot. From client brief One
            Operating System.
          </p>
          <div className="flex items-center gap-5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Link
              href="/login"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Register Workspace
            </Link>
            <Link
              href="/demo"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Explore sample workspace
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
