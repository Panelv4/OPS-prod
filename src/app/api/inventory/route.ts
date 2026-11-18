import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, stockMovements, vendors } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { toCents } from "@/lib/finance";
import { sanitizeText } from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";
import { dispatchWorkflowEvent } from "@/lib/automation";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "inventory:view");
    const tId = ctx.tenantId;
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const filter = url.searchParams.get("filter") || "all";

    const [prodRows, moveRows, vendorRows] = await Promise.all([
      db
        .select()
        .from(products)
        .where(and(eq(products.tenantId, tId), eq(products.status, "active")))
        .orderBy(desc(products.createdAt)),
      db
        .select({
          id: stockMovements.id,
          productId: stockMovements.productId,
          productName: products.name,
          sku: products.sku,
          movementType: stockMovements.movementType,
          quantityDelta: stockMovements.quantityDelta,
          previousStock: stockMovements.previousStock,
          newStock: stockMovements.newStock,
          referenceType: stockMovements.referenceType,
          referenceId: stockMovements.referenceId,
          reason: stockMovements.reason,
          actorName: stockMovements.actorName,
          createdAt: stockMovements.createdAt,
        })
        .from(stockMovements)
        .innerJoin(products, eq(stockMovements.productId, products.id))
        .where(eq(stockMovements.tenantId, tId))
        .orderBy(desc(stockMovements.createdAt))
        .limit(60),
      db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        .where(eq(vendors.tenantId, tId)),
    ]);

    const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]));
    const physicalProducts = prodRows.filter((p) => p.itemType === "product");
    const stockValuationCostCents = physicalProducts.reduce(
      (s, p) => s + p.stockQuantity * p.purchasePriceCents,
      0,
    );
    const stockValuationRetailCents = physicalProducts.reduce(
      (s, p) => s + p.stockQuantity * p.sellingPriceCents,
      0,
    );
    const lowStockCount = physicalProducts.filter(
      (p) => p.stockQuantity <= p.reorderLevel,
    ).length;

    let filtered = prodRows.map((p) => ({
      ...p,
      vendorName: p.vendorId ? vendorMap.get(p.vendorId) || null : null,
      isLowStock: p.itemType === "product" && p.stockQuantity <= p.reorderLevel,
    }));

    if (filter === "low_stock") filtered = filtered.filter((p) => p.isLowStock);
    if (filter === "product")
      filtered = filtered.filter((p) => p.itemType === "product");
    if (filter === "service")
      filtered = filtered.filter((p) => p.itemType === "service");

    if (search) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.sku.toLowerCase().includes(search) ||
          p.category.toLowerCase().includes(search),
      );
    }

    return NextResponse.json({
      currency: ctx.tenant.currency,
      report: {
        totalItems: prodRows.length,
        physicalSkuCount: physicalProducts.length,
        lowStockCount,
        stockValuationCostCents,
        stockValuationRetailCents,
      },
      products: filtered,
      movements: moveRows,
      vendors: vendorRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createProductSchema = z.object({
  sku: z.string().min(2).max(50),
  name: z.string().min(2).max(160),
  category: z.string().min(2).max(80).default("General"),
  itemType: z.enum(["product", "service"]).default("product"),
  description: z.string().max(600).optional(),
  imageUrl: z.string().max(300).optional(),
  unit: z.string().max(30).default("unit"),
  vendorId: z.number().int().positive().nullable().optional(),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  stockQuantity: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).default(10),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "inventory:write");
    const body = createProductSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          tenantId: tId,
          vendorId: body.vendorId ?? null,
          sku: sanitizeText(body.sku).toUpperCase(),
          name: sanitizeText(body.name),
          category: sanitizeText(body.category),
          itemType: body.itemType,
          description: body.description ? sanitizeText(body.description) : null,
          imageUrl: body.imageUrl ? sanitizeText(body.imageUrl) : null,
          unit: sanitizeText(body.unit),
          purchasePriceCents: toCents(body.purchasePrice),
          sellingPriceCents: toCents(body.sellingPrice),
          taxRateBps: body.taxRateBps ?? ctx.tenant.defaultTaxBps,
          stockQuantity: body.itemType === "service" ? 999 : body.stockQuantity,
          reorderLevel: body.itemType === "service" ? 0 : body.reorderLevel,
        })
        .returning();

      if (body.itemType === "product" && body.stockQuantity > 0) {
        await tx.insert(stockMovements).values({
          tenantId: tId,
          productId: created.id,
          movementType: "in",
          quantityDelta: body.stockQuantity,
          previousStock: 0,
          newStock: body.stockQuantity,
          referenceType: "OPENING",
          reason: "Opening stock registration",
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        });
      }

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "product.created",
          module: "inventory",
          entityType: "product",
          entityId: created.id,
          summary: `Added catalog item ${created.name} (${created.sku})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      if (
        created.itemType === "product" &&
        created.stockQuantity <= created.reorderLevel
      ) {
        await dispatchWorkflowEvent(
          {
            tenantId: tId,
            triggerEvent: "stock.low",
            payload: {
              productId: created.id,
              name: created.name,
              sku: created.sku,
              stockQuantity: created.stockQuantity,
              reorderLevel: created.reorderLevel,
              link: "/app/inventory",
            },
            userId: ctx.user.id,
          },
          tx,
        );
      }

      return NextResponse.json({ product: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const adjustStockSchema = z.object({
  productId: z.number().int().positive(),
  movementType: z.enum(["in", "out", "adjustment", "return"]),
  quantity: z.number().int().positive(),
  reason: z.string().min(2).max(240),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request, "inventory:adjust");
    const body = adjustStockSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      const [prod] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, body.productId), eq(products.tenantId, tId)))
        .limit(1)
        .for("update");
      if (!prod) {
        throw new ApiError(404, "Product not found in this workspace.");
      }

      let delta = body.quantity;
      if (body.movementType === "out") {
        if (body.quantity > prod.stockQuantity) {
          throw new ApiError(
            400,
            `Cannot deduct ${body.quantity} units — only ${prod.stockQuantity} in stock.`,
          );
        }
        delta = -body.quantity;
      } else if (body.movementType === "adjustment") {
        // Direct count adjustment sets stock to `quantity`
        delta = body.quantity - prod.stockQuantity;
      }

      const newStock = prod.stockQuantity + delta;

      const [updated] = await tx
        .update(products)
        .set({ stockQuantity: newStock, updatedAt: new Date() })
        .where(and(eq(products.id, prod.id), eq(products.tenantId, tId)))
        .returning();

      const [movement] = await tx
        .insert(stockMovements)
        .values({
          tenantId: tId,
          productId: prod.id,
          movementType: body.movementType,
          quantityDelta: delta,
          previousStock: prod.stockQuantity,
          newStock,
          referenceType: "MANUAL",
          reason: sanitizeText(body.reason),
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        })
        .returning();

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "stock.adjusted",
          module: "inventory",
          entityType: "product",
          entityId: prod.id,
          summary: `Stock ${body.movementType} on ${prod.sku}: ${prod.stockQuantity} → ${newStock} (${sanitizeText(
            body.reason,
          )})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      if (prod.itemType === "product" && newStock <= prod.reorderLevel) {
        await dispatchWorkflowEvent(
          {
            tenantId: tId,
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

      return NextResponse.json({ product: updated, movement });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
