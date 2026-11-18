"use client";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
export function VerifyEmail({ onLogout }: { onLogout: () => void }) {
  const { apiFetch, refreshSession, session } = useWorkspace();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(resend = false) {
    try {
      await apiFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(
          resend ? { resendVerification: true } : { verificationToken: code },
        ),
      });
      if (resend) setNotice("A new code has been queued. Check your inbox.");
      else await refreshSession();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
    }
  }
  return (
    <main className="mx-auto mt-16 max-w-md op-card p-6 space-y-4">
      <h1 className="text-xl font-semibold">Verify your work email</h1>
      <p>
        Check {session?.user.email} for your verification code. It expires in 24
        hours.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="op-label" htmlFor="verification">
          Email code
        </label>
        <input
          className="op-input"
          id="verification"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="op-btn-primary mt-3">
          Verify and open workspace
        </button>
      </form>
      <p role="status">{notice}</p>
      <button className="op-btn-secondary" onClick={() => submit(true)}>
        Resend code
      </button>{" "}
      <button className="op-btn-secondary" onClick={onLogout}>
        Sign out
      </button>
    </main>
  );
}
