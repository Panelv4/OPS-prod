"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Send,
  ShieldCheck,
  Settings2,
  FileScan,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Modal, PageHeader, SectionTabs } from "@/components/ui/primitives";
import type { AiPendingAction } from "@/db/schema";

const SAMPLE_PROMPTS = [
  "What are our recorded inflows this month?",
  "Which customers have overdue payments?",
  "What are our largest expenses?",
  "Which products are low in stock?",
  "Which leads need follow-up?",
  "Which projects are delayed?",
  "How is our business performing?",
  "Detect any business anomalies and risks",
  "When an invoice is overdue create a follow-up task and notify accountant",
];

interface AiMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  pendingAction: AiPendingAction | null;
  tokensUsed: number;
  provider: string;
}

interface ExtractedReceipt {
  vendor: string;
  documentNumber: string | null;
  date: string | null;
  category: string;
  formattedSubtotal: string;
  formattedTax: string;
  formattedTotal: string;
  totalCents: number | null;
  confidence: string;
}

export default function AiPage() {
  const { apiFetch, toast, can } = useWorkspace();
  const [tab, setTab] = useState("assistant");
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [anomalies, setAnomalies] = useState<
    Array<{ severity: string; area: string; detail: string }>
  >([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [config, setConfig] = useState({
    provider: "deterministic",
    model: "opspilot-core-v1",
    hasApiKey: false,
    tokensUsed: 0,
    tokenLimit: 250000,
    canConfigure: false,
  });

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Receipt extractor
  const [rawReceipt, setRawReceipt] = useState("");
  const [extracted, setExtracted] = useState<ExtractedReceipt | null>(null);

  // Provider configuration modal
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgProvider, setCfgProvider] = useState("deterministic");
  const [cfgModel, setCfgModel] = useState("gpt-4o-mini");
  const [cfgKey, setCfgKey] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        messages: AiMsg[];
        insights: {
          anomalies: Array<{ severity: string; area: string; detail: string }>;
          recommendations: string[];
        };
        config: typeof config;
      }>("/api/ai");
      setMessages(res.messages);
      setAnomalies(res.insights.anomalies);
      setRecommendations(res.insights.recommendations);
      setConfig(res.config);
      setCfgProvider(res.config.provider);
      setCfgModel(res.config.model);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load AI", "error");
    }
  }, [apiFetch, toast]);

  useLoadEffect(load);

  const askQuestion = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await apiFetch<{
        userMessage: AiMsg;
        assistantMessage: AiMsg;
      }>("/api/ai", {
        method: "POST",
        body: JSON.stringify({ action: "chat", message: text }),
      });
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      setInput("");
      setConfig((c) => ({
        ...c,
        tokensUsed: c.tokensUsed + (res.assistantMessage.tokensUsed || 0),
      }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "AI query failed", "error");
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async (
    messageId: number,
    decision: "confirm" | "cancel",
  ) => {
    try {
      const res = await apiFetch<{ status: string; outcomeMessage?: string }>(
        "/api/ai",
        {
          method: "POST",
          body: JSON.stringify({
            action: "confirm_action",
            messageId,
            decision,
          }),
        },
      );
      toast(res.outcomeMessage || `Action ${decision}ed`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  const runExtraction = async (saveAsExpense: boolean) => {
    try {
      const res = await apiFetch<{
        extracted: ExtractedReceipt;
        savedTransaction: unknown;
      }>("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          action: "extract_receipt",
          rawText: rawReceipt,
          saveAsExpense,
        }),
      });
      setExtracted(res.extracted);
      if (saveAsExpense && res.savedTransaction) {
        toast("Confirmed & posted extracted receipt to Finance ledger!");
      } else {
        toast("Extracted structured invoice/receipt fields");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Extraction error", "error");
    }
  };

  const saveAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_ai",
          aiProvider: cfgProvider,
          aiModel: cfgModel,
          aiApiKey: cfgKey || undefined,
        }),
      });
      setCfgKey("");
      setCfgOpen(false);
      toast(
        "Updated AI provider configuration (key encrypted with AES-256-GCM)",
      );
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Config failed", "error");
    }
  };

  const renderMarkdownLines = (content: string) =>
    content.split("\n").map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={i} className={line === "" ? "h-2" : "leading-relaxed"}>
          {parts.map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={j} className="font-semibold">
                {part.slice(2, -2)}
              </strong>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      );
    });

  return (
    <div>
      {config.provider === "openai" && (
        <p role="note" className="op-card p-3 text-sm">
          Only messages starting with help: are sent to OpenAI. Do not enter
          customer information there. Other questions stay in this workspace.
        </p>
      )}
      <PageHeader
        title="OpsPilot Intelligence"
        description="Permission-aware AI assistant backed by deterministic database queries — zero fabricated figures"
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 tabular dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {config.tokensUsed.toLocaleString()} /{" "}
              {config.tokenLimit.toLocaleString()} tokens
            </span>
            {config.canConfigure && (
              <button
                type="button"
                onClick={() => setCfgOpen(true)}
                className="op-btn-secondary text-xs"
              >
                <Settings2 className="h-3.5 w-3.5" /> Provider
              </button>
            )}
          </div>
        }
      />

      <SectionTabs
        tabs={[
          { id: "assistant", label: "Business Assistant" },
          {
            id: "insights",
            label: "Anomaly Detection & Insights",
            count: anomalies.length,
          },
          { id: "extractor", label: "Invoice & Receipt Extraction" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "assistant" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Chat Column */}
          <div className="op-card flex flex-col lg:col-span-2 overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto p-5 max-h-[500px]">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    m.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs ${
                      m.role === "user"
                        ? "bg-slate-900 text-white dark:bg-indigo-600"
                        : "border border-slate-200 bg-slate-50/90 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    }`}
                  >
                    {renderMarkdownLines(m.content)}

                    {m.role === "assistant" && m.toolsUsed?.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-800">
                        <ShieldCheck className="h-3 w-3 text-emerald-600" />
                        {m.toolsUsed.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Human Confirmation Gate */}
                    {m.pendingAction && (
                      <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3 dark:border-indigo-900 dark:bg-slate-950">
                        <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                          Human Confirmation Required
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                          {m.pendingAction.summary}
                        </p>
                        {m.pendingAction.status === "pending" ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleConfirm(m.id, "confirm")}
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                            >
                              <Check className="h-3 w-3" /> Confirm & Execute
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirm(m.id, "cancel")}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              <X className="h-3 w-3" /> Dismiss
                            </button>
                          </div>
                        ) : (
                          <div className="mt-1.5 text-[11px] font-semibold capitalize text-emerald-600">
                            Status: {m.pendingAction.status}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                askQuestion(input);
              }}
              className="flex gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about cash flow, overdue payments, stock, leads, or draft a workflow…"
                className="op-input text-xs"
              />
              <button
                type="submit"
                disabled={sending}
                className="op-btn-primary text-xs shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? "Querying…" : "Ask"}
              </button>
            </form>
          </div>

          {/* Verified Prompt Library */}
          <div className="op-card p-5 space-y-3 h-fit">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span>Verified Business Queries</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Click any prompt to query your authorized live workspace database:
            </p>
            <div className="space-y-1.5">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => askQuestion(prompt)}
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "insights" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="op-card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Live Anomaly Detection ({anomalies.length})
            </h3>
            <div className="space-y-2.5">
              {anomalies.map((a, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {a.area}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        a.severity === "high"
                          ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      }`}
                    >
                      {a.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">
                    {a.detail}
                  </p>
                </div>
              ))}
              {anomalies.length === 0 && (
                <p className="text-xs text-slate-500">
                  No operational or financial anomalies detected.
                </p>
              )}
            </div>
          </div>

          <div className="op-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Strategic Recommendations & Suggested Actions
            </h3>
            <div className="space-y-2.5">
              {recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
                >
                  <strong className="mr-1.5 text-indigo-600 dark:text-indigo-400">
                    #{idx + 1}
                  </strong>
                  {rec}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "extractor" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="op-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileScan className="h-4 w-4 text-indigo-600" />
              <span>Paste Vendor Invoice or Receipt Text</span>
            </div>
            <textarea
              rows={8}
              value={rawReceipt}
              aria-label="Receipt text"
              placeholder="Paste the vendor, receipt date, reference and total. Missing fields stay unknown. Text only; no image OCR."
              onChange={(e) => {
                setRawReceipt(e.target.value);
                setExtracted(null);
              }}
              className="op-input font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => runExtraction(false)}
              className="op-btn-primary text-xs"
            >
              Extract Structured Fields
            </button>
          </div>

          <div className="op-card p-5 space-y-3">
            <h3 className="text-sm font-semibold">Extracted Accounting Data</h3>
            {!extracted ? (
              <p className="py-8 text-xs text-slate-500">
                Run extraction to preview structured vendor, invoice #, date,
                tax, and total before posting to your ledger.
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3.5 dark:divide-slate-800 dark:border-slate-800 tabular">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Vendor</span>
                    <strong>{extracted.vendor}</strong>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Document #</span>
                    <strong className="font-mono">
                      {extracted.documentNumber || "Not found"}
                    </strong>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Date</span>
                    <strong>{extracted.date || "Not found"}</strong>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Suggested Category</span>
                    <strong>{extracted.category}</strong>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Subtotal</span>
                    <span>{extracted.formattedSubtotal}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Tax</span>
                    <span>{extracted.formattedTax}</span>
                  </div>
                  <div className="flex justify-between py-2 text-sm font-bold">
                    <span>Verified Total</span>
                    <span>{extracted.formattedTotal}</span>
                  </div>
                </div>
                {can("finance:write") &&
                  extracted.date &&
                  (extracted.totalCents || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => runExtraction(true)}
                      className="op-btn-primary text-xs w-full"
                    >
                      <Check className="h-3.5 w-3.5" /> Confirm & Post Expense
                      to Ledger
                    </button>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Provider Configuration Modal */}
      <Modal
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        title="Configure LLM Provider"
        subtitle="Business answers stay local. Enabling OpenAI sends only questions prefixed help: to OpenAI using your key and may incur provider costs. Do not include customer data."
      >
        <form onSubmit={saveAiConfig} className="space-y-3.5">
          <div>
            <label htmlFor="ai-field-1" className="op-label">
              Provider Engine
            </label>
            <select
              id="ai-field-1"
              value={cfgProvider}
              onChange={(e) => setCfgProvider(e.target.value)}
              className="op-input"
            >
              <option value="deterministic">
                OpsPilot Deterministic Core (Zero API key required)
              </option>
              <option value="openai">OpenAI · optional help only</option>
            </select>
          </div>
          {cfgProvider !== "deterministic" && (
            <>
              <div>
                <label htmlFor="ai-field-2" className="op-label">
                  Model Identifier
                </label>
                <input
                  id="ai-field-2"
                  value={cfgModel}
                  onChange={(e) => setCfgModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="op-input font-mono text-xs"
                />
              </div>
              <div>
                <label className="op-label">
                  Provider API Key{" "}
                  {config.hasApiKey
                    ? "(Encrypted key stored — enter to rotate)"
                    : ""}
                </label>
                <input
                  type="password"
                  value={cfgKey}
                  onChange={(e) => setCfgKey(e.target.value)}
                  placeholder="sk-..."
                  className="op-input font-mono text-xs"
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCfgOpen(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Save Provider
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
