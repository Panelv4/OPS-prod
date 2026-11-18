"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, ArrowUpDown, Package } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatCard,
  StatusPill,
} from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";

interface InventoryPayload {
  currency: string;
  report: {
    totalItems: number;
    physicalSkuCount: number;
    lowStockCount: number;
    stockValuationCostCents: number;
    stockValuationRetailCents: number;
  };
  products: Array<{
    id: number;
    sku: string;
    name: string;
    category: string;
    itemType: string;
    imageUrl: string | null;
    vendorName: string | null;
    purchasePriceCents: number;
    sellingPriceCents: number;
    stockQuantity: number;
    reorderLevel: number;
    isLowStock: boolean;
  }>;
  movements: Array<{
    id: number;
    productName: string;
    sku: string;
    movementType: string;
    quantityDelta: number;
    previousStock: number;
    newStock: number;
    referenceType: string | null;
    referenceId: string | null;
    reason: string;
    actorName: string;
    createdAt: string;
  }>;
  vendors: Array<{ id: number; name: string }>;
}

export default function InventoryPage() {
  const searchParams = useSearchParams();
  const { apiFetch, can, toast, refreshSession } = useWorkspace();
  const [data, setData] = useState<InventoryPayload | null>(null);
  const [tab, setTab] = useState("catalog");
  const [filter, setFilter] = useState("all");

  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "product");
  const [adjustItem, setAdjustItem] = useState<{
    id: number;
    name: string;
    stockQuantity: number;
  } | null>(null);

  const [prodForm, setProdForm] = useState({
    sku: "",
    name: "",
    category: "Hardware",
    itemType: "product",
    vendorId: "",
    purchasePrice: "10000",
    sellingPrice: "16000",
    stockQuantity: "15",
    reorderLevel: "5",
  });

  const [adjForm, setAdjForm] = useState({
    movementType: "in",
    quantity: "10",
    reason: "Warehouse replenishment count",
  });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<InventoryPayload>(
        `/api/inventory?filter=${filter}`,
      );
      setData(res);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load inventory",
        "error",
      );
    }
  }, [apiFetch, filter, toast]);

  useLoadEffect(load);

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/inventory", {
        method: "POST",
        body: JSON.stringify({
          ...prodForm,
          vendorId: prodForm.vendorId ? Number(prodForm.vendorId) : null,
          purchasePrice: Number(prodForm.purchasePrice) || 0,
          sellingPrice: Number(prodForm.sellingPrice) || 0,
          stockQuantity: Number(prodForm.stockQuantity) || 0,
          reorderLevel: Number(prodForm.reorderLevel) || 0,
        }),
      });
      setNewOpen(false);
      setProdForm((p) => ({ ...p, sku: "", name: "" }));
      toast("Catalog item added with traceable stock record");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const submitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    try {
      await apiFetch("/api/inventory", {
        method: "PATCH",
        body: JSON.stringify({
          productId: adjustItem.id,
          movementType: adjForm.movementType,
          quantity: Number(adjForm.quantity),
          reason: adjForm.reason,
        }),
      });
      setAdjustItem(null);
      toast("Stock movement logged");
      await load();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Adjustment error", "error");
    }
  };

  if (!data) {
    return <div className="text-xs text-slate-500">Loading inventory…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Inventory & Stock Ledger"
        description="Product catalog, SKUs, stock valuation reports, low-stock alerts & traceable adjustments"
        actions={
          can("inventory:write") && (
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="op-btn-primary text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Product / Service
            </button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Catalog Items"
          value={data.report.totalItems}
          subtext={`${data.report.physicalSkuCount} physical SKU(s)`}
        />
        <StatCard
          label="Low-Stock Alerts"
          value={data.report.lowStockCount}
          subtext="At or below reorder threshold"
          tone={data.report.lowStockCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Stock Value (Cost)"
          value={formatMoney(
            data.report.stockValuationCostCents,
            data.currency,
          )}
          subtext="At vendor purchase price"
        />
        <StatCard
          label="Stock Value (Retail)"
          value={formatMoney(
            data.report.stockValuationRetailCents,
            data.currency,
          )}
          subtext="Projected gross catalog value"
          tone="positive"
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: "catalog",
            label: "Product Catalog",
            count: data.products.length,
          },
          {
            id: "movements",
            label: "Stock Movement Log",
            count: data.movements.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "catalog" ? (
        <>
          <div className="mb-3 flex gap-2">
            {[
              { id: "all", label: "All" },
              { id: "low_stock", label: "Low Stock" },
              { id: "product", label: "Physical SKUs" },
              { id: "service", label: "Services" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  filter === f.id
                    ? "bg-slate-900 text-white dark:bg-indigo-600"
                    : "border border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="op-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Item & SKU</th>
                  <th className="px-4 py-3">Category / Vendor</th>
                  <th className="px-4 py-3 text-right">Cost Price</th>
                  <th className="px-4 py-3 text-right">Selling Price</th>
                  <th className="px-4 py-3 text-right">On Hand</th>
                  <th className="px-4 py-3 text-right">Stock Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {data.products.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="h-10 w-10 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                            <Package className="h-4 w-4" />
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {p.name}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {p.sku} · {p.itemType}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{p.category}</div>
                      <div className="text-[11px] text-slate-400">
                        {p.vendorName || "In-house"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatMoney(p.purchasePriceCents, data.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular">
                      {formatMoney(p.sellingPriceCents, data.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {p.itemType === "service" ? (
                        <span className="text-slate-400">Service</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            p.isLowStock
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {p.stockQuantity} (min {p.reorderLevel})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {can("inventory:adjust") && p.itemType === "product" && (
                        <button
                          type="button"
                          onClick={() =>
                            setAdjustItem({
                              id: p.id,
                              name: p.name,
                              stockQuantity: p.stockQuantity,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          <ArrowUpDown className="h-3 w-3" /> Adjust
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Movement</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Reason & Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {data.movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium">
                    {m.productName}{" "}
                    <span className="font-mono text-slate-400">({m.sku})</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={m.movementType} />
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold tabular ${
                      m.quantityDelta >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {m.quantityDelta >= 0
                      ? `+${m.quantityDelta}`
                      : m.quantityDelta}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {m.previousStock} → <strong>{m.newStock}</strong>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {m.reason} ·{" "}
                    <span className="text-slate-400">{m.actorName}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Product Modal */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Add Catalog Product or Service"
      >
        <form onSubmit={createProduct} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="inventory-field-1" className="op-label">
                SKU Code
              </label>
              <input
                id="inventory-field-1"
                required
                value={prodForm.sku}
                onChange={(e) =>
                  setProdForm({ ...prodForm, sku: e.target.value })
                }
                placeholder="HW-KEY-01"
                className="op-input font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="inventory-field-2" className="op-label">
                Name
              </label>
              <input
                id="inventory-field-2"
                required
                value={prodForm.name}
                onChange={(e) =>
                  setProdForm({ ...prodForm, name: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="inventory-field-3" className="op-label">
                Type
              </label>
              <select
                id="inventory-field-3"
                value={prodForm.itemType}
                onChange={(e) =>
                  setProdForm({ ...prodForm, itemType: e.target.value })
                }
                className="op-input"
              >
                <option value="product">Physical Product</option>
                <option value="service">Service</option>
              </select>
            </div>
            <div>
              <label htmlFor="inventory-field-4" className="op-label">
                Category
              </label>
              <input
                id="inventory-field-4"
                required
                value={prodForm.category}
                onChange={(e) =>
                  setProdForm({ ...prodForm, category: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="inventory-field-5" className="op-label">
                Preferred Vendor
              </label>
              <select
                id="inventory-field-5"
                value={prodForm.vendorId}
                onChange={(e) =>
                  setProdForm({ ...prodForm, vendorId: e.target.value })
                }
                className="op-input"
              >
                <option value="">None</option>
                {data.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="op-label">
                Purchase Price ({data.currency})
              </label>
              <input
                type="number"
                min="0"
                value={prodForm.purchasePrice}
                onChange={(e) =>
                  setProdForm({ ...prodForm, purchasePrice: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label className="op-label">
                Selling Price ({data.currency})
              </label>
              <input
                type="number"
                required
                min="0"
                value={prodForm.sellingPrice}
                onChange={(e) =>
                  setProdForm({ ...prodForm, sellingPrice: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
          </div>
          {prodForm.itemType === "product" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="inventory-field-6" className="op-label">
                  Opening Stock
                </label>
                <input
                  id="inventory-field-6"
                  type="number"
                  min="0"
                  value={prodForm.stockQuantity}
                  onChange={(e) =>
                    setProdForm({ ...prodForm, stockQuantity: e.target.value })
                  }
                  className="op-input tabular"
                />
              </div>
              <div>
                <label htmlFor="inventory-field-7" className="op-label">
                  Low-Stock Reorder Level
                </label>
                <input
                  id="inventory-field-7"
                  type="number"
                  min="0"
                  value={prodForm.reorderLevel}
                  onChange={(e) =>
                    setProdForm({ ...prodForm, reorderLevel: e.target.value })
                  }
                  className="op-input tabular"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Save Item
            </button>
          </div>
        </form>
      </Modal>

      {/* Traceable Stock Adjustment Modal */}
      <Modal
        open={Boolean(adjustItem)}
        onClose={() => setAdjustItem(null)}
        title={`Stock Adjustment — ${adjustItem?.name || ""}`}
        subtitle={`Current on-hand stock: ${adjustItem?.stockQuantity ?? 0} units`}
      >
        <form onSubmit={submitAdjustment} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inventory-field-8" className="op-label">
                Movement Type
              </label>
              <select
                id="inventory-field-8"
                value={adjForm.movementType}
                onChange={(e) =>
                  setAdjForm({ ...adjForm, movementType: e.target.value })
                }
                className="op-input"
              >
                <option value="in">Stock In (+ Add)</option>
                <option value="out">Stock Out (- Deduct)</option>
                <option value="return">Customer Return (+ Add)</option>
                <option value="adjustment">Cycle Count (Set Exact)</option>
              </select>
            </div>
            <div>
              <label htmlFor="inventory-field-9" className="op-label">
                Quantity
              </label>
              <input
                id="inventory-field-9"
                type="number"
                min="1"
                required
                value={adjForm.quantity}
                onChange={(e) =>
                  setAdjForm({ ...adjForm, quantity: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
          </div>
          <div>
            <label htmlFor="inventory-field-10" className="op-label">
              Audit Reason
            </label>
            <input
              id="inventory-field-10"
              required
              value={adjForm.reason}
              onChange={(e) =>
                setAdjForm({ ...adjForm, reason: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAdjustItem(null)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Record Movement
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
