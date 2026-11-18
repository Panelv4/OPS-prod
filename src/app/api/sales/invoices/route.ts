import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  customers,
  invoiceItems,
  invoices,
  products,
  projects,
  stockMovements,
  transactions,
} from "@/db/schema";
import {
  type AuthContext,
  ApiError,
  handleApiError,
  requireAuth,
} from "@/lib/auth";
import {
  applyPaymentToInvoice,
  applyRefundToInvoice,
  calculateInvoiceTotals,
  formatMoney,
  toCents,
} from "@/lib/finance";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { createNotification, recordAuditLog } from "@/lib/audit";
import { dispatchWorkflowEvent } from "@/lib/automation";

async function postInvoiceStock(
  tx: Database,
  ctx: AuthContext,
  invoiceNumber: string,
  items: { productId: number | null; quantity: number }[],
) {
  for (const it of [...items].sort(
    (a, b) => (a.productId || 0) - (b.productId || 0),
  )) {
    if (!it.productId) continue;
    const [prod] = await tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.id, it.productId),
          eq(products.tenantId, ctx.tenantId),
          eq(products.itemType, "product"),
        ),
      )
      .limit(1)
      .for("update");
    if (!prod) continue;
    if (prod.stockQuantity < it.quantity)
      throw new ApiError(409, "Insufficient stock for invoice.");
    const newStock = prod.stockQuantity - it.quantity;
    await tx
      .update(products)
      .set({ stockQuantity: newStock, updatedAt: new Date() })
      .where(
        and(eq(products.id, prod.id), eq(products.tenantId, ctx.tenantId)),
      );

    await tx.insert(stockMovements).values({
      tenantId: ctx.tenantId,
      productId: prod.id,
      movementType: "sale",
      quantityDelta: newStock - prod.stockQuantity,
      previousStock: prod.stockQuantity,
      newStock,
      referenceType: "INVOICE",
      referenceId: invoiceNumber,
      reason: `Sold on ${invoiceNumber}`,
      actorName: ctx.user.fullName,
      createdByUserId: ctx.user.id,
    });

    if (newStock <= prod.reorderLevel) {
      await dispatchWorkflowEvent(
        {
          tenantId: ctx.tenantId,
          triggerEvent: "stock.low",
          payload: {
            productId: prod.id,
            name: prod.name,
            sku: prod.sku,
            stockQuantity: newStock,
            reorderLevel: prod.reorderLevel,
            link: "/app/inventory",
          },
          userId: ctx.user.id,
        },
        tx,
      );
    }
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "sales:view");
    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");

    if (idParam) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, "Invalid document ID.");
      }
      const [doc] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, ctx.tenantId)))
        .limit(1);
      if (!doc) {
        throw new ApiError(404, "Sales document not found in this workspace.");
      }
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, doc.customerId),
            eq(customers.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      const items = await db
        .select()
        .from(invoiceItems)
        .where(
          and(
            eq(invoiceItems.invoiceId, doc.id),
            eq(invoiceItems.tenantId, ctx.tenantId),
          ),
        );

      return NextResponse.json({
        invoice: doc,
        customer: customer
          ? {
              name: customer.name,
              company: customer.company,
              address: customer.address,
              email: customer.email,
              phone: customer.phone,
            }
          : null,
        items,
        tenant: {
          name: ctx.tenant.name,
          address: ctx.tenant.address,
          taxId: ctx.tenant.taxId,
          taxLabel: ctx.tenant.taxLabel,
          currency: ctx.tenant.currency,
          website: ctx.tenant.website,
        },
      });
    }

    const docType = url.searchParams.get("docType") || "all";
    const status = url.searchParams.get("status") || "all";
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();

    let rows = await db
      .select({
        id: invoices.id,
        docType: invoices.docType,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotalCents: invoices.subtotalCents,
        discountCents: invoices.discountCents,
        taxCents: invoices.taxCents,
        totalCents: invoices.totalCents,
        paidCents: invoices.paidCents,
        refundedCents: invoices.refundedCents,
        balanceCents: invoices.balanceCents,
        currency: invoices.currency,
        reminderCount: invoices.reminderCount,
        customerId: invoices.customerId,
        customerName: customers.name,
        customerCompany: customers.company,
        customerEmail: customers.email,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.tenantId, ctx.tenantId))
      .orderBy(desc(invoices.createdAt));

    if (docType !== "all") rows = rows.filter((r) => r.docType === docType);
    if (status !== "all") rows = rows.filter((r) => r.status === status);
    if (search) {
      rows = rows.filter(
        (r) =>
          r.invoiceNumber.toLowerCase().includes(search) ||
          r.customerCompany.toLowerCase().includes(search) ||
          r.customerName.toLowerCase().includes(search),
      );
    }

    return NextResponse.json({ invoices: rows, currency: ctx.tenant.currency });
  } catch (err) {
    return handleApiError(err);
  }
}

const createInvoiceSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive(),
  docType: z.enum(["quotation", "sales_order", "invoice"]).default("invoice"),
  issueDate: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  orderDiscount: z.number().min(0).default(0),
  orderDiscountCents: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional(),
  deductStock: z.boolean().default(true),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive().nullable().optional(),
        description: z.string().min(1).max(200),
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0).optional(),
        unitPriceCents: z.number().int().min(0).optional(),
        discount: z.number().min(0).optional(),
        discountCents: z.number().int().min(0).optional(),
        taxRateBps: z.number().int().min(0).max(10000).optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "sales:write");
    const body = createInvoiceSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      // Enforce tenant ownership on customer
      const [customer] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, body.customerId),
            eq(customers.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!customer) {
        throw new ApiError(404, "Customer not found in your workspace.");
      }

      if (body.projectId) {
        if (!ctx.permissions.has("projects:view"))
          throw new ApiError(403, "Project access required.");
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, body.projectId),
              eq(projects.tenantId, ctx.tenantId),
              eq(projects.customerId, customer.id),
            ),
          );
        if (!project)
          throw new ApiError(
            400,
            "Select a project for this customer in your workspace.",
          );
      }
      const computed = calculateInvoiceTotals(
        body.items.map((item) => ({
          productId: item.productId ?? null,
          description: sanitizeText(item.description),
          quantity: item.quantity,
          unitPriceCents:
            item.unitPriceCents !== undefined
              ? item.unitPriceCents
              : toCents(item.unitPrice ?? 0),
          discountCents:
            item.discountCents !== undefined
              ? item.discountCents
              : toCents(item.discount ?? 0),
          taxRateBps: item.taxRateBps ?? ctx.tenant.defaultTaxBps,
        })),
        body.orderDiscountCents !== undefined
          ? body.orderDiscountCents
          : toCents(body.orderDiscount),
      );

      const prefix =
        body.docType === "quotation"
          ? "QTN"
          : body.docType === "sales_order"
            ? "SO"
            : "INV";
      const year = new Date().getFullYear();
      const existingCount = (
        await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.tenantId, ctx.tenantId))
      ).length;
      const invoiceNumber = `${prefix}-${year}-${String(
        existingCount + 101,
      ).padStart(3, "0")}-${generateSecureToken(2).toUpperCase()}`;

      const today = new Date().toISOString().slice(0, 10);
      const defaultDue = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const issueDate = body.issueDate || today;
      const dueDate = body.dueDate || defaultDue;
      const initialStatus =
        body.docType === "invoice" && dueDate < today ? "overdue" : "sent";

      const [created] = await tx
        .insert(invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          projectId: body.projectId ?? null,
          docType: body.docType,
          invoiceNumber,
          status: initialStatus,
          issueDate,
          dueDate,
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          paidCents: 0,
          refundedCents: 0,
          balanceCents: computed.totalCents,
          currency: ctx.tenant.currency,
          notes: body.notes ? sanitizeText(body.notes) : null,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await tx.insert(invoiceItems).values(
        computed.items.map((it) => ({
          tenantId: ctx.tenantId,
          invoiceId: created.id,
          productId: it.productId,
          description: it.description,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          discountCents: it.discountCents,
          taxRateBps: it.taxRateBps,
          taxAmountCents: it.taxAmountCents,
          lineTotalCents: it.lineTotalCents,
        })),
      );

      // Traceable stock deduction for physical products on final invoices
      if (body.docType === "invoice" && body.deductStock) {
        await postInvoiceStock(tx, ctx, invoiceNumber, computed.items);
      }

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: `${body.docType}.created`,
          module: "sales",
          entityType: body.docType,
          entityId: created.id,
          summary: `Created ${invoiceNumber} for ${customer.company} (${formatMoney(
            created.totalCents,
            created.currency,
          )})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ invoice: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchInvoiceSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum([
    "record_payment",
    "refund",
    "send_reminder",
    "convert_to_order",
    "convert_to_invoice",
    "cancel",
  ]),
  amount: z.number().positive().optional(),
  amountCents: z.number().int().positive().optional(),
  paymentMethod: z.string().max(50).default("Bank Transfer"),
  reason: z.string().max(300).optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "sales:write");
    const body = patchInvoiceSchema.parse(await readJson(request));

    return await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.id, body.id), eq(invoices.tenantId, ctx.tenantId)),
        )
        .limit(1)
        .for("update");
      if (!inv) {
        throw new ApiError(404, "Invoice not found in this workspace.");
      }

      const [customer] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, inv.customerId),
            eq(customers.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
        .for("update");

      const today = new Date().toISOString().slice(0, 10);

      if (
        body.action === "convert_to_order" ||
        body.action === "convert_to_invoice"
      ) {
        if (inv.docType === "invoice" || inv.status === "cancelled")
          throw new ApiError(409, "Document cannot be converted.");
        const nextType =
          body.action === "convert_to_order" ? "sales_order" : "invoice";
        const prefix = nextType === "sales_order" ? "SO" : "INV";
        const nextNumber = `${prefix}-${new Date().getFullYear()}-${generateSecureToken(
          3,
        ).toUpperCase()}`;
        if (nextType === "invoice") {
          const lines = await tx
            .select({
              productId: invoiceItems.productId,
              quantity: invoiceItems.quantity,
            })
            .from(invoiceItems)
            .where(
              and(
                eq(invoiceItems.invoiceId, inv.id),
                eq(invoiceItems.tenantId, ctx.tenantId),
              ),
            );
          await postInvoiceStock(tx, ctx, nextNumber, lines);
        } else if (inv.docType !== "quotation")
          throw new ApiError(409, "Only a quotation can convert to an order.");
        const [updated] = await tx
          .update(invoices)
          .set({
            docType: nextType,
            invoiceNumber: nextNumber,
            status: nextType === "sales_order" ? "approved" : "sent",
            updatedAt: new Date(),
          })
          .where(
            and(eq(invoices.id, inv.id), eq(invoices.tenantId, ctx.tenantId)),
          )
          .returning();

        await recordAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: `sales.converted_to_${nextType}`,
            module: "sales",
            entityType: nextType,
            entityId: inv.id,
            summary: `Converted ${inv.invoiceNumber} to ${nextNumber}`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ invoice: updated });
      }

      if (body.action === "record_payment") {
        if (inv.docType !== "invoice" || inv.status === "refunded")
          throw new ApiError(400, "Only an open invoice accepts payments.");
        const paymentCents =
          body.amountCents !== undefined
            ? body.amountCents
            : body.amount !== undefined
              ? toCents(body.amount)
              : inv.balanceCents;

        const result = applyPaymentToInvoice(inv, paymentCents);
        const [updated] = await tx
          .update(invoices)
          .set({
            paidCents: result.paidCents,
            balanceCents: result.balanceCents,
            status: result.status,
            updatedAt: new Date(),
          })
          .where(
            and(eq(invoices.id, inv.id), eq(invoices.tenantId, ctx.tenantId)),
          )
          .returning();

        // Post immutable credit ledger transaction
        await tx.insert(transactions).values({
          tenantId: ctx.tenantId,
          entryNumber: `TXN-${generateSecureToken(4).toUpperCase()}`,
          type: "income",
          direction: "credit",
          category: "Invoice Collections",
          amountCents: paymentCents,
          paymentMethod: sanitizeText(body.paymentMethod),
          transactionDate: today,
          description: `Payment received on ${inv.invoiceNumber} (${
            customer?.company || "Customer"
          })`,
          customerId: inv.customerId,
          invoiceId: inv.id,
          projectId: inv.projectId,
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        });

        if (customer) {
          await tx
            .update(customers)
            .set({
              totalSpentCents: customer.totalSpentCents + paymentCents,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(customers.id, customer.id),
                eq(customers.tenantId, ctx.tenantId),
              ),
            );
        }

        await recordAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "invoice.payment_recorded",
            module: "sales",
            entityType: "invoice",
            entityId: inv.id,
            summary: `Recorded ${formatMoney(paymentCents, inv.currency)} payment on ${
              inv.invoiceNumber
            } (status: ${result.status})`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        if (result.status === "paid") {
          await dispatchWorkflowEvent(
            {
              tenantId: ctx.tenantId,
              triggerEvent: "invoice.paid",
              payload: {
                invoiceId: inv.id,
                invoiceNumber: inv.invoiceNumber,
                totalCents: inv.totalCents,
                link: "/app/sales",
              },
              userId: ctx.user.id,
            },
            tx,
          );
        }

        return NextResponse.json({ invoice: updated });
      }

      if (body.action === "refund") {
        if (!ctx.permissions.has("sales:refund")) {
          throw new ApiError(403, "Your role lacks sales:refund permission.");
        }
        const refundCents =
          body.amountCents !== undefined
            ? body.amountCents
            : body.amount !== undefined
              ? toCents(body.amount)
              : inv.paidCents - inv.refundedCents;

        const result = applyRefundToInvoice(inv, refundCents);
        const [updated] = await tx
          .update(invoices)
          .set({
            refundedCents: result.refundedCents,
            balanceCents: result.balanceCents,
            status: result.status,
            updatedAt: new Date(),
          })
          .where(
            and(eq(invoices.id, inv.id), eq(invoices.tenantId, ctx.tenantId)),
          )
          .returning();

        if (customer)
          await tx
            .update(customers)
            .set({
              totalSpentCents: Math.max(
                0,
                customer.totalSpentCents - refundCents,
              ),
            })
            .where(
              and(
                eq(customers.id, customer.id),
                eq(customers.tenantId, ctx.tenantId),
              ),
            );
        // Post immutable refund debit transaction
        await tx.insert(transactions).values({
          tenantId: ctx.tenantId,
          entryNumber: `RFN-${generateSecureToken(4).toUpperCase()}`,
          type: "refund",
          direction: "debit",
          category: "Customer Refunds",
          amountCents: refundCents,
          paymentMethod: sanitizeText(body.paymentMethod),
          transactionDate: today,
          description: `Refund issued on ${inv.invoiceNumber}${
            body.reason ? `: ${sanitizeText(body.reason)}` : ""
          }`,
          customerId: inv.customerId,
          invoiceId: inv.id,
          projectId: inv.projectId,
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        });

        await recordAuditLog(
          {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "invoice.refunded",
            module: "sales",
            entityType: "invoice",
            entityId: inv.id,
            summary: `Issued refund of ${formatMoney(refundCents, inv.currency)} on ${
              inv.invoiceNumber
            }`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ invoice: updated });
      }

      if (body.action === "send_reminder") {
        const [updated] = await tx
          .update(invoices)
          .set({
            reminderCount: inv.reminderCount + 1,
            lastReminderAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(invoices.id, inv.id), eq(invoices.tenantId, ctx.tenantId)),
          )
          .returning();

        await createNotification(
          {
            tenantId: ctx.tenantId,
            targetRole: "accountant",
            title: `Reminder logged — ${inv.invoiceNumber}`,
            message: `Internal collection follow-up #${updated.reminderCount} for ${
              customer?.company || "customer"
            } (${formatMoney(inv.balanceCents, inv.currency)} due).`,
            type: "info",
            link: "/app/sales",
          },
          tx,
        );

        return NextResponse.json({ invoice: updated });
      }

      // cancel
      if (inv.paidCents > 0)
        throw new ApiError(
          409,
          "Cannot cancel a document with payment history.",
        );
      if (inv.status === "cancelled")
        throw new ApiError(409, "Already cancelled.");
      const issued = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, ctx.tenantId),
            eq(stockMovements.referenceType, "INVOICE"),
            eq(stockMovements.referenceId, inv.invoiceNumber),
            eq(stockMovements.movementType, "sale"),
          ),
        )
        .orderBy(stockMovements.productId);
      for (const movement of issued) {
        const [product] = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, movement.productId),
              eq(products.tenantId, ctx.tenantId),
            ),
          )
          .for("update");
        const newStock = product.stockQuantity - movement.quantityDelta;
        await tx
          .update(products)
          .set({ stockQuantity: newStock, updatedAt: new Date() })
          .where(
            and(
              eq(products.id, product.id),
              eq(products.tenantId, ctx.tenantId),
            ),
          );
        await tx
          .insert(stockMovements)
          .values({
            tenantId: ctx.tenantId,
            productId: product.id,
            movementType: "in",
            quantityDelta: -movement.quantityDelta,
            previousStock: product.stockQuantity,
            newStock,
            referenceType: "CANCELLATION",
            referenceId: inv.invoiceNumber,
            reason: "Cancelled unpaid invoice",
            actorName: ctx.user.fullName,
            createdByUserId: ctx.user.id,
          });
      }
      const [cancelled] = await tx
        .update(invoices)
        .set({ status: "cancelled", balanceCents: 0, updatedAt: new Date() })
        .where(
          and(eq(invoices.id, inv.id), eq(invoices.tenantId, ctx.tenantId)),
        )
        .returning();

      return NextResponse.json({ invoice: cancelled });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
