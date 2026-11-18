"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, Check, PackageCheck, CreditCard } from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  Modal,
  PageHeader,
  SectionTabs,
  StatusPill,
} from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";

interface ProcurementPayload {
  currency: string;
  canApprove: boolean;
  vendors: Array<{
    id: number;
    name: string;
    contactName: string;
    email: string;
    phone: string | null;
    category: string;
    paymentTerms: string;
    taxId: string | null;
    poCount: number;
    totalPurchasedCents: number;
    openPayableCents: number;
  }>;
  purchaseOrders: Array<{
    id: number;
    poNumber: string;
    vendorName: string;
    status: string;
    orderDate: string;
    expectedDate: string | null;
    vendorInvoiceNumber: string | null;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
    approvedByName: string | null;
    items: Array<{ id: number; description: string; quantity: number }>;
  }>;
  products: Array<{
    id: number;
    sku: string;
    name: string;
    purchasePriceCents: number;
  }>;
}

export default function ProcurementPage() {
  const { apiFetch, can, toast, session } = useWorkspace();
  const [data, setData] = useState<ProcurementPayload | null>(null);
  const [tab, setTab] = useState("pos");

  const [vendorModal, setVendorModal] = useState(false);
  const [poModal, setPoModal] = useState(false);

  const [vForm, setVForm] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    category: "Hardware Supplier",
    paymentTerms: "Net 30",
    taxId: "",
  });

  const [poForm, setPoForm] = useState(() => ({
    vendorId: "",
    productId: "",
    description: "",
    quantity: "10",
    unitCost: "14500",
    expectedDate: new Date(Date.now() + 10 * 86400000)
      .toISOString()
      .slice(0, 10),
  }));

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ProcurementPayload>("/api/procurement");
      setData(res);
      if (!poForm.vendorId && res.vendors[0]) {
        setPoForm((p) => ({ ...p, vendorId: String(res.vendors[0].id) }));
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load procurement",
        "error",
      );
    }
  }, [apiFetch, poForm.vendorId, toast]);

  useLoadEffect(load);

  const createVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/procurement", {
        method: "POST",
        body: JSON.stringify({ action: "create_vendor", ...vForm }),
      });
      setVendorModal(false);
      setVForm({
        name: "",
        contactName: "",
        email: "",
        phone: "",
        category: "Hardware Supplier",
        paymentTerms: "Net 30",
        taxId: "",
      });
      toast("Vendor registered");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const createPo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/procurement", {
        method: "POST",
        body: JSON.stringify({
          action: "create_po",
          vendorId: Number(poForm.vendorId),
          expectedDate: poForm.expectedDate,
          items: [
            {
              productId: poForm.productId ? Number(poForm.productId) : null,
              description: poForm.description,
              quantity: Number(poForm.quantity),
              unitCost: Number(poForm.unitCost),
              taxRateBps: session?.tenant.defaultTaxBps ?? 0,
            },
          ],
        }),
      });
      setPoModal(false);
      toast("Purchase order submitted for approval");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const poAction = async (
    id: number,
    action: "approve" | "receive_goods" | "pay_vendor",
    okMsg: string,
  ) => {
    try {
      await apiFetch("/api/procurement", {
        method: "PATCH",
        body: JSON.stringify({ id, action }),
      });
      toast(okMsg);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  if (!data) {
    return <div className="text-xs text-slate-500">Loading procurement…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Procurement & Vendor Management"
        description="Supplier directory, PO approval workflows, goods-received inventory sync & vendor payouts"
        actions={
          can("procurement:write") && (
            <>
              <button
                type="button"
                onClick={() => setVendorModal(true)}
                className="op-btn-secondary text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add Vendor
              </button>
              <button
                type="button"
                onClick={() => setPoModal(true)}
                className="op-btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Create Purchase Order
              </button>
            </>
          )
        }
      />

      <SectionTabs
        tabs={[
          {
            id: "pos",
            label: "Purchase Orders",
            count: data.purchaseOrders.length,
          },
          { id: "vendors", label: "Vendors", count: data.vendors.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pos" ? (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">PO #</th>
                <th className="px-4 py-3">Vendor & Items</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Workflow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {data.purchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {po.poNumber}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {po.orderDate}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{po.vendorName}</div>
                    <div className="text-[11px] text-slate-500">
                      {po.items
                        .map((i) => `${i.quantity}× ${i.description}`)
                        .join(", ")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={po.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular">
                    {formatMoney(po.totalCents, data.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular">
                    {formatMoney(po.balanceCents, data.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {data.canApprove && po.status === "pending_approval" && (
                        <button
                          type="button"
                          onClick={() =>
                            poAction(
                              po.id,
                              "approve",
                              `Approved ${po.poNumber}`,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white"
                        >
                          <Check className="h-3 w-3" /> Approve
                        </button>
                      )}
                      {can("procurement:write") && po.status === "approved" && (
                        <button
                          type="button"
                          onClick={() =>
                            poAction(
                              po.id,
                              "receive_goods",
                              "Goods received — Inventory stock updated!",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white"
                        >
                          <PackageCheck className="h-3 w-3" /> Receive Goods
                        </button>
                      )}
                      {can("procurement:write") &&
                        (po.status === "received" ||
                          po.status === "approved") &&
                        po.balanceCents > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              poAction(
                                po.id,
                                "pay_vendor",
                                "Vendor settled — Posted to Finance ledger!",
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-slate-700"
                          >
                            <CreditCard className="h-3 w-3" /> Pay Vendor
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.vendors.map((v) => (
            <div key={v.id} className="op-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {v.name}
                  </h3>
                  <p className="text-xs text-slate-500">{v.category}</p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {v.paymentTerms}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                <div>
                  {v.contactName} · {v.email}
                </div>
                {v.taxId && (
                  <div className="font-mono text-[11px]">Tax ID: {v.taxId}</div>
                )}
              </div>
              <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-xs tabular dark:border-slate-800">
                <span>
                  Total POs ({v.poCount}):{" "}
                  <strong>
                    {formatMoney(v.totalPurchasedCents, data.currency, true)}
                  </strong>
                </span>
                <span className="text-amber-600 dark:text-amber-400">
                  Due: {formatMoney(v.openPayableCents, data.currency, true)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Vendor Modal */}
      <Modal
        open={vendorModal}
        onClose={() => setVendorModal(false)}
        title="Add Vendor Profile"
      >
        <form onSubmit={createVendor} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="procurement-field-1" className="op-label">
                Vendor Company
              </label>
              <input
                id="procurement-field-1"
                required
                value={vForm.name}
                onChange={(e) => setVForm({ ...vForm, name: e.target.value })}
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="procurement-field-2" className="op-label">
                Primary Contact
              </label>
              <input
                id="procurement-field-2"
                required
                value={vForm.contactName}
                onChange={(e) =>
                  setVForm({ ...vForm, contactName: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="procurement-field-3" className="op-label">
                Email
              </label>
              <input
                id="procurement-field-3"
                type="email"
                required
                value={vForm.email}
                onChange={(e) => setVForm({ ...vForm, email: e.target.value })}
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="procurement-field-4" className="op-label">
                Payment Terms
              </label>
              <input
                id="procurement-field-4"
                value={vForm.paymentTerms}
                onChange={(e) =>
                  setVForm({ ...vForm, paymentTerms: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="procurement-field-5" className="op-label">
                Category
              </label>
              <input
                id="procurement-field-5"
                value={vForm.category}
                onChange={(e) =>
                  setVForm({ ...vForm, category: e.target.value })
                }
                className="op-input"
              />
            </div>
            <div>
              <label htmlFor="procurement-field-6" className="op-label">
                GSTIN / Tax ID
              </label>
              <input
                id="procurement-field-6"
                value={vForm.taxId}
                onChange={(e) => setVForm({ ...vForm, taxId: e.target.value })}
                className="op-input font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setVendorModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Save Vendor
            </button>
          </div>
        </form>
      </Modal>

      {/* Create PO Modal */}
      <Modal
        open={poModal}
        onClose={() => setPoModal(false)}
        title="Create Purchase Order"
        subtitle="Connects directly to Inventory on receipt and Finance on payment"
      >
        <form onSubmit={createPo} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="procurement-field-7" className="op-label">
                Vendor
              </label>
              <select
                id="procurement-field-7"
                required
                value={poForm.vendorId}
                onChange={(e) =>
                  setPoForm({ ...poForm, vendorId: e.target.value })
                }
                className="op-input"
              >
                {data.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="procurement-field-8" className="op-label">
                Link Inventory SKU (Auto-Restock)
              </label>
              <select
                id="procurement-field-8"
                value={poForm.productId}
                onChange={(e) => {
                  const p = data.products.find(
                    (x) => String(x.id) === e.target.value,
                  );
                  setPoForm({
                    ...poForm,
                    productId: e.target.value,
                    description: p ? p.name : poForm.description,
                    unitCost: p
                      ? String(p.purchasePriceCents / 100)
                      : poForm.unitCost,
                  });
                }}
                className="op-input"
              >
                <option value="">Non-inventory order</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="procurement-field-9" className="op-label">
              Item Description
            </label>
            <input
              id="procurement-field-9"
              required
              value={poForm.description}
              onChange={(e) =>
                setPoForm({ ...poForm, description: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="procurement-field-10" className="op-label">
                Quantity
              </label>
              <input
                id="procurement-field-10"
                type="number"
                min="1"
                required
                value={poForm.quantity}
                onChange={(e) =>
                  setPoForm({ ...poForm, quantity: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label className="op-label">Unit Cost ({data.currency})</label>
              <input
                type="number"
                min="0"
                required
                value={poForm.unitCost}
                onChange={(e) =>
                  setPoForm({ ...poForm, unitCost: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label htmlFor="procurement-field-11" className="op-label">
                Expected Delivery
              </label>
              <input
                id="procurement-field-11"
                type="date"
                value={poForm.expectedDate}
                onChange={(e) =>
                  setPoForm({ ...poForm, expectedDate: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPoModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Submit PO
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
