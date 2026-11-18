import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Stripe from "stripe";
import { POST as webhook } from "../src/app/api/billing/webhook/route";
import { SMTPServer } from "smtp-server";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  tenants,
  workflows,
  workflowExecutions,
  mailJobs,
} from "../src/db/schema";
import {
  reconcileBilling,
  paidPlan,
  stripeTest,
  API_VERSION,
} from "../src/lib/billing";
import { effectivePlan } from "../src/lib/plans";
import { checkRateLimit } from "../src/lib/rate-limit";
import { vaultMaterial } from "../src/lib/config";
import {
  encryptSecret,
  validatePasswordStrength,
  validateUploadFile,
} from "../src/lib/security";
import { advanceWorkflow, dispatchWorkflowEvent } from "../src/lib/automation";
import { deliverMail, smtpTransport } from "../src/lib/mail-worker";
import { resolveUserPermissions } from "../src/lib/permissions";
import { assertPrivateFixture } from "./fixture-mail";
import { calculateInvoiceTotals, toCents } from "../src/lib/finance";
import { checkCapacity } from "../src/lib/entitlements";

const tag = randomUUID();
let tenantId: number;
before(async () => {
  assertPrivateFixture();
  const [t] = await db
    .insert(tenants)
    .values({ name: "Worker & provider fixture", slug: `fixture-${tag}` })
    .returning();
  tenantId = t.id;
});
after(async () => {
  await pool.end();
});

test("Runtime controls: no fallback key, empty permissions stay empty, unsafe units rejected", async () => {
  const previous = process.env.OPSPILOT_SECRET_KEY;
  try {
    delete process.env.OPSPILOT_SECRET_KEY;
    assert.throws(vaultMaterial);
    assert.throws(() => encryptSecret("fixture"));
  } finally {
    process.env.OPSPILOT_SECRET_KEY = previous;
  }
  assert.deepEqual(
    [
      ...resolveUserPermissions({
        role: "manager",
        tenantRolePermissions: { manager: [] },
      }),
    ],
    [],
  );
  assert.ok(validatePasswordStrength("Aa123456" + "é".repeat(36)));
  assert.equal(
    validateUploadFile({
      fileName: "image.jpg",
      mimeType: "image/png",
      sizeBytes: 20,
    }).valid,
    false,
  );
  assert.equal(
    validateUploadFile({
      fileName: "image.png",
      mimeType: "image/png",
      sizeBytes: 4,
      bytes: Buffer.from("text"),
    }).valid,
    false,
  );
  assert.equal(toCents(1.005), 101);
  assert.throws(() =>
    calculateInvoiceTotals([
      {
        description: "precision limit",
        quantity: 2,
        unitPriceCents: Number.MAX_SAFE_INTEGER,
      },
    ]),
  );
  const checks = await Promise.all(
    Array.from({ length: 8 }, () =>
      checkRateLimit(`fixture:${tag}`, 3, 60_000),
    ),
  );
  assert.equal(checks.filter((c) => c.allowed).length, 3);
  await assert.rejects(() =>
    db.transaction((tx) =>
      checkCapacity(tx, tenantId, "bytes", 51 * 1024 * 1024),
    ),
  );
  await pool.query(
    "insert into audit_logs(tenant_id, actor_name,action,module,entity_type,summary) values ($1,'Fixture','fixture.checked','test','fixture','fixture.checked')",
    [tenantId],
  );
  await assert.rejects(
    () =>
      pool.query("update audit_logs set summary=$1 where tenant_id=$2", [
        "changed",
        tenantId,
      ]),
    (err: { code?: string; message?: string }) =>
      err.code === "42501" ||
      (err.code === "P0001" && err.message === "Audit entries are append only"),
  );
});

test("Worker: durable delay, idempotent event, approval checkpoint and concurrent claims", async () => {
  const [wf] = await db
    .insert(workflows)
    .values({
      tenantId,
      name: "Fixture delay",
      triggerEvent: "schedule.daily",
      actions: [
        { type: "delay", delayMinutes: 5 },
        { type: "require_approval" },
        { type: "create_task", title: "fixture follow up" },
      ],
      approvalStatus: "approved",
      isEnabled: true,
    })
    .returning();
  const dispatch = () =>
    dispatchWorkflowEvent({
      tenantId,
      triggerEvent: "schedule.daily",
      eventKey: "day:fixture",
      payload: {},
      workflowId: wf.id,
    });
  const runs = await Promise.all([dispatch(), dispatch()]);
  assert.equal(
    runs.reduce((n, r) => n + r.queuedCount, 0),
    1,
  );
  const id = runs.flatMap((r) => r.executionIds)[0];
  const read = async () =>
    (
      await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, id))
    )[0];
  for (let i = 0; i < 80 && (await read()).status === "queued"; i++)
    await advanceWorkflow();
  assert.equal((await read()).status, "scheduled");
  assert.ok((await read()).runAfter.getTime() > Date.now() + 200_000);
  await db
    .update(workflowExecutions)
    .set({ runAfter: new Date(0) })
    .where(eq(workflowExecutions.id, id));
  await advanceWorkflow();
  assert.equal((await read()).status, "awaiting_approval");
  const taskCount = async () =>
    Number(
      (
        await pool.query("select count(*) from tasks where tenant_id=$1", [
          tenantId,
        ])
      ).rows[0].count,
    );
  assert.equal(await taskCount(), 0);
  // Simulate the authorized gate transition; the API's workspace/permission gate is exercised in the HTTP suite.
  await db
    .update(workflowExecutions)
    .set({ status: "queued", runAfter: new Date(0) })
    .where(eq(workflowExecutions.id, id));
  await Promise.all([advanceWorkflow(), advanceWorkflow()]);
  assert.equal((await read()).status, "completed");
  assert.equal(await taskCount(), 1);
});

test("Worker restart: failed step survives two one-shot worker processes and reaches the dead letter state", async () => {
  const [wf] = await db
    .insert(workflows)
    .values({
      tenantId,
      name: "Interrupted fixture",
      retryLimit: 1,
      triggerEvent: "lead.created",
      actions: [{ type: "log_audit" }],
      approvalStatus: "approved",
      isEnabled: true,
    })
    .returning();
  // Simulate an incompatible saved definition from an old release, not a user-supplied API payload.
  await pool.query("update workflows set actions=$1::jsonb where id=$2", [
    JSON.stringify([{ type: "log_audit", title: 42 }]),
    wf.id,
  ]);
  const [job] = await db
    .insert(workflowExecutions)
    .values({
      tenantId,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerEvent: "lead.created",
      triggerPayload: {},
      status: "queued",
      runAfter: new Date(0),
      attemptCount: 0,
    })
    .returning();
  const once = () =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/worker.ts", "--once"],
      { stdio: "pipe", timeout: 15000, env: { ...process.env, SMTP_HOST: "" } },
    );
  once();
  const get = async () =>
    (
      await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, job.id))
    )[0];
  assert.equal((await get()).status, "scheduled");
  assert.equal((await get()).nextStep, 0);
  await db
    .update(workflowExecutions)
    .set({ runAfter: new Date(0) })
    .where(eq(workflowExecutions.id, job.id));
  once();
  assert.equal((await get()).status, "failed");
  assert.equal((await get()).attemptCount, 2);
});

test("Mail worker: real loopback SMTP, scrubbed delivery log, retry and terminal failure", async () => {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    onData(stream, _session, cb) {
      stream.resume();
      stream.on("end", () => cb());
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    Object.assign(process.env, {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(address.port),
      SMTP_LOCAL_SINK: "1",
      SMTP_FROM: "fixture@example.test",
    });
    const transport = smtpTransport()!;
    const insert = async () =>
      (
        await db
          .insert(mailJobs)
          .values({
            kind: "verification",
            payload: encryptSecret(
              JSON.stringify({
                to: "fixture@example.test",
                text: "Fixture only",
              }),
            ),
            runAfter: new Date(0),
            expiresAt: new Date(Date.now() + 60000),
          })
          .returning()
      )[0];
    const sent = await insert();
    await deliverMail((msg) =>
      transport.sendMail({ ...msg, from: "fixture@example.test" }),
    );
    transport.close();
    const get = async (id: number) =>
      (await db.select().from(mailJobs).where(eq(mailJobs.id, id)))[0];
    assert.equal((await get(sent.id)).status, "sent");
    assert.equal((await get(sent.id)).payload, null);
    const retry = await insert();
    const fail = async () => {
      throw new Error("Fixture transport failure");
    };
    await deliverMail(fail);
    assert.equal((await get(retry.id)).attempts, 1);
    assert.ok((await get(retry.id)).runAfter > new Date());
    await db
      .update(mailJobs)
      .set({ attempts: 4, runAfter: new Date(0) })
      .where(eq(mailJobs.id, retry.id));
    await deliverMail(fail);
    assert.equal((await get(retry.id)).status, "failed");
    assert.equal((await get(retry.id)).payload, null);
  } finally {
    await new Promise<void>((resolve) => server.close(resolve));
  }
});

test("Stripe boundary: live config refused, raw webhook accepts only a valid test signature", async () => {
  process.env.BILLING_MODE = "stripe_test";
  process.env.STRIPE_SECRET_KEY = "sk_live_not_a_key";
  assert.throws(stripeTest);
  const stripe = new Stripe("sk_test_fixture", { apiVersion: API_VERSION });
  const secret = randomUUID();
  const body = JSON.stringify({ id: "evt_local", type: "invoice.paid" });
  const header = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  assert.equal(
    stripe.webhooks.constructEvent(body, header, secret).id,
    "evt_local",
  );
  assert.throws(() =>
    stripe.webhooks.constructEvent(`${body} `, header, secret),
  );
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: "sk_test_local_fixture",
    STRIPE_WEBHOOK_SECRET: `whsec_${secret}`,
  });
  const raw = JSON.stringify({
    id: `evt_${tag}`,
    type: "invoice.paid",
    livemode: false,
    data: { object: { id: `in_${tag}`, customer: "cus_unmapped_fixture" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const deliver = (body: string) =>
    webhook(
      new Request("http://127.0.0.1/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body,
      }),
    );
  assert.equal((await deliver(raw)).status, 200);
  assert.equal((await deliver(raw + " ")).status, 400);
});

test("Settlement reconciliation: trusted customer, price, receipt, replay, refund, arrears, renewal, cancellation", async () => {
  const customer = `cus_fixture_${tag}`,
    sub = "sub_fixture",
    price = "price_fixture_growth";
  process.env.STRIPE_PRICE_PRO = price;
  await db
    .update(tenants)
    .set({ stripeCustomerId: customer })
    .where(eq(tenants.id, tenantId));
  const inv = {
    id: `in_${tag}`,
    subscription: sub,
    customer,
    status: "paid",
    paid_out_of_band: false,
    currency: "usd",
    amount_paid: 5900,
    livemode: false,
    lines: {
      has_more: false,
      data: [
        {
          type: "subscription",
          quantity: 1,
          proration: false,
          price: {
            id: price,
            unit_amount: 5900,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
          period: { end: Math.floor(Date.now() / 1000) + 2592000 },
        },
      ],
    },
    charge: {
      id: `ch_${tag}`,
      invoice: `in_${tag}`,
      customer,
      status: "succeeded",
      captured: true,
      amount_captured: 5900,
      amount_refunded: 0,
      currency: "usd",
      livemode: false,
      disputed: false,
    },
  };
  let status = "active",
    cancelAtEnd = false;
  const stripe = {
    invoices: { retrieve: async () => inv },
    subscriptions: {
      list: async () => ({
        has_more: false,
        data:
          status === "canceled"
            ? []
            : [
                {
                  id: sub,
                  livemode: false,
                  status,
                  latest_invoice: inv,
                  cancel_at_period_end: cancelAtEnd,
                },
              ],
      }),
    },
  } as unknown as Stripe;
  const event = (
    type: string,
    suffix: string,
    object: object = { id: inv.id, customer },
  ) =>
    ({
      id: `evt_${tag}_${suffix}`,
      type,
      livemode: false,
      data: { object },
    }) as Stripe.Event;
  const state = async () =>
    (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
  assert.ok(
    !paidPlan(
      { ...inv, amount_paid: 1 } as unknown as Stripe.Invoice,
      customer,
      sub,
    ),
  );
  assert.ok(!paidPlan(inv as unknown as Stripe.Invoice, "cus_unrelated", sub));
  await assert.rejects(() =>
    reconcileBilling(stripe, {
      ...event("invoice.paid", "live"),
      livemode: true,
    }),
  );
  const paid = event("invoice.paid", "paid");
  await Promise.all([
    reconcileBilling(stripe, paid),
    reconcileBilling(stripe, paid),
  ]);
  assert.equal(effectivePlan(await state()).id, "pro");
  assert.equal(
    (
      await pool.query(
        "select 1 from subscription_invoices where tenant_id=$1",
        [tenantId],
      )
    ).rowCount,
    1,
  );
  cancelAtEnd = true;
  await reconcileBilling(stripe, event("customer.subscription.updated", "end"));
  assert.equal((await state()).billingStatus, "canceling");
  inv.charge.amount_refunded = 5900;
  await reconcileBilling(
    stripe,
    event("charge.refunded", "refund", {
      id: inv.charge.id,
      customer,
      amount_refunded: 5900,
    }),
  );
  assert.equal(effectivePlan(await state()).id, "community");
  assert.equal(
    (
      await pool.query(
        "select refunded_cents from subscription_invoices where tenant_id=$1",
        [tenantId],
      )
    ).rows[0].refunded_cents,
    5900,
  );
  status = "past_due";
  await reconcileBilling(stripe, event("invoice.payment_failed", "failed"));
  assert.equal((await state()).billingStatus, "past_due");
  status = "active";
  cancelAtEnd = false;
  inv.id += "_renew";
  inv.charge.id += "_renew";
  inv.charge.invoice = inv.id;
  inv.charge.amount_refunded = 0;
  await reconcileBilling(stripe, event("invoice.paid", "renew"));
  assert.equal(effectivePlan(await state()).id, "pro");
  status = "canceled";
  await reconcileBilling(stripe, event("customer.subscription.deleted", "del"));
  await reconcileBilling(stripe, event("invoice.paid", "late"));
  assert.equal(effectivePlan(await state()).id, "community");
});
