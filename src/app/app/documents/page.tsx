"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import {
  Upload,
  Download,
  Eye,
  Shield,
  Clock,
  Search,
  History,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  formatBytes,
  Modal,
  PageHeader,
  StatusPill,
} from "@/components/ui/primitives";

interface DocRow {
  id: number;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  visibility: string;
  currentVersion: number;
  textPreview: string | null;
  expiresAt: string | null;
  expiringSoon: boolean;
  uploaderName: string;
  updatedAt: string;
}

interface DocDetail {
  document: DocRow & { contentBase64: string | null };
  versions: Array<{
    id: number;
    versionNumber: number;
    fileName: string;
    sizeBytes: number;
    changeNote: string;
    uploaderName: string;
    createdAt: string;
  }>;
}

export default function DocumentsPage() {
  const { apiFetch, can, toast } = useWorkspace();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [expiringCount, setExpiringCount] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [versionNote, setVersionNote] = useState("");

  const [form, setForm] = useState({
    title: "",
    fileName: "",
    mimeType: "text/plain",
    contentBase64: "",
    inlineText: "",
    category: "contract",
    visibility: "workspace",
    expiresAt: "",
    changeNote: "Initial upload",
  });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        documents: DocRow[];
        expiringCount: number;
      }>(
        `/api/documents?search=${encodeURIComponent(search)}&category=${category}`,
      );
      setDocs(res.documents);
      setExpiringCount(res.expiringCount);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load documents",
        "error",
      );
    }
  }, [apiFetch, search, category, toast]);

  useLoadEffect(load);

  const onFilePick = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setForm((p) => ({
        ...p,
        title: p.title || file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: file.type || "text/plain",
        contentBase64: base64,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const base64 =
        form.contentBase64 ||
        (form.inlineText
          ? btoa(unescape(encodeURIComponent(form.inlineText)))
          : "");
      if (!base64) {
        toast("Choose a file or enter text content", "error");
        return;
      }
      await apiFetch("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: form.title,
          fileName:
            form.fileName ||
            `${form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`,
          mimeType: form.mimeType,
          contentBase64: base64,
          category: form.category,
          visibility: form.visibility,
          expiresAt: form.expiresAt || undefined,
          changeNote: form.changeNote,
        }),
      });
      setUploadOpen(false);
      setForm({
        title: "",
        fileName: "",
        mimeType: "text/plain",
        contentBase64: "",
        inlineText: "",
        category: "contract",
        visibility: "workspace",
        expiresAt: "",
        changeNote: "Initial upload",
      });
      toast("Document validated & stored in workspace vault");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    }
  };

  const openDetail = async (id: number) => {
    try {
      const res = await apiFetch<DocDetail>(`/api/documents?id=${id}`);
      setDetail(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Access denied", "error");
    }
  };

  const uploadNewVersion = (file: File | null) => {
    if (!file || !detail) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resStr = String(reader.result || "");
        const base64 = resStr.includes(",") ? resStr.split(",")[1] : resStr;
        await apiFetch("/api/documents", {
          method: "POST",
          body: JSON.stringify({
            action: "new_version",
            documentId: detail.document.id,
            fileName: file.name,
            mimeType: file.type || "text/plain",
            contentBase64: base64,
            changeNote: versionNote || "Updated revision",
          }),
        });
        setVersionNote("");
        toast("Uploaded new document revision");
        openDetail(detail.document.id);
        load();
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Version upload failed",
          "error",
        );
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <PageHeader
        title="Document Management Vault"
        description="Validated uploads, role-restricted vaults, live previews, version history & expiration alerts"
        actions={
          can("documents:write") && (
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="op-btn-primary text-xs"
            >
              <Upload className="h-3.5 w-3.5" /> Upload Document
            </button>
          )
        }
      />

      {expiringCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            <strong>{expiringCount} document(s)</strong> expire within the next
            30 days. Review compliance renewals below.
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, filename or preview text…"
            className="op-input pl-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="op-input w-auto"
        >
          <option value="all">All Categories</option>
          <option value="contract">Contracts</option>
          <option value="finance">Finance & Tax</option>
          <option value="receipt">Receipts</option>
          <option value="policy">Policies</option>
          <option value="hr">HR Confidential</option>
          <option value="project">Project Specs</option>
          <option value="general">General</option>
        </select>
      </div>

      <div className="op-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
            <tr>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Access Scope</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Expiration</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {d.title}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {d.fileName} · {formatBytes(d.sizeBytes)} · {d.uploaderName}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={d.category} />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                    <Shield className="h-3 w-3 text-indigo-500" />
                    {d.visibility.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">v{d.currentVersion}</td>
                <td className="px-4 py-3 tabular">
                  {d.expiresAt ? (
                    <span
                      className={
                        d.expiringSoon
                          ? "font-semibold text-amber-600 dark:text-amber-400"
                          : ""
                      }
                    >
                      {d.expiresAt} {d.expiringSoon ? "(Soon)" : ""}
                    </span>
                  ) : (
                    <span className="text-slate-400">No expiry</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openDetail(d.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <Eye className="h-3 w-3" /> Preview & Versions
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const headers = new Headers();
                          const res = await fetch(
                            `/api/documents?id=${d.id}&download=1`,
                            { credentials: "include", headers },
                          );
                          if (!res.ok) throw new Error("Download failed");
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = d.fileName;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          toast(
                            e instanceof Error ? e.message : "Download failed",
                            "error",
                          );
                        }
                      }}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No documents accessible for your filter/role.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Upload Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Document"
        subtitle="MIME & extension validated (PDF, PNG, JPEG, TXT, CSV, MD, DOCX, XLSX — max 5 MB)"
      >
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label htmlFor="documents-field-1" className="op-label">
              Document Title
            </label>
            <input
              id="documents-field-1"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Q2 Vendor Service Agreement"
              className="op-input"
            />
          </div>
          <div>
            <label htmlFor="documents-field-2" className="op-label">
              Select File
            </label>
            <input
              id="documents-field-2"
              type="file"
              accept=".pdf,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(e) => onFilePick(e.target.files?.[0] || null)}
              className="op-input text-xs"
            />
          </div>
          <div>
            <label htmlFor="documents-field-3" className="op-label">
              Or Paste Plain-Text Document Content
            </label>
            <textarea
              id="documents-field-3"
              rows={3}
              value={form.inlineText}
              onChange={(e) => setForm({ ...form, inlineText: e.target.value })}
              placeholder="Optional: create a plain-text policy, memo, or contract directly…"
              className="op-input text-xs"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="documents-field-4" className="op-label">
                Category
              </label>
              <select
                id="documents-field-4"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="op-input text-xs"
              >
                <option value="contract">Contract</option>
                <option value="finance">Finance</option>
                <option value="receipt">Receipt</option>
                <option value="policy">Policy</option>
                <option value="hr">HR</option>
                <option value="project">Project</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label htmlFor="documents-field-5" className="op-label">
                Permission Scope
              </label>
              <select
                id="documents-field-5"
                value={form.visibility}
                onChange={(e) =>
                  setForm({ ...form, visibility: e.target.value })
                }
                className="op-input text-xs"
              >
                <option value="workspace">All Workspace</option>
                <option value="managers">Managers & Admins</option>
                <option value="hr_only">HR Restricted</option>
                <option value="finance_only">Finance Restricted</option>
              </select>
            </div>
            <div>
              <label htmlFor="documents-field-6" className="op-label">
                Expiration Date
              </label>
              <input
                id="documents-field-6"
                type="date"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm({ ...form, expiresAt: e.target.value })
                }
                className="op-input text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Upload Securely
            </button>
          </div>
        </form>
      </Modal>

      {/* Preview & Version History Modal */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.document.title || ""}
        subtitle={
          detail
            ? `v${detail.document.currentVersion} · ${detail.document.fileName} · Scope: ${detail.document.visibility}`
            : ""
        }
        maxWidth="max-w-2xl"
      >
        {detail && (
          <div className="space-y-4">
            {detail.document.textPreview ? (
              <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                {detail.document.textPreview}
              </pre>
            ) : detail.document.mimeType.startsWith("image/") &&
              detail.document.contentBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${detail.document.mimeType};base64,${detail.document.contentBase64}`}
                alt={detail.document.title}
                className="max-h-60 rounded-xl border border-slate-200 object-contain"
              />
            ) : (
              <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                Binary document ({detail.document.mimeType}). Use Download to
                open locally.
              </div>
            )}

            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" /> Version History (
                {detail.versions.length})
              </h4>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {detail.versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold">
                        v{v.versionNumber}
                      </span>{" "}
                      — {v.changeNote}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {v.uploaderName} · {formatBytes(v.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {can("documents:write") && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="text-xs font-semibold">Upload New Revision</div>
                <input
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="Revision note (e.g. Signed addendum)"
                  className="op-input text-xs"
                />
                <input
                  type="file"
                  accept=".pdf,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                  onChange={(e) =>
                    uploadNewVersion(e.target.files?.[0] || null)
                  }
                  className="op-input text-xs"
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
