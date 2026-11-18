import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  aiMessages,
  invoices,
  tasks,
  transactions,
  workflows,
  type WorkflowAction,
  type WorkflowCondition,
} from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import {
  extractReceiptOrInvoiceData,
  gatherAuthorizedBusinessSnapshot,
  processAiAssistantQuery,
} from "@/lib/ai-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkCapacity } from "@/lib/entitlements";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { createNotification, recordAuditLog } from "@/lib/audit";
import { formatMoney } from "@/lib/finance";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "ai:use");

    const [history, snapshot] = await Promise.all([
      db
        .select()
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.tenantId, ctx.tenantId),
            eq(aiMessages.userId, ctx.user.id),
            eq(aiMessages.accessScope, [...ctx.permissions].sort().join(",")),
          ),
        )
        .orderBy(desc(aiMessages.id))
        .limit(60),
      gatherAuthorizedBusinessSnapshot(ctx),
    ]);

    return NextResponse.json({
      messages: history.reverse(),
      insights: {
        anomalies: snapshot.anomalies,
        recommendations: snapshot.recommendations,
      },
      config: {
        provider: ctx.tenant.aiProvider,
        model: ctx.tenant.aiModel,
        hasApiKey: Boolean(ctx.tenant.aiApiKeyEncrypted),
        tokensUsed: ctx.tenant.aiTokensUsed,
        tokenLimit: ctx.tenant.aiTokenLimit,
        canConfigure: ctx.role === "owner",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const aiPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chat"),
    message: z.string().min(2).max(1500),
  }),
  z.object({
    action: z.literal("extract_receipt"),
    rawText: z.string().min(5).max(8000),
    saveAsExpense: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("confirm_action"),
    messageId: z.number().int().positive(),
    decision: z.enum(["confirm", "cancel"]),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "ai:use");

    const rl = await checkRateLimit(
      `ai:${ctx.tenantId}:${ctx.user.id}`,
      30,
      60_000,
    );
    if (!rl.allowed) {
      throw new ApiError(
        429,
        `AI assistant rate limit exceeded. Retry in ${rl.retryAfterSec}s.`,
      );
    }

    const body = aiPostSchema.parse(await readJson(request));

    if (body.action === "chat") {
      const cleanQuestion = sanitizeText(body.message);
      const [userMsg] = await db
        .insert(aiMessages)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          accessScope: [...ctx.permissions].sort().join(","),
          role: "user",
          content: cleanQuestion,
          toolsUsed: [],
          tokensUsed: Math.ceil(cleanQuestion.length / 4),
          provider: "user",
        })
        .returning();

      const result = await processAiAssistantQuery(ctx, cleanQuestion);

      const [assistantMsg] = await db
        .insert(aiMessages)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          accessScope: [...ctx.permissions].sort().join(","),
          role: "assistant",
          content: result.answer,
          toolsUsed: result.toolsUsed,
          structuredData: result.structuredData,
          pendingAction: result.pendingAction,
          tokensUsed: result.tokensUsed,
          provider: result.provider,
        })
        .returning();

      return NextResponse.json({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
      });
    }

    if (body.action === "extract_receipt") {
      const extracted = extractReceiptOrInvoiceData(
        body.rawText,
        ctx.tenant.currency,
      );

      let savedTransaction = null;
      if (body.saveAsExpense) {
        if (!ctx.permissions.has("finance:write")) {
          throw new ApiError(
            403,
            "Your role requires finance:write permission to post extracted expenses.",
          );
        }
        if (
          extracted.totalCents === null ||
          extracted.totalCents <= 0 ||
          !z.iso.date().safeParse(extracted.date).success
        ) {
          throw new ApiError(
            400,
            "Review and supply a valid date and a positive total before posting.",
          );
        }
        const amount = extracted.totalCents;
        savedTransaction = await db.transaction(async (store) => {
          const [tx] = await store
            .insert(transactions)
            .values({
              tenantId: ctx.tenantId,
              entryNumber: `AIX-${generateSecureToken(4).toUpperCase()}`,
              type: "expense",
              direction: "debit",
              category: extracted.category,
              amountCents: amount,
              paymentMethod: "Unspecified",
              transactionDate: extracted.date!,
              description: `Extracted receipt ${extracted.documentNumber || "(no reference)"} — ${extracted.vendor}`,
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
              action: "ai.receipt_posted",
              module: "finance",
              entityType: "transaction",
              entityId: tx.id,
              summary: "",
              ipAddress: ctx.ipAddress,
            },
            store,
          );
          return tx;
        });
      }

      return NextResponse.json({ extracted, savedTransaction });
    }

    // confirm_action — Human-in-the-loop gate for sensitive AI operations
    return await db.transaction(async (tx) => {
      const [msg] = await tx
        .select()
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.id, body.messageId),
            eq(aiMessages.tenantId, ctx.tenantId),
            eq(aiMessages.userId, ctx.user.id),
            eq(aiMessages.accessScope, [...ctx.permissions].sort().join(",")),
          ),
        )
        .limit(1)
        .for("update");
      if (!msg || !msg.pendingAction) {
        throw new ApiError(404, "Pending AI confirmation not found.");
      }
      if (msg.pendingAction.status !== "pending") {
        throw new ApiError(400, "This action has already been processed.");
      }

      if (body.decision === "cancel") {
        const updatedPending = {
          ...msg.pendingAction,
          status: "cancelled" as const,
        };
        await tx
          .update(aiMessages)
          .set({ pendingAction: updatedPending })
          .where(eq(aiMessages.id, msg.id));
        return NextResponse.json({ status: "cancelled" });
      }

      const pending = msg.pendingAction;
      let outcomeMessage = "Confirmed action completed.";

      if (pending.actionType === "send_overdue_reminders") {
        if (!ctx.permissions.has("sales:write")) {
          throw new ApiError(403, "Missing sales:write permission.");
        }
        const ids = Array.isArray(pending.payload.invoiceIds)
          ? pending.payload.invoiceIds.map(Number).filter((n) => n > 0)
          : [];
        if (ids.length > 0) {
          const rows = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.tenantId, ctx.tenantId),
                inArray(invoices.id, ids),
              ),
            );
          for (const r of rows) {
            await tx
              .update(invoices)
              .set({
                reminderCount: r.reminderCount + 1,
                lastReminderAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(eq(invoices.id, r.id), eq(invoices.tenantId, ctx.tenantId)),
              );
          }
          await createNotification(
            {
              tenantId: ctx.tenantId,
              title: "AI Reminder Batch Confirmed",
              message: `${ctx.user.fullName} approved reminders for ${rows.length} overdue invoice(s).`,
              type: "success",
              link: "/app/sales",
            },
            tx,
          );
          outcomeMessage = `Recorded internal collection follow-ups for ${rows.length} overdue invoice(s).`;
        }
      } else if (pending.actionType === "create_task") {
        if (!ctx.permissions.has("projects:write")) {
          throw new ApiError(403, "Missing projects:write permission.");
        }
        const due = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await tx.insert(tasks).values({
          tenantId: ctx.tenantId,
          projectId: pending.payload.projectId
            ? Number(pending.payload.projectId)
            : null,
          title: String(pending.payload.title || "AI Suggested Task"),
          description: String(pending.payload.description || ""),
          assigneeName: ctx.user.fullName,
          priority: String(pending.payload.priority || "high"),
          status: "todo",
          dueDate: due,
          createdByUserId: ctx.user.id,
        });
        outcomeMessage = `Created recovery task "${pending.payload.title}".`;
      } else if (pending.actionType === "create_workflow_draft") {
        if (!ctx.permissions.has("automation:write")) {
          throw new ApiError(403, "Missing automation:write permission.");
        }
        const p = pending.payload;
        await checkCapacity(tx, ctx.tenantId, "workflow");
        const [wf] = await tx
          .insert(workflows)
          .values({
            tenantId: ctx.tenantId,
            name: String(p.name || "AI Workflow Draft"),
            description: String(p.description || ""),
            triggerEvent: String(p.triggerEvent || "lead.created"),
            scheduleExpression: p.scheduleExpression
              ? String(p.scheduleExpression)
              : null,
            conditions: (p.conditions as WorkflowCondition[]) || [],
            actions: (p.actions as WorkflowAction[]) || [],
            approvalStatus: "pending_approval",
            isEnabled: false,
            generatedByAi: true,
            createdByUserId: ctx.user.id,
          })
          .returning();
        outcomeMessage = `Saved workflow draft "${wf.name}" — awaiting approval in Automations.`;
      }

      await tx
        .update(aiMessages)
        .set({ pendingAction: { ...pending, status: "confirmed" } })
        .where(eq(aiMessages.id, msg.id));

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "ai.action_confirmed",
          module: "ai",
          entityType: pending.actionType,
          summary: outcomeMessage,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ status: "confirmed", outcomeMessage });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
