import type { DashboardWidgetConfig, WorkspaceRole } from "@/db/schema";

export const ALL_ROLES: {
  id: WorkspaceRole;
  label: string;
  description: string;
}[] = [
  {
    id: "owner",
    label: "Owner",
    description: "Full workspace, security, and billing control",
  },
  {
    id: "administrator",
    label: "Administrator",
    description: "Full operational and user management access",
  },
  {
    id: "manager",
    label: "Manager",
    description: "Cross-module operations, approvals, projects, and reports",
  },
  {
    id: "hr_manager",
    label: "HR Manager",
    description: "Employee records, attendance, leave approvals, and payroll",
  },
  {
    id: "accountant",
    label: "Accountant",
    description: "Ledger, invoicing, payables, receivables, and tax reports",
  },
  {
    id: "salesperson",
    label: "Salesperson",
    description: "CRM customers, leads pipeline, quotations, and sales orders",
  },
  {
    id: "employee",
    label: "Employee",
    description:
      "Assigned projects, tasks, self-attendance, leave, and shared docs",
  },
];

export const ALL_PERMISSIONS = [
  "dashboard:view",
  "dashboard:customize",
  "crm:view",
  "crm:write",
  "crm:delete",
  "sales:view",
  "sales:write",
  "sales:refund",
  "finance:view",
  "finance:write",
  "finance:reverse",
  "hrms:view",
  "hrms:write",
  "hrms:confidential",
  "hrms:payroll",
  "inventory:view",
  "inventory:write",
  "inventory:adjust",
  "procurement:view",
  "procurement:write",
  "procurement:approve",
  "projects:view",
  "projects:write",
  "documents:view",
  "documents:write",
  "documents:restricted",
  "ai:use",
  "ai:configure",
  "automation:view",
  "automation:write",
  "automation:approve",
  "workspace:manage",
  "workspace:users",
  "workspace:billing",
  "workspace:audit",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  administrator: ALL_PERMISSIONS.filter((p) => p !== "workspace:billing"),
  manager: [
    "dashboard:view",
    "dashboard:customize",
    "crm:view",
    "crm:write",
    "sales:view",
    "sales:write",
    "finance:view",
    "hrms:view",
    "hrms:write",
    "inventory:view",
    "inventory:write",
    "inventory:adjust",
    "procurement:view",
    "procurement:write",
    "procurement:approve",
    "projects:view",
    "projects:write",
    "documents:view",
    "documents:write",
    "documents:restricted",
    "ai:use",
    "automation:view",
    "automation:write",
    "automation:approve",
    "workspace:audit",
  ],
  hr_manager: [
    "dashboard:view",
    "hrms:view",
    "hrms:write",
    "hrms:confidential",
    "hrms:payroll",
    "projects:view",
    "documents:view",
    "documents:write",
    "documents:restricted",
    "ai:use",
    "automation:view",
  ],
  accountant: [
    "dashboard:view",
    "crm:view",
    "sales:view",
    "sales:write",
    "sales:refund",
    "finance:view",
    "finance:write",
    "finance:reverse",
    "hrms:payroll",
    "inventory:view",
    "procurement:view",
    "procurement:write",
    "documents:view",
    "documents:write",
    "documents:restricted",
    "ai:use",
    "workspace:audit",
  ],
  salesperson: [
    "dashboard:view",
    "crm:view",
    "crm:write",
    "sales:view",
    "sales:write",
    "inventory:view",
    "projects:view",
    "documents:view",
    "documents:write",
    "ai:use",
  ],
  employee: [
    "dashboard:view",
    "hrms:view",
    "projects:view",
    "projects:write",
    "documents:view",
    "ai:use",
  ],
};

export function resolveUserPermissions(params: {
  role: WorkspaceRole;
  tenantRolePermissions?: Record<string, string[]> | null;
  customPermissions?: string[] | null;
}): Set<string> {
  if (params.role === "owner") {
    return new Set(ALL_PERMISSIONS);
  }
  const configured = params.tenantRolePermissions?.[params.role];
  const base = Array.isArray(configured)
    ? configured
    : DEFAULT_ROLE_PERMISSIONS[params.role] || [];
  const merged = new Set<string>(base);
  if (Array.isArray(params.customPermissions)) {
    for (const p of params.customPermissions) {
      merged.add(p);
    }
  }
  merged.delete("workspace:billing"); // Reserved for owners, including for legacy custom matrices.
  return merged;
}

export function hasPermission(
  permissions: Set<string>,
  required: Permission,
): boolean {
  return permissions.has(required);
}

export function canAccessDocument(
  visibility: string,
  role: WorkspaceRole,
  permissions: Set<string>,
): boolean {
  if (role === "owner" || role === "administrator") return true;
  if (visibility === "workspace") return permissions.has("documents:view");
  if (visibility === "managers") {
    return (
      role === "manager" ||
      role === "hr_manager" ||
      role === "accountant" ||
      permissions.has("documents:restricted")
    );
  }
  if (visibility === "hr_only") {
    return role === "hr_manager" || permissions.has("hrms:confidential");
  }
  if (visibility === "finance_only") {
    return role === "accountant" || permissions.has("finance:write");
  }
  return false;
}

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetConfig[] = [
  {
    id: "financial_kpis",
    label: "Financial Overview KPIs",
    visible: true,
    order: 1,
  },
  {
    id: "operations_kpis",
    label: "CRM, HRMS & Ops Pulse",
    visible: true,
    order: 2,
  },
  {
    id: "quick_actions",
    label: "Quick Business Actions",
    visible: true,
    order: 3,
  },
  {
    id: "revenue_chart",
    label: "Recorded cash flow",
    visible: true,
    order: 4,
  },
  {
    id: "pipeline_chart",
    label: "Sales Pipeline & Conversion",
    visible: true,
    order: 5,
  },
  {
    id: "expense_chart",
    label: "Expense Categories & Customer Growth",
    visible: true,
    order: 6,
  },
  {
    id: "alerts_activity",
    label: "Inventory Alerts & Live Audit Feed",
    visible: true,
    order: 7,
  },
];

export { DEFAULT_PLANS, type PlanDefinition } from "./plans";
