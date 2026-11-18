"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";
import { saveClientSession } from "@/lib/client-session";

const DEMO_ROLES = [
  { id: "owner", label: "Owner (Arjun)", sub: "Meridian · Full Access" },
  { id: "accountant", label: "Accountant (Kavya)", sub: "Finance & Sales" },
  { id: "hr_manager", label: "HR Manager (Ananya)", sub: "HRMS & Payroll" },
  { id: "salesperson", label: "Salesperson (Rohan)", sub: "CRM & Orders" },
  { id: "employee", label: "Employee (Dev)", sub: "Scoped RBAC" },
  { id: "tenant2", label: "Tenant #2 (Priya)", sub: "Northstar Labs" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Sign-in failed.");
        return;
      }
      saveClientSession(json.csrfToken);
      router.push("/app");
    } catch {
      setError("Network error while signing in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-[#0B0F17]">
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/">
          <OpsPilotLogo size="md" />
        </Link>
        <ThemeToggleButton />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-5">
          <div className="op-card p-7 shadow-sm">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Sign in to OpsPilot
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Access your isolated business operating workspace.
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-field-0" className="op-label">
                  Work Email
                </label>
                <input
                  id="login-field-0"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@agency.example"
                  className="op-input"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="login-field-1"
                    className="text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="login-field-1"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="op-input"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="op-btn-primary h-10 w-full"
              >
                {busy ? "Signing in…" : "Sign in"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
              New business?{" "}
              <Link
                href="/register"
                className="font-semibold text-slate-900 hover:underline dark:text-white"
              >
                Create an isolated workspace
              </Link>
            </div>
          </div>

          <Link href="/demo" className="op-btn-secondary w-full">
            Explore the sample agency · no account required
          </Link>
        </div>
      </div>
    </div>
  );
}
