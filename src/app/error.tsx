"use client";

import React from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6 text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      <div className="op-card max-w-md p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold">Something interrupted this view</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {error?.message || "An unexpected client error occurred."}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={reset} className="op-btn-primary text-xs">
            Retry View
          </button>
          <Link href="/" className="op-btn-secondary text-xs">
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
