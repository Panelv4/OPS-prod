import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  transactions,
  vendors,
} from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { calculateInvoiceTotals, formatMoney, toCents } from "@/lib/finance";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";
import { dispatchWorkflowEvent } from "@/lib/automation";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "procurement:view");
    const tId = ctx.tenantId;

    const [vendorRows, poRows, poItemRows, productRows] = await Promise.all([
      db
        .select()
        .from(vendors)
        .where(eq(vendors.tenantId, tId))
        .orderBy(desc(vendors.createdAt)),
      db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.tenantId, tId))
        .orderBy(desc(purchaseOrders.createdAt)),
      db
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.tenantId, tId)),
      db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          purchasePriceCents: products.purchasePriceCents,
          taxRateBps: products.taxRateBps,
        })
        .from(products)
        .where(
          and(eq(products.tenantId, tId), eq(products.itemType, "product")),
        ),
    ]);

    const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]));

    const enrichedVendors = vendorRows.map((v) => {
      const vPos = poRows.filter((po) => po.vendorId === v.id);
      return {
        ...v,
        poCount: vPos.length,
        totalPurchasedCents: vPos.reduce((s, p) => s + p.totalCents, 0),
        openPayableCents: vPos.reduce((s, p) => s + p.balanceCents, 0),
      };
    });

    const enrichedPos = poRows.map((po) => ({
      ...po,
      vendorName: vendorMap.get(po.vendorId) || "Vendor",
      items: poItemRows.filter((i) => i.purchaseOrderId === po.id),
    }));

    return NextResponse.json({
      currency: ctx.tenant.currency,
      canApprove: ctx.permissions.has("procurement:approve"),
      vendors: enrichedVendors,
      purchaseOrders: enrichedPos,
      products: productRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const postProcurementSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_vendor"),
    name: z.string().min(2).max(140),
    contactName: z.string().min(2).max(120),
    email: z.string().email().max(150),
    phone: z.string().max(40).optional(),
    address: z.string().max(300).optional(),
    category: z.string().max(80).default("General Supplier"),
    taxId: z.string().max(50).optional(),
    paymentTerms: z.string().max(40).default("Net 30"),
    notes: z.string().max(600).optional(),
  }),
  z.object({
    action: z.literal("create_po"),
    vendorId: z.number().int().positive(),
    expectedDate: z.string().optional(),
    notes: z.string().max(600).optional(),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive().nullable().optional(),
          description: z.string().min(1).max(200),
          quantity: z.number().int().positive(),
          unitCost: z.number().min(0),
          taxRateBps: z.number().int().min(0).max(5000).optional(),
        }),
      )
      .min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "procurement:write");
    const body = postProcurementSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      if (body.action === "create_vendor") {
        const [vendor] = await tx
          .insert(vendors)
          .values({
            tenantId: tId,
            name: sanitizeText(body.name),
            contactName: sanitizeText(body.contactName),
            email: body.email.trim().toLowerCase(),
            phone: body.phone ? sanitizeText(body.phone) : null,
            address: body.address ? sanitizeText(body.address) : null,
            category: sanitizeText(body.category),
            taxId: body.taxId ? sanitizeText(body.taxId) : null,
            paymentTerms: sanitizeText(body.paymentTerms),
            notes: body.notes ? sanitizeText(body.notes) : null,
          })
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "vendor.created",
            module: "procurement",
            entityType: "vendor",
            entityId: vendor.id,
            summary: `Registered vendor ${vendor.name}`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ vendor }, { status: 201 });
      }

      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, body.vendorId), eq(vendors.tenantId, tId)))
        .limit(1);
      if (!vendor) throw new ApiError(404, "Vendor not found in workspace.");

      const calc = calculateInvoiceTotals(
        body.items.map((it) => ({
          productId: it.productId ?? null,
          description: sanitizeText(it.description),
          quantity: it.quantity,
          unitPriceCents: toCents(it.unitCost),
          taxRateBps: it.taxRateBps ?? ctx.tenant.defaultTaxBps,
        })),
      );

      const poNumber = `PO-${new Date().getFullYear()}-${generateSecureToken(
        3,
      ).toUpperCase()}`;

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: tId,
          vendorId: vendor.id,
          poNumber,
          status: "pending_approval",
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDate: body.expectedDate || null,
          subtotalCents: calc.subtotalCents,
          taxCents: calc.taxCents,
          totalCents: calc.totalCents,
          paidCents: 0,
          balanceCents: calc.totalCents,
          notes: body.notes ? sanitizeText(body.notes) : null,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await tx.insert(purchaseOrderItems).values(
        calc.items.map((it) => ({
          tenantId: tId,
          purchaseOrderId: po.id,
          productId: it.productId,
          description: it.description,
          quantity: it.quantity,
          receivedQuantity: 0,
          unitCostCents: it.unitPriceCents,
          taxRateBps: it.taxRateBps ?? ctx.tenant.defaultTaxBps,
          lineTotalCents: it.lineTotalCents,
        })),
      );

      await dispatchWorkflowEvent(
        {
          tenantId: tId,
          triggerEvent: "po.pending_approval",
          payload: {
            poId: po.id,
            poNumber,
            vendorName: vendor.name,
            totalCents: po.totalCents,
            link: "/app/procurement",
          },
          userId: ctx.user.id,
        },
        tx,
      );

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "po.created",
          module: "procurement",
          entityType: "purchase_order",
          entityId: po.id,
          summary: `Created ${poNumber} for ${vendor.name} (${formatMoney(
            po.totalCents,
            ctx.tenant.currency,
          )})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ purchaseOrder: po }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchPoSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["approve", "receive_goods", "pay_vendor"]),
  vendorInvoiceNumber: z.string().max(80).optional(),
  amount: z.number().positive().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "procurement:write");
    const body = patchPoSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(eq(purchaseOrders.id, body.id), eq(purchaseOrders.tenantId, tId)),
        )
        .limit(1)
        .for("update");
      if (!po)
        throw new ApiError(404, "Purchase order not found in workspace.");

      if (body.action === "approve") {
        if (po.status !== "pending_approval")
          throw new ApiError(409, "Order is not awaiting approval.");
        if (!ctx.permissions.has("procurement:approve")) {
          throw new ApiError(403, "Missing procurement:approve permission.");
        }
        const [updated] = await tx
          .update(purchaseOrders)
          .set({
            status: "approved",
            approvedByName: ctx.user.fullName,
            updatedAt: new Date(),
          })
          .where(
            and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.tenantId, tId)),
          )
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "po.approved",
            module: "procurement",
            entityType: "purchase_order",
            entityId: po.id,
            summary: `Approved purchase order ${po.poNumber}`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ purchaseOrder: updated });
      }

      if (body.action === "receive_goods") {
        if (po.status !== "approved") {
          throw new ApiError(
            400,
            "Approve the purchase order before receiving goods; already received orders cannot be received twice.",
          );
        }
        const items = await tx
          .select()
          .from(purchaseOrderItems)
          .where(
            and(
              eq(purchaseOrderItems.purchaseOrderId, po.id),
              eq(purchaseOrderItems.tenantId, tId),
            ),
          );

        // Increment inventory stock & write traceable stock movements
        for (const item of items) {
          await tx
            .update(purchaseOrderItems)
            .set({ receivedQuantity: item.quantity })
            .where(
              and(
                eq(purchaseOrderItems.id, item.id),
                eq(purchaseOrderItems.tenantId, tId),
              ),
            );

          if (item.productId) {
            const [prod] = await tx
              .select()
              .from(products)
              .where(
                and(
                  eq(products.id, item.productId),
                  eq(products.tenantId, tId),
                ),
              )
              .limit(1)
              .for("update");
            if (prod) {
              const newStock = prod.stockQuantity + item.quantity;
              await tx
                .update(products)
                .set({ stockQuantity: newStock, updatedAt: new Date() })
                .where(
                  and(eq(products.id, prod.id), eq(products.tenantId, tId)),
                );

              await tx.insert(stockMovements).values({
                tenantId: tId,
                productId: prod.id,
                movementType: "purchase_receipt",
                quantityDelta: item.quantity,
                previousStock: prod.stockQuantity,
                newStock,
                referenceType: "PO",
                referenceId: po.poNumber,
                reason: `Goods received on ${po.poNumber}`,
                actorName: ctx.user.fullName,
                createdByUserId: ctx.user.id,
              });
            }
          }
        }

        const [updated] = await tx
          .update(purchaseOrders)
          .set({
            status: "received",
            receivedDate: new Date().toISOString().slice(0, 10),
            vendorInvoiceNumber: body.vendorInvoiceNumber
              ? sanitizeText(body.vendorInvoiceNumber)
              : po.vendorInvoiceNumber,
            updatedAt: new Date(),
          })
          .where(
            and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.tenantId, tId)),
          )
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "po.goods_received",
            module: "procurement",
            entityType: "purchase_order",
            entityId: po.id,
            summary: `Received goods into inventory for ${po.poNumber}`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ purchaseOrder: updated });
      }

      // pay_vendor -> connects Procurement to Finance immutable ledger
      if (!ctx.permissions.has("finance:write"))
        throw new ApiError(403, "Finance permission required to post payout.");
      if (po.status !== "received")
        throw new ApiError(409, "Receive the order before posting payment.");
      if (po.balanceCents <= 0) {
        throw new ApiError(400, "Purchase order is already settled in full.");
      }
      const payCents = body.amount
        ? Math.min(po.balanceCents, toCents(body.amount))
        : po.balanceCents;

      const newPaid = po.paidCents + payCents;
      const newBalance = Math.max(0, po.totalCents - newPaid);

      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          paidCents: newPaid,
          balanceCents: newBalance,
          vendorInvoiceNumber: body.vendorInvoiceNumber
            ? sanitizeText(body.vendorInvoiceNumber)
            : po.vendorInvoiceNumber,
          status: newBalance === 0 ? "paid" : po.status,
          updatedAt: new Date(),
        })
        .where(
          and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.tenantId, tId)),
        )
        .returning();

      await tx.insert(transactions).values({
        tenantId: tId,
        entryNumber: `VND-${generateSecureToken(4).toUpperCase()}`,
        type: "vendor_payment",
        direction: "debit",
        category: "Inventory Procurement",
        amountCents: payCents,
        paymentMethod: "NEFT / Bank Transfer",
        transactionDate: new Date().toISOString().slice(0, 10),
        description: `Vendor settlement for ${po.poNumber}${
          updated.vendorInvoiceNumber
            ? ` (Inv ${updated.vendorInvoiceNumber})`
            : ""
        }`,
        vendorId: po.vendorId,
        purchaseOrderId: po.id,
        status: "posted",
        actorName: ctx.user.fullName,
        createdByUserId: ctx.user.id,
      });

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "po.paid",
          module: "procurement",
          entityType: "purchase_order",
          entityId: po.id,
          summary: `Paid ${formatMoney(payCents, ctx.tenant.currency)} to vendor for ${
            po.poNumber
          }`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ purchaseOrder: updated });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
