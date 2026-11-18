"use client";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Modal } from "@/components/ui/primitives";
export function CustomerImport({
  onComplete,
}: {
  onComplete: () => Promise<void>;
}) {
  const { apiFetch, toast } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{
    add: number;
    skipped: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const result = await apiFetch<{ add: number; skipped: number }>(
        "/api/crm/customers/import",
        { method: "POST", body: JSON.stringify({ csv, confirm: !!preview }) },
      );
      if (preview) {
        toast(
          `Imported ${result.add} customers; skipped ${result.skipped} duplicates.`,
        );
        setOpen(false);
        setCsv("");
        setPreview(null);
        await onComplete();
      } else setPreview(result);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="op-btn-secondary" onClick={() => setOpen(true)}>
        Import CSV
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Import customers"
        subtitle="Paste up to 200 rows. Existing email addresses are skipped, never overwritten."
      >
        <label className="op-label" htmlFor="customer-csv">
          CSV · name,company,email
        </label>
        <textarea
          id="customer-csv"
          className="op-input min-h-32"
          value={csv}
          maxLength={64000}
          placeholder={
            "name,company,email\nAlex,Cedar Studio,alex@example.test"
          }
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
        />
        {preview && (
          <p role="status">
            {preview.add} to add · {preview.skipped} duplicates
          </p>
        )}
        <button
          disabled={!csv || busy}
          className="op-btn-primary mt-3"
          onClick={submit}
        >
          {preview ? "Confirm import" : "Preview import"}
        </button>
      </Modal>
    </>
  );
}
