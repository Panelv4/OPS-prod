"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";
import { saveClientSession } from "@/lib/client-session";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [industry, setIndustry] = useState("Technology & Services");
  const [currency, setCurrency] = useState("INR");
  const [jurisdiction, setJurisdiction] = useState("IN");
  const [inviteCode, setInviteCode] = useState("");
  const [useInvite, setUseInvite] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          password,
          workspaceName: useInvite ? undefined : workspaceName,
          industry,
          currency,
          jurisdiction,
          inviteCode: useInvite ? inviteCode : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Registration failed.");
        return;
      }
      saveClientSession(json.csrfToken);
      router.push("/app");
    } catch {
      setError("Network error while creating workspace.");
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
        <div className="op-card w-full max-w-lg p-7 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Create your OpsPilot workspace
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Every business gets an isolated multi-tenant environment with
            dedicated RBAC.
          </p>

          <div className="mt-4 flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setUseInvite(false)}
              className={`flex-1 rounded-md py-1.5 font-medium ${
                !useInvite
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white"
                  : "text-slate-500"
              }`}
            >
              New Business Workspace
            </button>
            <button
              type="button"
              onClick={() => setUseInvite(true)}
              className={`flex-1 rounded-md py-1.5 font-medium ${
                useInvite
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white"
                  : "text-slate-500"
              }`}
            >
              Join via Invite Code
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="register-field-0" className="op-label">
                  Full Name
                </label>
                <input
                  id="register-field-0"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Aarav Sharma"
                  className="op-input"
                />
              </div>
              <div>
                <label htmlFor="register-field-1" className="op-label">
                  Work Email
                </label>
                <input
                  id="register-field-1"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="aarav@company.in"
                  className="op-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="register-field-2" className="op-label">
                Password (min 8 chars, upper, lower & number)
              </label>
              <input
                id="register-field-2"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                className="op-input"
              />
            </div>

            {useInvite ? (
              <div>
                <label htmlFor="register-field-3" className="op-label">
                  Workspace Invitation Code
                </label>
                <input
                  id="register-field-3"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="INV-XXXXXXXX"
                  className="op-input font-mono"
                />
              </div>
            ) : (
              <>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="register-field-4" className="op-label">
                      Business / Workspace Name
                    </label>
                    <input
                      id="register-field-4"
                      required
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="Acme Digital Pvt Ltd"
                      className="op-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="register-field-5" className="op-label">
                      Industry
                    </label>
                    <input
                      id="register-field-5"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="op-input"
                    />
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="register-field-6" className="op-label">
                      Primary Currency
                    </label>
                    <select
                      id="register-field-6"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="op-input"
                    >
                      <option value="INR">INR (₹ Indian Rupee)</option>
                      <option value="USD">USD ($ US Dollar)</option>
                      <option value="GBP">GBP (£ British Pound)</option>
                      <option value="EUR">EUR (€ Euro)</option>
                      <option value="SGD">SGD (S$ Singapore Dollar)</option>
                      <option value="CAD">CAD</option>
                      <option value="AUD">AUD</option>
                      <option value="AED">AED (UAE Dirham)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="register-field-7" className="op-label">
                      Tax & Payroll Jurisdiction
                    </label>
                    <select
                      id="register-field-7"
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value)}
                      className="op-input"
                    >
                      <option value="IN">India (GST / EPF / TDS)</option>
                      <option value="US">
                        United States (Sales Tax / FICA)
                      </option>
                      <option value="GB">
                        United Kingdom (VAT / NI / PAYE)
                      </option>
                      <option value="SG">Singapore (GST / CPF)</option>
                      <option value="CA">Canada</option>
                      <option value="AU">Australia</option>
                      <option value="AE">UAE (VAT / WPS)</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={busy}
              className="op-btn-primary mt-2 h-10 w-full"
            >
              {busy
                ? "Provisioning workspace…"
                : useInvite
                  ? "Accept Invite & Join"
                  : "Launch Workspace"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            Already have a workspace?{" "}
            <Link
              href="/login"
              className="font-semibold text-slate-900 hover:underline dark:text-white"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
