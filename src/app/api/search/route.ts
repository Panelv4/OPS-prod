import { NextResponse } from "next/server";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  documents,
  employees,
  invoices,
  products,
  projects,
  tasks,
} from "@/db/schema";
import { handleApiError, requireAuth } from "@/lib/auth";
import { canAccessDocument } from "@/lib/permissions";
import { formatMoney } from "@/lib/finance";

export interface SearchHit {
  type:
    | "customer"
    | "employee"
    | "invoice"
    | "product"
    | "task"
    | "project"
    | "document";
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    if (q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    if (q.length > 120)
      return NextResponse.json(
        { error: "Search is limited to 120 characters." },
        { status: 400 },
      );
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const tId = ctx.tenantId;
    const results: SearchHit[] = [];

    if (ctx.permissions.has("crm:view")) {
      const rows = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, tId),
            or(
              ilike(customers.name, pattern),
              ilike(customers.company, pattern),
              ilike(customers.email, pattern),
            ),
          ),
        )
        .limit(25);
      for (const c of rows) {
        if (
          c.name.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        ) {
          results.push({
            type: "customer",
            id: c.id,
            title: `${c.name} — ${c.company}`,
            subtitle: c.email,
            href: "/app/crm",
          });
        }
      }
    }

    if (ctx.permissions.has("hrms:view")) {
      const rows = await db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          department: employees.department,
          designation: employees.designation,
          employeeCode: employees.employeeCode,
        })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, tId),
            or(
              ilike(employees.fullName, pattern),
              ilike(employees.department, pattern),
              ilike(employees.designation, pattern),
              ilike(employees.employeeCode, pattern),
            ),
          ),
        )
        .limit(25);
      for (const e of rows) {
        if (
          e.fullName.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.designation.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q)
        ) {
          results.push({
            type: "employee",
            id: e.id,
            title: `${e.fullName} (${e.employeeCode})`,
            subtitle: `${e.designation} · ${e.department}`,
            href: "/app/hrms",
          });
        }
      }
    }

    if (ctx.permissions.has("sales:view")) {
      const rows = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tId),
            or(
              ilike(invoices.invoiceNumber, pattern),
              ilike(invoices.status, pattern),
            ),
          ),
        )
        .limit(25);
      for (const i of rows) {
        if (
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q)
        ) {
          results.push({
            type: "invoice",
            id: i.id,
            title: i.invoiceNumber,
            subtitle: `${i.docType.toUpperCase()} · ${i.status} · ${formatMoney(
              i.totalCents,
              i.currency,
            )}`,
            href: "/app/sales",
          });
        }
      }
    }

    if (ctx.permissions.has("inventory:view")) {
      const rows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.tenantId, tId),
            or(
              ilike(products.name, pattern),
              ilike(products.sku, pattern),
              ilike(products.category, pattern),
            ),
          ),
        )
        .limit(25);
      for (const p of rows) {
        if (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        ) {
          results.push({
            type: "product",
            id: p.id,
            title: `${p.name} (${p.sku})`,
            subtitle: `${p.category} · Stock: ${p.stockQuantity}`,
            href: "/app/inventory",
          });
        }
      }
    }

    if (ctx.permissions.has("projects:view")) {
      const [pRows, tRows] = await Promise.all([
        db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.tenantId, tId),
              or(ilike(projects.name, pattern), ilike(projects.code, pattern)),
            ),
          )
          .limit(25),
        db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.tenantId, tId),
              or(
                ilike(tasks.title, pattern),
                ilike(tasks.assigneeName, pattern),
              ),
            ),
          )
          .limit(25),
      ]);
      for (const p of pRows) {
        if (
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q)
        ) {
          results.push({
            type: "project",
            id: p.id,
            title: `${p.name} (${p.code})`,
            subtitle: `Status: ${p.status} · Due ${p.deadline}`,
            href: "/app/projects",
          });
        }
      }
      for (const t of tRows) {
        if (
          t.title.toLowerCase().includes(q) ||
          (t.assigneeName || "").toLowerCase().includes(q)
        ) {
          results.push({
            type: "task",
            id: t.id,
            title: t.title,
            subtitle: `${t.status.replace("_", " ")} · ${t.assigneeName || "Unassigned"}`,
            href: "/app/projects",
          });
        }
      }
    }

    if (ctx.permissions.has("documents:view")) {
      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          fileName: documents.fileName,
          category: documents.category,
          visibility: documents.visibility,
        })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, tId),
            or(
              ilike(documents.title, pattern),
              ilike(documents.fileName, pattern),
            ),
            inArray(
              documents.visibility,
              ["workspace", "managers", "hr_only", "finance_only"].filter((v) =>
                canAccessDocument(v, ctx.role, ctx.permissions),
              ),
            ),
          ),
        )
        .limit(25);
      for (const d of rows) {
        if (!canAccessDocument(d.visibility, ctx.role, ctx.permissions))
          continue;
        if (
          d.title.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q)
        ) {
          results.push({
            type: "document",
            id: d.id,
            title: d.title,
            subtitle: `${d.fileName} · ${d.category}`,
            href: "/app/documents",
          });
        }
      }
    }

    return NextResponse.json({ results: results.slice(0, 25) });
  } catch (err) {
    return handleApiError(err);
  }
}
