"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import type {
  DashboardWidgetConfig,
  NotificationPrefs,
  WorkspaceRole,
} from "@/db/schema";
import {
  clearClientSession,
  getClientCsrfToken,
  saveClientSession,
} from "@/lib/client-session";

export interface SessionTenant {
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
  plan: string;
  billingStatus: string;
  aiProvider: string;
  aiModel: string;
  hasAiApiKey: boolean;
  aiTokensUsed: number;
  aiTokenLimit: number;
  dashboardWidgets: DashboardWidgetConfig[];
}

export interface SessionData {
  csrfToken: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    phone: string | null;
    emailVerified: boolean;
    notificationPrefs: NotificationPrefs;
  };
  role: WorkspaceRole;
  permissions: string[];
  tenant: SessionTenant;
  workspaces: Array<{
    tenantId: number;
    name: string;
    slug: string;
    plan: string;
    role: WorkspaceRole;
  }>;
  unreadNotifications: number;
}

interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error";
}

interface WorkspaceContextValue {
  session: SessionData | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  can: (permission: string) => boolean;
  apiFetch: <T = unknown>(url: string, init?: RequestInit) => Promise<T>;
  toast: (message: string, variant?: "success" | "error") => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (message: string, variant: "success" | "error" = "success") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-3), { id, message, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3800);
    },
    [],
  );

  const refreshSession = useCallback(async () => {
    try {
      const headers = new Headers();
      const res = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        clearClientSession();
        setSession(null);
        router.replace("/login");
        return;
      }
      const data = (await res.json()) as SessionData;
      if (data.csrfToken) {
        saveClientSession(data.csrfToken);
      }
      setSession(data);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useLoadEffect(refreshSession);

  const permSet = useMemo(
    () => new Set(session?.permissions || []),
    [session?.permissions],
  );

  const can = useCallback(
    (permission: string) => permSet.has(permission),
    [permSet],
  );

  const apiFetch = useCallback(
    async <T = unknown,>(url: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers || {});
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const csrf = session?.csrfToken || getClientCsrfToken();
      if (csrf) {
        headers.set("x-csrf-token", csrf);
      }
      const res = await fetch(url, {
        ...init,
        credentials: "include",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearClientSession();
          router.replace("/login");
        }
        throw new Error(
          (json as { error?: string }).error ||
            `Request failed (${res.status})`,
        );
      }
      return json as T;
    },
    [session?.csrfToken, router],
  );

  return (
    <WorkspaceContext.Provider
      value={{ session, loading, refreshSession, can, apiFetch, toast }}
    >
      {children}
      {/* Toast viewport */}
      <div className="no-print fixed right-4 bottom-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-sm ${
              t.variant === "error"
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100"
                : "border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            }`}
          >
            {t.variant === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return ctx;
}
