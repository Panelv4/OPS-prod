"use client";

import React, { useState } from "react";
import Link from "next/link";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"request" | "confirm" | "done">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "request", email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unable to initiate reset.");
        return;
      }
      setMessage(json.message);
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "confirm", token, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Password reset failed.");
        return;
      }
      setMessage(json.message);
      setStep("done");
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
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="op-card w-full max-w-md p-7 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
            Password Recovery
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Reset your OpsPilot password using a time-limited SHA-256 verified
            token.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}
          {message && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
              {message}
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequest} className="mt-5 space-y-4">
              <div>
                <label htmlFor="forgot-password-field-0" className="op-label">
                  Account Email
                </label>
                <input
                  id="forgot-password-field-0"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="op-input"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="op-btn-primary w-full"
              >
                {busy ? "Generating token…" : "Send Recovery Token"}
              </button>
            </form>
          )}

          {step === "confirm" && (
            <form onSubmit={handleConfirm} className="mt-5 space-y-4">
              <div>
                <label htmlFor="forgot-password-field-1" className="op-label">
                  Recovery Token
                </label>
                <input
                  id="forgot-password-field-1"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="op-input font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="forgot-password-field-2" className="op-label">
                  New Password
                </label>
                <input
                  id="forgot-password-field-2"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="op-input"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="op-btn-primary w-full"
              >
                {busy ? "Resetting…" : "Update Password"}
              </button>
            </form>
          )}

          {step === "done" && (
            <Link href="/login" className="op-btn-primary mt-5 w-full">
              Return to Sign In
            </Link>
          )}

          <div className="mt-5 text-center text-xs text-slate-500">
            <Link href="/login" className="hover:underline">
              Back to Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
