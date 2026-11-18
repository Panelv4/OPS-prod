"use client";
import Link from "next/link";
import { useState } from "react";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";
const steps = ["Client brief", "Project delivery", "Invoice & collection"];
export default function Demo() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <Link href="/">
          <OpsPilotLogo size="md" />
        </Link>
        <ThemeToggleButton />
      </header>
      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
        Disposable sample · no sign-in
      </p>
      <h1 className="text-3xl font-bold">From a client brief to an invoice</h1>
      <p>
        This walkthrough uses fictional records in this tab, never a live
        workspace. Refresh to reset.
      </p>
      <nav aria-label="Sample workflow" className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            aria-pressed={i === step}
            className={i === step ? "op-btn-primary" : "op-btn-secondary"}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </nav>
      <section className="op-card p-6 space-y-3" aria-live="polite">
        <h2 className="text-xl font-semibold">{steps[step]}</h2>
        {step === 0 ? (
          <>
            <p>Sample client: Cedar Studio</p>
            <p>Website refresh · proposal agreed · fixed project fee $2,000.</p>
          </>
        ) : step === 1 ? (
          <>
            <p>
              Project: Cedar website refresh. Task: deliver homepage prototype.
            </p>
            <button className="op-btn-secondary" onClick={() => setDone(!done)}>
              {done ? "Reopen sample task" : "Mark sample task delivered"}
            </button>
            <p>Status: {done ? "Delivered" : "In progress"}</p>
          </>
        ) : (
          <>
            <p>
              Sample invoice: $2,000 · deposit recorded: $500 · balance: $1,500.
            </p>
            <p>No payment is collected here.</p>
          </>
        )}
      </section>
      <Link className="op-btn-primary" href="/register">
        Create an empty workspace
      </Link>
    </main>
  );
}
