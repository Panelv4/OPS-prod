"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Workflow,
  Users,
  ReceiptText,
  Landmark,
  UserCheck,
  Package,
  Truck,
  FolderKanban,
  FileText,
  CreditCard,
  Settings,
  Search,
  Bell,
  Plus,
  Menu,
  X,
  LogOut,
  ChevronsUpDown,
  Check,
  Building2,
  CheckCheck,
} from "lucide-react";
import { OpsPilotLogo } from "@/components/brand/OpsPilotLogo";
import { ThemeToggleButton } from "@/components/providers/ThemeProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Modal } from "@/components/ui/primitives";
import { clearClientSession } from "@/lib/client-session";

import { VerifyEmail } from "./VerifyEmail";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Command",
    items: [
      {
        href: "/app",
        label: "Dashboard",
        icon: LayoutDashboard,
        permission: "dashboard:view",
      },
      {
        href: "/app/ai",
        label: "OpsPilot AI",
        icon: Sparkles,
        permission: "ai:use",
      },
      {
        href: "/app/automations",
        label: "Automations",
        icon: Workflow,
        permission: "automation:view",
      },
    ],
  },
  {
    title: "Revenue",
    items: [
      {
        href: "/app/crm",
        label: "CRM & Pipeline",
        icon: Users,
        permission: "crm:view",
      },
      {
        href: "/app/sales",
        label: "Sales & Invoices",
        icon: ReceiptText,
        permission: "sales:view",
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        href: "/app/projects",
        label: "Projects & Tasks",
        icon: FolderKanban,
        permission: "projects:view",
      },
      {
        href: "/app/inventory",
        label: "Inventory",
        icon: Package,
        permission: "inventory:view",
      },
      {
        href: "/app/procurement",
        label: "Procurement",
        icon: Truck,
        permission: "procurement:view",
      },
    ],
  },
  {
    title: "People & Ledger",
    items: [
      {
        href: "/app/finance",
        label: "Finance",
        icon: Landmark,
        permission: "finance:view",
      },
      {
        href: "/app/hrms",
        label: "HRMS & Payroll",
        icon: UserCheck,
        permission: "hrms:view",
      },
      {
        href: "/app/documents",
        label: "Documents",
        icon: FileText,
        permission: "documents:view",
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        href: "/app/billing",
        label: "Billing & Plans",
        icon: CreditCard,
        permission: "workspace:billing",
      },
      { href: "/app/settings", label: "Team & Settings", icon: Settings },
    ],
  },
];

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

interface NotificationRow {
  id: number;
  title: string;
  message: string;
  type: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session } = useWorkspace();
  return (
    <WorkspaceChrome
      key={`${session?.tenant?.id}:${session?.role}:${session?.permissions.join(",")}`}
    >
      {children}
    </WorkspaceChrome>
  );
}
function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading, can, apiFetch, refreshSession, toast } =
    useWorkspace();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<NotificationRow[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [newWsModal, setNewWsModal] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsIndustry, setNewWsIndustry] = useState("Technology & Services");

  // Print views bypass full shell chrome
  const isPrintRoute =
    pathname?.includes("/print") || pathname?.startsWith("/app/hrms/payslip/");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}`,
        );
        setSearchResults(res.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, apiFetch]);

  const openNotifications = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    setQuickOpen(false);
    if (next) {
      try {
        const data = await apiFetch<{ notifications: NotificationRow[] }>(
          "/api/notifications",
        );
        setNotifItems(data.notifications || []);
      } catch {
        // ignore
      }
    }
  };

  const markAllRead = async () => {
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ markAllRead: true }),
      });
      setNotifItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    }
  };

  const switchWorkspace = async (targetTenantId: number) => {
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({ action: "switch_workspace", targetTenantId }),
      });
      setWsOpen(false);
      await refreshSession();
      toast("Switched active workspace");
      router.push("/app");
      router.refresh();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Unable to switch workspace",
        "error",
      );
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          action: "create_workspace",
          name: newWsName,
          industry: newWsIndustry,
        }),
      });
      setNewWsModal(false);
      setNewWsName("");
      await refreshSession();
      toast("Created new isolated workspace");
      router.push("/app");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Error creating workspace",
        "error",
      );
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      clearClientSession();
      router.replace("/login");
    } catch {
      toast("Could not sign out. Try again.", "error");
    }
  };

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#0B0F17]">
        <div className="flex flex-col items-center gap-3">
          <OpsPilotLogo size="lg" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Loading workspace session…
          </p>
        </div>
      </div>
    );
  }

  if (!session.user.emailVerified)
    return <VerifyEmail onLogout={handleLogout} />;

  if (isPrintRoute) {
    return <>{children}</>;
  }

  const initials = session.user.fullName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const quickActions = [
    { label: "New Customer", href: "/app/crm?new=customer", perm: "crm:write" },
    { label: "New Lead", href: "/app/crm?new=lead", perm: "crm:write" },
    {
      label: "Create Invoice",
      href: "/app/sales?new=invoice",
      perm: "sales:write",
    },
    {
      label: "Record Expense",
      href: "/app/finance?new=expense",
      perm: "finance:write",
    },
    {
      label: "Add Employee",
      href: "/app/hrms?new=employee",
      perm: "hrms:write",
    },
    {
      label: "Create Project",
      href: "/app/projects?new=project",
      perm: "projects:write",
    },
    {
      label: "Add Task",
      href: "/app/projects?new=task",
      perm: "projects:write",
    },
    {
      label: "Add Product",
      href: "/app/inventory?new=product",
      perm: "inventory:write",
    },
  ].filter((q) => can(q.perm));

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col bg-[#F8FAFC] dark:bg-[#0E1420] border-r border-slate-200/90 dark:border-slate-800/90">
      {/* Brand header */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <Link href="/app" onClick={() => setMobileOpen(false)}>
          <OpsPilotLogo size="sm" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-1 text-slate-500 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Workspace switcher */}
      <div className="relative px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={() => setWsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-left text-xs transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900 dark:text-white">
              {session.tenant.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="capitalize">{session.tenant.plan} plan</span>
              <span>·</span>
              <span className="capitalize">
                {session.role.replace("_", " ")}
              </span>
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>

        {wsOpen && (
          <div className="absolute right-3 left-3 z-30 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Isolated Workspaces
            </div>
            {session.workspaces.map((ws) => (
              <button
                key={ws.tenantId}
                type="button"
                onClick={() => switchWorkspace(ws.tenantId)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="truncate font-medium">{ws.name}</span>
                {ws.tenantId === session.tenant.id && (
                  <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                )}
              </button>
            ))}
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <button
              type="button"
              onClick={() => {
                setWsOpen(false);
                setNewWsModal(true);
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Create new workspace</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(
            (it) =>
              !it.permission ||
              can(it.permission) ||
              (it.href === "/app/hrms" && can("hrms:payroll")),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="mb-1 px-2.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/app"
                      ? pathname === "/app"
                      : pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                        active
                          ? "bg-slate-900 text-white dark:bg-indigo-600 dark:text-white"
                          : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom user footer */}
      <div className="border-t border-slate-200/80 p-3 dark:border-slate-800/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-indigo-600">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                {session.user.fullName}
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {session.user.email}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-white dark:bg-[#0B0F17]">
      {/* Desktop sidebar */}
      <aside className="no-print hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-60 lg:flex-col">
        {renderSidebarContent()}
      </aside>

      {/* Mobile slide-over sidebar */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-50 flex w-64 flex-col">
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main viewport */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Top Header */}
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/90 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800/90 dark:bg-[#0B0F17]/90">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 lg:hidden dark:border-slate-800 dark:text-slate-300"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Global Search Trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 w-48 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100/70 sm:w-72 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:border-slate-700"
            >
              <span className="flex items-center gap-2 truncate">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Search workspace…</span>
              </span>
              <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline dark:border-slate-700 dark:bg-slate-800">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Create Dropdown */}
            {quickActions.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setQuickOpen((v) => !v);
                    setNotifOpen(false);
                  }}
                  className="op-btn-primary h-9 px-3 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Quick Create</span>
                </button>
                {quickOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    {quickActions.map((qa) => (
                      <button
                        key={qa.label}
                        type="button"
                        onClick={() => {
                          setQuickOpen(false);
                          router.push(qa.href);
                        }}
                        className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {qa.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ThemeToggleButton />

            {/* Notifications Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={openNotifications}
                aria-label="Notifications"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Bell className="h-4 w-4" />
                {session.unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white tabular">
                    {session.unreadNotifications > 9
                      ? "9+"
                      : session.unreadNotifications}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifItems.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-slate-500">
                        You are all caught up.
                      </div>
                    ) : (
                      notifItems.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={async () => {
                            if (!n.isRead) {
                              await apiFetch("/api/notifications", {
                                method: "PATCH",
                                body: JSON.stringify({ id: n.id }),
                              });
                              await refreshSession();
                            }
                            setNotifOpen(false);
                            if (n.link) router.push(n.link);
                          }}
                          className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                            !n.isRead
                              ? "bg-indigo-50/40 dark:bg-indigo-950/20"
                              : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {n.title}
                            </span>
                            {!n.isRead && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {n.message}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Main Content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Global Search Command Modal */}
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Global Workspace Search"
        subtitle={`Search customers, employees, invoices, products, tasks, projects & documents in ${session.tenant.name}`}
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type a name, SKU, invoice #, project, or document…"
              className="op-input pl-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {searching ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Searching…
              </div>
            ) : searchQuery.trim() && searchResults.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No matching workspace records found.
              </div>
            ) : (
              (searchQuery.trim() ? searchResults : []).map((hit) => (
                <button
                  key={`${hit.type}-${hit.id}`}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    router.push(hit.href);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 rounded-lg"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {hit.title}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {hit.subtitle}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {hit.type}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Create New Isolated Workspace Modal */}
      <Modal
        open={newWsModal}
        onClose={() => setNewWsModal(false)}
        title="Create New Workspace"
        subtitle="Provision a completely isolated multi-tenant business environment"
      >
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          <div>
            <label className="op-label">Business / Workspace Name</label>
            <input
              required
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              placeholder="e.g. Horizon Commerce Pvt Ltd"
              className="op-input"
            />
          </div>
          <div>
            <label className="op-label">Industry</label>
            <input
              value={newWsIndustry}
              onChange={(e) => setNewWsIndustry(e.target.value)}
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewWsModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Create Workspace
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
