import { NextResponse } from "next/server";
import { z } from "zod";
import { count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  billingEvents,
  documentVersions,
  subscriptionInvoices,
  workflows,
  workspaceMembers,
} from "@/db/schema";
import { handleApiError, requireAuth } from "@/lib/auth";
import { DEFAULT_PLANS, effectivePlan } from "@/lib/plans";
import { hostedBilling } from "@/lib/billing";
import { readJson } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "workspace:billing");
    const t = ctx.tenantId;
    const [[seats], [wf], [docs], history, invoices] = await Promise.all([
      db
        .select({ used: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.tenantId, t)),
      db
        .select({ used: count() })
        .from(workflows)
        .where(eq(workflows.tenantId, t)),
      db
        .select({ used: sum(documentVersions.sizeBytes) })
        .from(documentVersions)
        .where(eq(documentVersions.tenantId, t)),
      db
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.tenantId, t))
        .orderBy(desc(billingEvents.createdAt))
        .limit(30),
      db
        .select({
          id: subscriptionInvoices.invoiceId,
          amountCents: subscriptionInvoices.amountCents,
          refundedCents: subscriptionInvoices.refundedCents,
          currency: subscriptionInvoices.currency,
          periodEnd: subscriptionInvoices.periodEnd,
        })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.tenantId, t))
        .orderBy(desc(subscriptionInvoices.periodEnd))
        .limit(30),
    ]);
    const plan = effectivePlan(ctx.tenant);
    return NextResponse.json({
      currentPlan: plan.id,
      billingStatus: ctx.tenant.billingStatus,
      plans: DEFAULT_PLANS,
      mode: process.env.BILLING_MODE === "stripe_test" ? "test" : "off",
      hasCustomer: Boolean(ctx.tenant.stripeCustomerId),
      usage: {
        seatsUsed: seats.used,
        seatsLimit: plan.maxUsers,
        workflowsUsed: wf.used,
        workflowsLimit: plan.maxWorkflows,
        storageBytesUsed: Number(docs.used || 0),
        storageLimit: plan.storageLimit,
        aiTokensUsed: ctx.tenant.aiTokensUsed,
        aiTokensLimit: plan.aiTokenLimit,
        apiCallsCount: ctx.tenant.apiCallsCount,
      },
      history,
      invoices,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("checkout"),
      plan: z.enum(["starter", "pro", "business"]),
    })
    .strict(),
  z.object({ action: z.literal("portal") }).strict(),
]);
export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "workspace:billing");
    const body = actionSchema.parse(await readJson(request));
    return NextResponse.json({
      url: await hostedBilling(
        ctx.tenantId,
        body.action,
        body.action === "checkout" ? body.plan : undefined,
      ),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
