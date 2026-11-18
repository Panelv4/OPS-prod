import { canAccessDocument } from "@/lib/permissions";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  documents,
  invoices,
  projects,
  purchaseOrders,
  transactions,
  vendors,
} from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { formatMoney, toCents } from "@/lib/finance";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "finance:view");
    const tId = ctx.tenantId;
    const url = new URL(request.url);
    const direction = url.searchParams.get("direction") || "all";
    const category = url.searchParams.get("category") || "all";

    const [txRows, receivableRows, payableRows] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(eq(transactions.tenantId, tId))
        .orderBy(desc(transactions.transactionDate), desc(transactions.id)),
      db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          dueDate: invoices.dueDate,
          status: invoices.status,
          totalCents: invoices.totalCents,
          balanceCents: invoices.balanceCents,
          customerCompany: customers.company,
        })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .where(
          and(
            eq(invoices.tenantId, tId),
            eq(invoices.docType, "invoice"),
            gt(invoices.balanceCents, 0),
            ne(invoices.status, "cancelled"),
          ),
        ),
      db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          expectedDate: purchaseOrders.expectedDate,
          status: purchaseOrders.status,
          totalCents: purchaseOrders.totalCents,
          balanceCents: purchaseOrders.balanceCents,
          vendorName: vendors.name,
        })
        .from(purchaseOrders)
        .innerJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
        .where(
          and(
            eq(purchaseOrders.tenantId, tId),
            gt(purchaseOrders.balanceCents, 0),
            ne(purchaseOrders.status, "cancelled"),
          ),
        ),
    ]);

    const postedRows = txRows.filter((t) => t.status === "posted");
    let totalIncomeCents = 0;
    let totalExpenseCents = 0;
    const monthlyMap = new Map<
      string,
      { incomeCents: number; expenseCents: number }
    >();
    const incomeByCat = new Map<string, number>();
    const expenseByCat = new Map<string, number>();

    for (const tx of postedRows) {
      const ym = tx.transactionDate.slice(0, 7);
      const bucket = monthlyMap.get(ym) || { incomeCents: 0, expenseCents: 0 };
      if (tx.direction === "credit") {
        totalIncomeCents += tx.amountCents;
        bucket.incomeCents += tx.amountCents;
        incomeByCat.set(
          tx.category,
          (incomeByCat.get(tx.category) || 0) + tx.amountCents,
        );
      } else {
        totalExpenseCents += tx.amountCents;
        bucket.expenseCents += tx.amountCents;
        expenseByCat.set(
          tx.category,
          (expenseByCat.get(tx.category) || 0) + tx.amountCents,
        );
      }
      monthlyMap.set(ym, bucket);
    }

    const monthlyReport = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, b]) => ({
        month,
        incomeCents: b.incomeCents,
        expenseCents: b.expenseCents,
        netCashFlowCents: b.incomeCents - b.expenseCents,
        income: Math.round(b.incomeCents / 100),
        expenses: Math.round(b.expenseCents / 100),
        net: Math.round((b.incomeCents - b.expenseCents) / 100),
      }));

    let filtered = txRows;
    if (direction !== "all")
      filtered = filtered.filter((t) => t.direction === direction);
    if (category !== "all")
      filtered = filtered.filter((t) => t.category === category);

    return NextResponse.json({
      currency: ctx.tenant.currency,
      summary: {
        totalIncomeCents,
        totalExpenseCents,
        netProfitCents: totalIncomeCents - totalExpenseCents,
        receivablesCents: receivableRows.reduce(
          (s, r) => s + r.balanceCents,
          0,
        ),
        payablesCents: payableRows.reduce((s, p) => s + p.balanceCents, 0),
      },
      profitAndLoss: {
        incomeCategories: Array.from(incomeByCat.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([category, amountCents]) => ({ category, amountCents })),
        expenseCategories: Array.from(expenseByCat.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([category, amountCents]) => ({ category, amountCents })),
      },
      monthlyReport,
      receivables: receivableRows,
      payables: payableRows,
      transactions: filtered.filter(
        (t) =>
          t.type !== "payroll" ||
          ctx.permissions.has("hrms:payroll") ||
          ctx.permissions.has("hrms:confidential"),
      ),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createTxSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  type: z.enum(["income", "expense", "vendor_payment"]).default("expense"),
  category: z.string().min(2).max(80),
  amount: z.number().positive().optional(),
  amountCents: z.number().int().positive().optional(),
  paymentMethod: z.string().max(50).default("Bank Transfer"),
  transactionDate: z.iso.date().optional(),
  description: z.string().min(2).max(300),
  receiptDocumentId: z.number().int().positive().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "finance:write");
    const body = createTxSchema.parse(await readJson(request));

    const amountCents =
      body.amountCents !== undefined
        ? body.amountCents
        : body.amount !== undefined
          ? toCents(body.amount)
          : 0;
    if (amountCents <= 0) {
      throw new ApiError(400, "Transaction amount must be greater than zero.");
    }

    return await db.transaction(async (tx) => {
      if (body.projectId) {
        const [p] = ctx.permissions.has("projects:view")
          ? await tx
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(
                  eq(projects.id, body.projectId),
                  eq(projects.tenantId, ctx.tenantId),
                ),
              )
          : [];
        if (!p) throw new ApiError(404, "Project unavailable.");
      }
      if (body.receiptDocumentId) {
        const [doc] = await tx
          .select({ id: documents.id, visibility: documents.visibility })
          .from(documents)
          .where(
            and(
              eq(documents.id, body.receiptDocumentId),
              eq(documents.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        if (
          !doc ||
          !ctx.permissions.has("documents:view") ||
          !canAccessDocument(doc.visibility, ctx.role, ctx.permissions)
        ) {
          throw new ApiError(
            404,
            "Receipt document not found in your workspace.",
          );
        }
      }

      const direction = body.type === "income" ? "credit" : "debit";
      const entryNumber = `TXN-${generateSecureToken(4).toUpperCase()}`;

      const [created] = await tx
        .insert(transactions)
        .values({
          tenantId: ctx.tenantId,
          entryNumber,
          projectId: body.projectId ?? null,
          type: body.type,
          direction,
          category: sanitizeText(body.category),
          amountCents,
          paymentMethod: sanitizeText(body.paymentMethod),
          transactionDate:
            body.transactionDate || new Date().toISOString().slice(0, 10),
          description: sanitizeText(body.description),
          receiptDocumentId: body.receiptDocumentId ?? null,
          status: "posted",
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: `ledger.${body.type}_posted`,
          module: "finance",
          entityType: "transaction",
          entityId: created.id,
          summary: `Posted ${entryNumber}: ${body.type} of ${formatMoney(
            amountCents,
            ctx.tenant.currency,
          )} (${created.category})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ transaction: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const reverseTxSchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().min(3).max(240),
});

/**
 * Historical financial transactions are NEVER silently overwritten or deleted.
 * Corrections post an auditable reversing entry and mark the original as `reversed`.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "finance:reverse");
    const body = reverseTxSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, body.id),
            eq(transactions.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
        .for("update");
      if (!original) {
        throw new ApiError(404, "Ledger entry not found in this workspace.");
      }
      if (
        original.invoiceId ||
        original.purchaseOrderId ||
        original.type === "payroll"
      )
        throw new ApiError(
          409,
          "Correct linked settlements in their originating module.",
        );
      if (original.status === "reversed") {
        throw new ApiError(400, "This transaction has already been reversed.");
      }

      await tx
        .update(transactions)
        .set({ status: "reversed" })
        .where(
          and(
            eq(transactions.id, original.id),
            eq(transactions.tenantId, ctx.tenantId),
          ),
        );

      const reversalEntryNumber = `REV-${generateSecureToken(4).toUpperCase()}`;
      const [reversal] = await tx
        .insert(transactions)
        .values({
          tenantId: ctx.tenantId,
          entryNumber: reversalEntryNumber,
          type: "reversal",
          direction: original.direction === "credit" ? "debit" : "credit",
          category: original.category,
          amountCents: original.amountCents,
          paymentMethod: original.paymentMethod,
          transactionDate: new Date().toISOString().slice(0, 10),
          description: `Reversal of ${original.entryNumber}: ${sanitizeText(body.reason)}`,
          status: "reversed",
          projectId: original.projectId,
          reversalOfId: original.id,
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "ledger.entry_reversed",
          module: "finance",
          entityType: "transaction",
          entityId: original.id,
          summary: `Reversed ${original.entryNumber} via ${reversalEntryNumber} — Reason: ${sanitizeText(
            body.reason,
          )}`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ originalId: original.id, reversal });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
