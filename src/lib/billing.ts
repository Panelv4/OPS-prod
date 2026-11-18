import Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  billingEvents,
  gatewayEvents,
  subscriptionInvoices,
  tenants,
  users,
  workspaceMembers,
} from "@/db/schema";
import { ApiError } from "./http";
import { DEFAULT_PLANS, type PlanDefinition } from "./plans";
import { enqueueMail } from "./mail";

// This release intentionally has NO live charging mode. Use a dedicated test account, endpoint and database.
export const API_VERSION = "2025-02-24.acacia";
export function stripeTest() {
  if (
    process.env.BILLING_MODE !== "stripe_test" ||
    !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
    !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")
  )
    throw new ApiError(503, "Subscription checkout is not enabled.");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: API_VERSION,
    timeout: 4500,
    maxNetworkRetries: 0,
  });
}
export function priceId(plan: string) {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
}
export function paidPlan(
  invoice: Stripe.Invoice,
  customerId: string,
  subId: string,
): PlanDefinition | undefined {
  const line = invoice.lines.data[0];
  const price = line?.price;
  const charge = invoice.charge;
  const plan = DEFAULT_PLANS.find(
    (p) => p.usdCents > 0 && priceId(p.id) && priceId(p.id) === price?.id,
  );
  if (
    !plan ||
    !price ||
    invoice.livemode ||
    invoice.customer !== customerId ||
    invoice.subscription !== subId ||
    invoice.status !== "paid" ||
    invoice.paid_out_of_band ||
    invoice.currency !== "usd" ||
    invoice.amount_paid < plan.usdCents ||
    invoice.lines.has_more ||
    invoice.lines.data.length !== 1 ||
    line.proration ||
    line.quantity !== 1 ||
    line.type !== "subscription" ||
    price.unit_amount !== plan.usdCents ||
    price.currency !== "usd" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    !charge ||
    typeof charge === "string" ||
    charge.livemode ||
    charge.customer !== customerId ||
    charge.invoice !== invoice.id ||
    charge.status !== "succeeded" ||
    !charge.captured ||
    charge.disputed ||
    charge.currency !== "usd" ||
    charge.amount_captured - charge.amount_refunded < plan.usdCents
  )
    return;
  return plan;
}
export async function hostedBilling(
  tenantId: number,
  action: "checkout" | "portal",
  planId?: string,
) {
  const stripe = stripeTest();
  const origin = process.env.APP_ORIGIN;
  if (!origin)
    throw new ApiError(503, "Billing return origin is not configured.");
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for("update");
    let customer = tenant.stripeCustomerId;
    if (!customer) {
      if (action === "portal")
        throw new ApiError(409, "No subscription to manage.");
      customer = (
        await stripe.customers.create(
          { metadata: { workspace: String(tenantId) } },
          { idempotencyKey: `opspilot:customer:${tenant.slug}` },
        )
      ).id;
      await tx
        .update(tenants)
        .set({ stripeCustomerId: customer })
        .where(eq(tenants.id, tenantId));
    }
    const returnUrl = `${origin}/app/billing`;
    if (action === "portal") {
      if (!process.env.STRIPE_PORTAL_CONFIG)
        throw new ApiError(503, "Subscription management is not configured.");
      return (
        await stripe.billingPortal.sessions.create({
          customer,
          return_url: returnUrl,
          configuration: process.env.STRIPE_PORTAL_CONFIG,
        })
      ).url;
    }
    const plan = DEFAULT_PLANS.find((p) => p.id === planId && p.usdCents > 0);
    const price = plan && priceId(plan.id);
    if (!price || !plan)
      throw new ApiError(400, "Unknown or unavailable subscription price.");
    const catalogPrice = await stripe.prices.retrieve(price);
    if (
      catalogPrice.livemode ||
      !catalogPrice.active ||
      catalogPrice.currency !== "usd" ||
      catalogPrice.unit_amount !== plan.usdCents ||
      catalogPrice.recurring?.interval !== "month" ||
      catalogPrice.recurring.interval_count !== 1
    )
      throw new ApiError(
        409,
        "Provider price does not match the workspace catalog.",
      );
    const subs = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    if (
      subs.has_more ||
      subs.data.some(
        (s) => !["canceled", "incomplete_expired"].includes(s.status),
      )
    )
      throw new ApiError(
        409,
        "Use Manage subscription for an existing subscription.",
      );
    const open = await stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: 1,
    });
    if (open.data[0]) {
      if (open.data[0].metadata?.plan === plan.id && open.data[0].url)
        return open.data[0].url;
      throw new ApiError(
        409,
        "Finish or expire the open checkout before selecting another plan.",
      );
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      payment_method_types: ["card"],
      metadata: { plan: plan.id },
      success_url: returnUrl,
      cancel_url: returnUrl,
    });
    if (!session.url)
      throw new ApiError(503, "Checkout is temporarily unavailable.");
    return session.url;
  });
}

export async function recordPaidInvoice(
  tx: Database,
  tenantId: number,
  invoice: Stripe.Invoice,
  plan: PlanDefinition,
) {
  const charge = invoice.charge as Stripe.Charge;
  const end = new Date(invoice.lines.data[0].period.end * 1000);
  await tx
    .insert(subscriptionInvoices)
    .values({
      invoiceId: invoice.id,
      tenantId,
      chargeId: charge.id,
      subscriptionId: invoice.subscription as string,
      amountCents: invoice.amount_paid,
      refundedCents: charge.amount_refunded,
      currency: invoice.currency,
      plan: plan.id,
      periodEnd: end,
    })
    .onConflictDoUpdate({
      target: subscriptionInvoices.invoiceId,
      set: { refundedCents: charge.amount_refunded },
    });
  return end;
}

/** Signature checked by caller. Re-fetch authoritative state under the workspace lock. Event arrival order is not a clock. */
export async function reconcileBilling(stripe: Stripe, event: Stripe.Event) {
  if (event.livemode) throw new ApiError(400, "Wrong provider mode.");
  if (
    ![
      "invoice.paid",
      "invoice.payment_failed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "charge.refunded",
      "charge.dispute.created",
    ].includes(event.type)
  )
    return;
  const object = event.data.object as {
    customer?: string;
    charge?: string;
    id: string;
    amount_refunded?: number;
  };
  let customer = object.customer;
  if (!customer && event.type === "charge.dispute.created" && object.charge)
    customer = (await stripe.charges.retrieve(object.charge))
      .customer as string;
  if (typeof customer !== "string") return;
  const customerId = customer;
  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.stripeCustomerId, customerId))
      .for("update");
    if (!tenant) return;
    const inserted = await tx
      .insert(gatewayEvents)
      .values({ eventId: event.id, kind: event.type })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    if (event.type === "charge.refunded") {
      await tx
        .update(subscriptionInvoices)
        .set({
          refundedCents: sql`greatest(${subscriptionInvoices.refundedCents}, ${object.amount_refunded || 0})`,
        })
        .where(
          and(
            eq(subscriptionInvoices.tenantId, tenant.id),
            eq(subscriptionInvoices.chargeId, object.id),
          ),
        );
    }
    // Persist historical invoices even when the paid event was delivered after the next renewal.
    if (event.type === "invoice.paid") {
      const inv = await stripe.invoices.retrieve(object.id, {
        expand: ["charge"],
      });
      const p = paidPlan(inv, customerId, String(inv.subscription));
      if (p) await recordPaidInvoice(tx, tenant.id, inv, p);
    }
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      expand: ["data.latest_invoice.charge"],
    });
    const current = list.data.filter(
      (s) => !["canceled", "incomplete_expired"].includes(s.status),
    );
    let plan = DEFAULT_PLANS[0];
    let paidThrough: Date | null = null;
    let status = current.length ? "payment_pending" : "canceled";
    if (current.length === 1 && !list.has_more) {
      const sub = current[0];
      const inv = sub.latest_invoice;
      if (
        !sub.livemode &&
        sub.status === "active" &&
        inv &&
        typeof inv !== "string"
      ) {
        const paid = paidPlan(inv, customerId, sub.id);
        if (paid) {
          const end = await recordPaidInvoice(tx, tenant.id, inv, paid);
          if (end > new Date()) {
            plan = paid;
            paidThrough = end;
            status = sub.cancel_at_period_end ? "canceling" : "active";
          }
        }
      } else if (sub.status === "past_due") status = "past_due";
    }
    await tx
      .update(tenants)
      .set({
        plan: plan.id,
        paidThrough,
        aiTokenLimit: plan.aiTokenLimit,
        billingStatus: status,
      })
      .where(eq(tenants.id, tenant.id));
    if (tenant.plan !== plan.id || tenant.billingStatus !== status) {
      await tx
        .insert(billingEvents)
        .values({
          tenantId: tenant.id,
          previousPlan: tenant.plan,
          newPlan: plan.id,
          actorName: "Stripe test mode",
          description: `Test subscription: ${plan.name} (${status})`,
        });
      const owners = await tx
        .select({ email: users.email })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.tenantId, tenant.id),
            eq(workspaceMembers.role, "owner"),
            eq(workspaceMembers.status, "active"),
            eq(users.emailVerified, true),
          ),
        );
      for (const owner of owners)
        await enqueueMail(
          tx,
          "billing",
          owner.email,
          "Your test subscription status changed. Sign in and review Billing.",
          new Date(Date.now() + 86400_000),
        );
    }
  });
}
