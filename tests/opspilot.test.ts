import { fixtureCode, assertPrivateFixture } from "./fixture-mail";
import { pool } from "../src/db";
import assert from "node:assert/strict";
import {
  applyPaymentToInvoice,
  applyRefundToInvoice,
  calculateInvoiceTotals,
  calculatePayroll,
} from "../src/lib/finance";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  validatePasswordStrength,
  validateUploadFile,
  verifyPassword,
} from "../src/lib/security";
import { extractReceiptOrInvoiceData } from "../src/lib/ai-engine";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

interface TestClient {
  cookie: string;
  csrfToken: string;
  tenantId: number;
  request: <T = Record<string, unknown>>(
    path: string,
    init?: RequestInit & { skipCsrf?: boolean },
  ) => Promise<{ status: number; data: T; raw: Response }>;
}

function makeClient(): TestClient {
  const client: TestClient = {
    cookie: "",
    csrfToken: "",
    tenantId: 0,
    async request<T = Record<string, unknown>>(
      path: string,
      init?: RequestInit & { skipCsrf?: boolean },
    ) {
      const headers = new Headers(init?.headers || {});
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (client.cookie) {
        headers.set("Cookie", client.cookie);
      }
      if (!init?.skipCsrf && client.csrfToken) {
        headers.set("x-csrf-token", client.csrfToken);
      }
      const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const pair = setCookie.split(";")[0];
        if (pair.startsWith("opspilot_session=")) {
          client.cookie = pair;
        }
      }
      const data = (await res.json().catch(() => ({}))) as T;
      if (
        data &&
        typeof data === "object" &&
        "csrfToken" in data &&
        typeof (data as { csrfToken?: unknown }).csrfToken === "string"
      ) {
        client.csrfToken = (data as { csrfToken: string }).csrfToken;
      }
      if (
        data &&
        typeof data === "object" &&
        "tenantId" in data &&
        typeof (data as { tenantId?: unknown }).tenantId === "number"
      ) {
        client.tenantId = (data as { tenantId: number }).tenantId;
      }
      return { status: res.status, data, raw: res };
    },
  };
  return client;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error("       ", err instanceof Error ? err.message : err);
  }
}

async function verify(client: TestClient, email: string) {
  const res = await client.request("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({
      verificationToken: await fixtureCode("verification", email),
    }),
  });
  assert.equal(res.status, 200);
}
async function run() {
  assertPrivateFixture();
  console.log(
    "\n=== OpsPilot Automated Test Suite (Unit + API + Security + Multi-Tenancy) ===\n",
  );
  const runTag = Date.now().toString(36);

  // -------------------------------------------------------------------------
  // 1. UNIT TESTS: Financial Math, Payroll Jurisdictions & Security Primitives
  // -------------------------------------------------------------------------
  await test("Unit: Deterministic invoice totals with discount & 18% GST", () => {
    const calc = calculateInvoiceTotals(
      [
        {
          description: "Engineering Sprint",
          quantity: 2,
          unitPriceCents: 1000000, // ₹10,000
          discountCents: 200000, // ₹2,000
          taxRateBps: 1800, // 18% on ₹18,000 = ₹3,240
        },
      ],
      100000, // ₹1,000 order discount
    );
    assert.equal(calc.subtotalCents, 2000000);
    assert.equal(calc.discountCents, 300000);
    assert.equal(calc.taxCents, 324000);
    assert.equal(calc.totalCents, 2024000);
  });

  await test("Unit: Partial payment, overpayment guard & refund math", () => {
    const p1 = applyPaymentToInvoice(
      {
        totalCents: 100000,
        paidCents: 0,
        refundedCents: 0,
        status: "sent",
        dueDate: "2026-12-31",
      },
      40000,
    );
    assert.equal(p1.status, "partial");
    assert.equal(p1.balanceCents, 60000);

    assert.throws(() =>
      applyPaymentToInvoice(
        {
          totalCents: 100000,
          paidCents: 40000,
          refundedCents: 0,
          status: "partial",
          dueDate: "2026-12-31",
        },
        70000,
      ),
    );

    const rf = applyRefundToInvoice(
      {
        totalCents: 100000,
        paidCents: 100000,
        refundedCents: 0,
        status: "paid",
      },
      100000,
    );
    assert.equal(rf.status, "refunded");
    assert.equal(rf.balanceCents, 0);
  });

  await test("Unit: Jurisdiction-aware payroll calculation (IN vs AE)", () => {
    const inPay = calculatePayroll({
      baseSalaryCents: 10000000,
      allowancesCents: 2000000,
      customDeductionsCents: 0,
      taxRateBps: 1000,
      jurisdiction: "IN",
    });
    assert.equal(inPay.statutoryDeductionCents, 1200000); // 12% EPF
    assert.ok(inPay.taxDeductionCents > 0);

    const aePay = calculatePayroll({
      baseSalaryCents: 10000000,
      allowancesCents: 2000000,
      customDeductionsCents: 0,
      taxRateBps: 1000,
      jurisdiction: "AE",
    });
    assert.equal(aePay.taxDeductionCents, 0);
    assert.equal(aePay.netPayCents, 12000000);
  });

  await test("Unit: Bcrypt hashing, AES-256-GCM vaulting & upload security filter", async () => {
    assert.notEqual(validatePasswordStrength("weak"), null);
    assert.equal(validatePasswordStrength("StrongPass!9"), null);

    const hash = await hashPassword("StrongPass!9");
    assert.equal(await verifyPassword("StrongPass!9", hash), true);
    assert.equal(await verifyPassword("WrongPass!9", hash), false);

    const cipher = encryptSecret("sk-secret-llm-key-12345");
    assert.ok(!cipher.includes("sk-secret"));
    assert.equal(decryptSecret(cipher), "sk-secret-llm-key-12345");

    assert.equal(
      validateUploadFile({
        fileName: "payload.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 100,
      }).valid,
      false,
    );
    assert.equal(
      validateUploadFile({
        fileName: "malware.exe",
        mimeType: "application/pdf",
        sizeBytes: 100,
      }).valid,
      false,
    );
    assert.equal(
      validateUploadFile({
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      }).valid,
      true,
    );
  });

  await test("Unit: Deterministic receipt extraction", () => {
    const ext = extractReceiptOrInvoiceData(
      "Vendor: CloudCorp\nInvoice #: CC-99\nDate: 2026-03-15\nSubtotal: ₹10,000\nGST (18%): ₹1,800\nTotal Amount: ₹11,800",
      "INR",
    );
    assert.equal(ext.vendor, "CloudCorp");
    assert.equal(ext.documentNumber, "CC-99");
    assert.equal(ext.totalCents, 1180000);
    assert.equal(ext.taxCents, 180000);
  });

  // -------------------------------------------------------------------------
  // 2. AUTHENTICATION, CSRF & MULTI-TENANT WORKSPACE REGISTRATION
  // -------------------------------------------------------------------------
  const tenantA = makeClient();
  const tenantB = makeClient();
  const employeeClient = makeClient();

  const emailA = `alpha-${runTag}@tenant-a.test`;
  const emailB = `bravo-${runTag}@tenant-b.test`;
  const empEmailA = `emp-${runTag}@tenant-a.test`;

  await test("API Auth: Register isolated Tenant A and Tenant B workspaces", async () => {
    const resA = await tenantA.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "Alpha Founder",
        email: emailA,
        password: "AlphaPass!2026",
        workspaceName: `Alpha Corp ${runTag}`,
        currency: "INR",
        jurisdiction: "IN",
      }),
    });
    assert.equal(resA.status, 201);
    assert.ok(tenantA.csrfToken.length > 10);
    assert.ok(
      !("sessionToken" in resA.data) &&
        !("verificationTokenPreview" in resA.data),
    );
    assert.match(resA.raw.headers.get("set-cookie")!, /HttpOnly/i);
    assert.equal((await tenantA.request("/api/dashboard")).status, 403);
    await verify(tenantA, emailA);

    const resB = await tenantB.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "Bravo Founder",
        email: emailB,
        password: "BravoPass!2026",
        workspaceName: `Bravo Labs ${runTag}`,
        currency: "INR",
        jurisdiction: "IN",
      }),
    });
    assert.equal(resB.status, 201);
    await verify(tenantB, emailB);
    assert.notEqual(tenantA.tenantId, tenantB.tenantId);
  });

  await test("Security: Reject unauthenticated access (401) and missing CSRF (403)", async () => {
    const anon = makeClient();
    const unauth = await anon.request("/api/dashboard");
    assert.equal(unauth.status, 401);

    const noCsrf = await tenantA.request("/api/crm/customers", {
      method: "POST",
      skipCsrf: true,
      body: JSON.stringify({
        name: "Blocked",
        company: "CSRF Co",
        email: "csrf@test.com",
      }),
    });
    assert.equal(noCsrf.status, 403);
  });

  await test("API Workspace: Invite Employee via single-use code & verify RBAC", async () => {
    const inv = await tenantA.request<{ invitation: { inviteCode: string } }>(
      "/api/workspace/members",
      {
        method: "POST",
        body: JSON.stringify({ email: empEmailA, role: "employee" }),
      },
    );
    assert.equal(inv.status, 201);

    assert.equal("inviteCode" in inv.data.invitation, false);
    const wrongEmail = `wrong-${runTag}@example.test`;
    const wrong = await makeClient().request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "Wrong Recipient",
        email: wrongEmail,
        password: "WrongPass2026",
        inviteCode: await fixtureCode("invitation", empEmailA),
      }),
    });
    assert.equal(wrong.status, 400);
    assert.equal(
      (await pool.query("select 1 from users where email=$1", [wrongEmail]))
        .rowCount,
      0,
    );
    const join = await employeeClient.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "Alpha Employee",
        email: empEmailA,
        password: "EmpPass!2026",
        inviteCode: await fixtureCode("invitation", empEmailA),
      }),
    });
    assert.equal(join.status, 201);
    await verify(employeeClient, empEmailA);
    assert.equal(employeeClient.tenantId, tenantA.tenantId);

    // Employee MUST be blocked from Finance & Billing
    const finBlocked = await employeeClient.request("/api/finance");
    assert.equal(finBlocked.status, 403);

    const billBlocked = await employeeClient.request("/api/billing", {
      method: "POST",
      body: JSON.stringify({ action: "change_plan", plan: "business" }),
    });
    assert.equal(billBlocked.status, 403);
  });

  // -------------------------------------------------------------------------
  // 3. CRM, SALES, INVOICING, FINANCE & MULTI-TENANT ISOLATION PROOF
  // -------------------------------------------------------------------------
  let customerAId = 0;
  let invoiceAId = 0;
  let docAId = 0;
  let productAId = 0;

  await test("API CRM: Create customer, log communication & manage lead pipeline", async () => {
    const cRes = await tenantA.request<{ customer: { id: number } }>(
      "/api/crm/customers",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Secret Alpha Client",
          company: `AlphaClient-${runTag}`,
          email: `client-${runTag}@alphaclient.test`,
          customerType: "enterprise",
          tags: ["VIP"],
        }),
      },
    );
    assert.equal(cRes.status, 201);
    customerAId = cRes.data.customer.id;

    const comm = await tenantA.request("/api/crm/customers", {
      method: "PATCH",
      body: JSON.stringify({
        id: customerAId,
        action: "add_communication",
        channel: "call",
        subject: "Kickoff",
        content: "Discussed Q2 deliverables",
      }),
    });
    assert.equal(comm.status, 201);

    const lead = await tenantA.request<{ lead: { id: number } }>(
      "/api/crm/leads",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Enterprise Deal",
          contactName: "Riya",
          company: "Zenith",
          estimatedValue: 250000,
          priority: "urgent",
        }),
      },
    );
    assert.equal(lead.status, 201);

    const move = await tenantA.request("/api/crm/leads", {
      method: "PATCH",
      body: JSON.stringify({ id: lead.data.lead.id, stage: "proposal" }),
    });
    assert.equal(move.status, 200);
  });

  await test("API Sales & Finance: Quotation → Invoice → Partial Pay → Full Pay → Refund", async () => {
    const qtn = await tenantA.request<{
      invoice: { id: number; totalCents: number };
    }>("/api/sales/invoices", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerAId,
        docType: "quotation",
        items: [
          {
            description: "Consulting Package",
            quantity: 1,
            unitPrice: 100000,
            taxRateBps: 1800,
          },
        ],
      }),
    });
    assert.equal(qtn.status, 201);
    assert.equal(qtn.data.invoice.totalCents, 11800000); // ₹1,18,000.00
    invoiceAId = qtn.data.invoice.id;

    // Convert quotation -> sales_order -> invoice
    assert.equal(
      (
        await tenantA.request("/api/sales/invoices", {
          method: "PATCH",
          body: JSON.stringify({ id: invoiceAId, action: "convert_to_order" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await tenantA.request("/api/sales/invoices", {
          method: "PATCH",
          body: JSON.stringify({
            id: invoiceAId,
            action: "convert_to_invoice",
          }),
        })
      ).status,
      200,
    );

    // Partial payment ₹50,000
    const partial = await tenantA.request<{
      invoice: { status: string; balanceCents: number };
    }>("/api/sales/invoices", {
      method: "PATCH",
      body: JSON.stringify({
        id: invoiceAId,
        action: "record_payment",
        amount: 50000,
      }),
    });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.invoice.status, "partial");
    assert.equal(partial.data.invoice.balanceCents, 6800000);

    // Remaining payment ₹68,000 -> paid
    const paid = await tenantA.request<{ invoice: { status: string } }>(
      "/api/sales/invoices",
      {
        method: "PATCH",
        body: JSON.stringify({
          id: invoiceAId,
          action: "record_payment",
          amount: 68000,
        }),
      },
    );
    assert.equal(paid.status, 200);
    assert.equal(paid.data.invoice.status, "paid");

    // Partial refund ₹8,000
    const refund = await tenantA.request("/api/sales/invoices", {
      method: "PATCH",
      body: JSON.stringify({
        id: invoiceAId,
        action: "refund",
        amount: 8000,
        reason: "Scope adjustment",
      }),
    });
    assert.equal(refund.status, 200);

    // Post expense & verify non-destructive ledger reversal
    const exp = await tenantA.request<{ transaction: { id: number } }>(
      "/api/finance",
      {
        method: "POST",
        body: JSON.stringify({
          type: "expense",
          category: "Cloud & Software",
          amount: 12000,
          description: "Duplicate test bill",
        }),
      },
    );
    assert.equal(exp.status, 201);

    const rev = await tenantA.request("/api/finance", {
      method: "PATCH",
      body: JSON.stringify({
        id: exp.data.transaction.id,
        reason: "Duplicate entry reversal",
      }),
    });
    assert.equal(rev.status, 200);
  });

  // -------------------------------------------------------------------------
  // 4. INVENTORY, PROCUREMENT, HRMS, PROJECTS & DOCUMENTS
  // -------------------------------------------------------------------------
  await test("API Inventory & Procurement: Vendor → PO → Approve → Receive Goods → Pay", async () => {
    const prod = await tenantA.request<{ product: { id: number } }>(
      "/api/inventory",
      {
        method: "POST",
        body: JSON.stringify({
          sku: `SKU-${runTag.toUpperCase()}`,
          name: "Studio Router Pro",
          category: "Hardware",
          itemType: "product",
          purchasePrice: 5000,
          sellingPrice: 8500,
          stockQuantity: 3,
          reorderLevel: 5,
        }),
      },
    );
    assert.equal(prod.status, 201);
    productAId = prod.data.product.id;

    const vend = await tenantA.request<{ vendor: { id: number } }>(
      "/api/procurement",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create_vendor",
          name: "NetGear OEM",
          contactName: "Kiran",
          email: "kiran@netgearoem.test",
        }),
      },
    );
    assert.equal(vend.status, 201);

    const po = await tenantA.request<{ purchaseOrder: { id: number } }>(
      "/api/procurement",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create_po",
          vendorId: vend.data.vendor.id,
          items: [
            {
              productId: productAId,
              description: "Studio Router Pro",
              quantity: 12,
              unitCost: 5000,
            },
          ],
        }),
      },
    );
    assert.equal(po.status, 201);
    const poId = po.data.purchaseOrder.id;

    assert.equal(
      (
        await tenantA.request("/api/procurement", {
          method: "PATCH",
          body: JSON.stringify({ id: poId, action: "approve" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await tenantA.request("/api/procurement", {
          method: "PATCH",
          body: JSON.stringify({ id: poId, action: "receive_goods" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await tenantA.request("/api/procurement", {
          method: "PATCH",
          body: JSON.stringify({ id: poId, action: "pay_vendor" }),
        })
      ).status,
      200,
    );

    // Verify stock automatically incremented from 3 -> 15
    const inv = await tenantA.request<{
      products: Array<{ id: number; stockQuantity: number }>;
    }>("/api/inventory");
    const updatedProd = inv.data.products.find((p) => p.id === productAId);
    assert.equal(updatedProd?.stockQuantity, 15);
  });

  await test("API HRMS: Onboard employee, confidential redaction, attendance, leave & payroll", async () => {
    const newEmployee = {
      action: "create_employee",
      fullName: "Neha Rao",
      email: `neha-${runTag}@tenant-a.test`,
      department: "Engineering",
      designation: "Lead Engineer",
      baseSalary: 120000,
      allowances: 30000,
      confidentialNotes: "Top secret comp note",
    };
    const onboard = (estimate: {
      jurisdiction?: string;
      taxRateBps?: number;
    }) =>
      tenantA.request<{
        employee: { id: number; jurisdiction: string; taxRateBps: number };
      }>("/api/hrms", {
        method: "POST",
        body: JSON.stringify({ ...newEmployee, ...estimate }),
      });
    assert.equal((await onboard({ taxRateBps: 1000 })).status, 400);
    assert.equal((await onboard({ jurisdiction: "IN" })).status, 400);
    assert.equal(
      (await onboard({ jurisdiction: "CA", taxRateBps: 1000 })).status,
      400,
    );
    const emp = await onboard({ jurisdiction: "IN", taxRateBps: 1000 });
    assert.equal(emp.status, 201);
    assert.equal(emp.data.employee.taxRateBps, 1000);
    assert.equal(emp.data.employee.jurisdiction, "IN");
    const empId = emp.data.employee.id;

    assert.equal(
      (
        await employeeClient.request("/api/hrms", {
          method: "POST",
          body: JSON.stringify({
            action: "attendance",
            mode: "check_in",
            employeeId: empId,
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await tenantB.request("/api/hrms", {
          method: "POST",
          body: JSON.stringify({
            action: "attendance",
            mode: "check_in",
            employeeId: empId,
          }),
        })
      ).status,
      404,
    );
    // Regular employee MUST see salary redacted
    const empView = await employeeClient.request<{
      employees: Array<{
        id: number;
        salaryRedacted: boolean;
        baseSalaryCents: number;
      }>;
    }>("/api/hrms");
    assert.equal(empView.status, 200);
    assert.equal(empView.data.employees[0].salaryRedacted, true);
    assert.equal(empView.data.employees[0].baseSalaryCents, 0);

    // A same-day interval has no completed minutes until checkout. Retries cannot rewrite it.
    const recordAttendance = (mode: string, time: string) =>
      tenantA.request<{
        attendance: { workMinutes: number; checkOutTime: string | null };
      }>("/api/hrms", {
        method: "POST",
        body: JSON.stringify({
          action: "attendance",
          employeeId: empId,
          mode,
          time,
          date: "2026-05-14",
        }),
      });
    const opened = await recordAttendance("check_in", "09:30");
    assert.equal(opened.status, 201);
    assert.equal(opened.data.attendance.workMinutes, 0);
    assert.equal(opened.data.attendance.checkOutTime, null);
    assert.equal((await recordAttendance("check_in", "09:31")).status, 409);
    assert.equal((await recordAttendance("check_out", "09:15")).status, 400);
    const closed = await recordAttendance("check_out", "10:15");
    assert.equal(closed.status, 200);
    assert.equal(closed.data.attendance.workMinutes, 45);
    assert.equal((await recordAttendance("check_out", "10:30")).status, 409);
    assert.equal((await recordAttendance("mark_absent", "10:31")).status, 409);

    const lv = await tenantA.request<{ leave: { id: number } }>("/api/hrms", {
      method: "POST",
      body: JSON.stringify({
        action: "request_leave",
        employeeId: empId,
        leaveType: "annual",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        days: 2,
        reason: "Rest",
      }),
    });
    assert.equal(lv.status, 201);

    assert.equal(
      (
        await tenantA.request("/api/hrms", {
          method: "PATCH",
          body: JSON.stringify({
            action: "review_leave",
            leaveId: lv.data.leave.id,
            decision: "approved",
          }),
        })
      ).status,
      200,
    );

    const pay = await tenantA.request<{ runs: Array<{ id: number }> }>(
      "/api/hrms",
      {
        method: "POST",
        body: JSON.stringify({ action: "run_payroll", period: "2026-05" }),
      },
    );
    assert.equal(pay.status, 201);
    assert.equal(
      (
        await tenantA.request("/api/hrms", {
          method: "PATCH",
          body: JSON.stringify({
            action: "pay_payslip",
            payrollId: pay.data.runs[0].id,
          }),
        })
      ).status,
      200,
    );
  });

  await test("API Projects, Tasks & Restricted Document Versioning", async () => {
    const prj = await tenantA.request<{ project: { id: number } }>(
      "/api/projects",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create_project",
          name: "Portal Launch",
          budget: 400000,
          deadline: "2026-10-01",
        }),
      },
    );
    assert.equal(prj.status, 201);

    const tsk = await tenantA.request<{ task: { id: number } }>(
      "/api/projects",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create_task",
          projectId: prj.data.project.id,
          title: "Ship API v1",
          priority: "high",
        }),
      },
    );
    assert.equal(tsk.status, 201);

    // Block malicious upload
    const badDoc = await tenantA.request("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        title: "XSS",
        fileName: "attack.html",
        mimeType: "text/html",
        contentBase64: Buffer.from("<script>alert(1)</script>").toString(
          "base64",
        ),
      }),
    });
    assert.equal(badDoc.status, 400);

    // Upload finance_only document + v2
    const goodDoc = await tenantA.request<{ document: { id: number } }>(
      "/api/documents",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: "Confidential Board Tax Filing",
          fileName: "tax-filing.txt",
          mimeType: "text/plain",
          visibility: "finance_only",
          category: "finance",
          contentBase64: Buffer.from("Board confidential v1").toString(
            "base64",
          ),
        }),
      },
    );
    assert.equal(goodDoc.status, 201);
    docAId = goodDoc.data.document.id;

    // Employee blocked from finance_only document
    const empDoc = await employeeClient.request(`/api/documents?id=${docAId}`);
    assert.equal(empDoc.status, 403);

    // Upload v2
    const v2 = await tenantA.request<{ document: { currentVersion: number } }>(
      "/api/documents",
      {
        method: "POST",
        body: JSON.stringify({
          action: "new_version",
          documentId: docAId,
          fileName: "tax-filing-v2.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("Board confidential v2").toString(
            "base64",
          ),
          changeNote: "Audited v2",
        }),
      },
    );
    assert.equal(v2.status, 201);
    assert.equal(v2.data.document.currentVersion, 2);
  });

  // -------------------------------------------------------------------------
  // 5. TENANT ISOLATION PROOF (ZERO CROSS-TENANT LEAKAGE)
  // -------------------------------------------------------------------------
  await test("Security: Strict multi-tenant isolation across CRM, Sales, Docs, Search & Finance", async () => {
    const bCustList = await tenantB.request<{ customers: unknown[] }>(
      "/api/crm/customers",
    );
    assert.equal(bCustList.data.customers.length, 0);

    const bStealCust = await tenantB.request(
      `/api/crm/customers?id=${customerAId}`,
    );
    assert.equal(bStealCust.status, 404);

    const bStealInv = await tenantB.request(
      `/api/sales/invoices?id=${invoiceAId}`,
    );
    assert.equal(bStealInv.status, 404);

    const bPayInv = await tenantB.request("/api/sales/invoices", {
      method: "PATCH",
      body: JSON.stringify({ id: invoiceAId, action: "cancel" }),
    });
    assert.equal(bPayInv.status, 404);

    const bStealDoc = await tenantB.request(`/api/documents?id=${docAId}`);
    assert.equal(bStealDoc.status, 404);

    const bAdjustStock = await tenantB.request("/api/inventory", {
      method: "PATCH",
      body: JSON.stringify({
        productId: productAId,
        movementType: "out",
        quantity: 1,
        reason: "Cross-tenant attempt",
      }),
    });
    assert.equal(bAdjustStock.status, 404);

    const bSearch = await tenantB.request<{ results: unknown[] }>(
      `/api/search?q=${encodeURIComponent(`AlphaClient-${runTag}`)}`,
    );
    assert.equal(bSearch.data.results.length, 0);

    const isolation = await tenantB.request("/api/workspace", {
      method: "PATCH",
      body: JSON.stringify({
        action: "switch_workspace",
        targetTenantId: tenantA.tenantId,
      }),
    });
    assert.equal(isolation.status, 403);
    const foreignLink = await tenantB.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        action: "create_project",
        name: "Rejected association",
        deadline: "2027-01-01",
        customerId: customerAId,
      }),
    });
    assert.equal(foreignLink.status, 400);
    assert.ok(!JSON.stringify(foreignLink.data).includes("insert into"));
    assert.deepEqual(
      (await tenantB.request("/api/projects")).data.projects,
      [],
    );
    const bFin = await tenantB.request<{
      summary: { totalIncomeCents: number };
    }>("/api/finance");
    assert.equal(bFin.data.summary.totalIncomeCents, 0);
  });

  // -------------------------------------------------------------------------
  // 6. AI PERMISSIONS, AUTOMATION APPROVAL GATE & COMMERCIAL BILLING
  // -------------------------------------------------------------------------
  await test("API AI: Deterministic accuracy for Owner & permission restriction for Employee", async () => {
    const ownerAi = await tenantA.request<{
      assistantMessage: { content: string; toolsUsed: string[] };
    }>("/api/ai", {
      method: "POST",
      body: JSON.stringify({
        action: "chat",
        message: "What is our revenue this month?",
      }),
    });
    assert.equal(ownerAi.status, 200);
    assert.ok(
      ownerAi.data.assistantMessage.toolsUsed.includes("get_financial_summary"),
    );
    assert.ok(ownerAi.data.assistantMessage.content.includes("1,18,000"));
    assert.match(ownerAi.data.assistantMessage.content, /Net recorded cash/);
    assert.doesNotMatch(ownerAi.data.assistantMessage.content, /net margin/i);

    // Employee MUST NOT receive financial figures from AI
    const empAi = await employeeClient.request<{
      assistantMessage: { content: string };
    }>("/api/ai", {
      method: "POST",
      body: JSON.stringify({
        action: "chat",
        message: "What is our revenue this month and who has overdue invoices?",
      }),
    });
    assert.equal(empAi.status, 200);
    assert.ok(
      empAi.data.assistantMessage.content.includes("Permission Restricted"),
    );
    assert.ok(!empAi.data.assistantMessage.content.includes("1,18,000"));
    const bAi = await tenantB.request("/api/ai");
    assert.deepEqual(bAi.data.messages, []);
    assert.equal((await employeeClient.request("/api/billing")).status, 403);
    const restricted = await employeeClient.request<{
      kpis: { revenueCents: number };
      recentActivities: unknown[];
    }>("/api/dashboard");
    assert.notEqual(restricted.data.kpis.revenueCents, 11800000);
    assert.deepEqual(restricted.data.recentActivities, []);
  });

  await test("API Automation: NL draft → block enable before approval → approve → dry-run", async () => {
    const draft = await tenantA.request<{
      workflow: { id: number; approvalStatus: string; isEnabled: boolean };
    }>("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        mode: "natural_language",
        prompt:
          "When a new lead is created wait 10 minutes, notify salesperson and create a follow-up task",
      }),
    });
    assert.equal(draft.status, 201);
    assert.equal(draft.data.workflow.approvalStatus, "pending_approval");
    assert.equal(draft.data.workflow.isEnabled, false);
    const wfId = draft.data.workflow.id;

    // Attempting to enable prior to approval MUST fail (400)
    const premature = await tenantA.request("/api/automations", {
      method: "PATCH",
      body: JSON.stringify({ action: "toggle", id: wfId, isEnabled: true }),
    });
    assert.equal(premature.status, 400);

    // Approve & activate
    const approved = await tenantA.request("/api/automations", {
      method: "PATCH",
      body: JSON.stringify({
        action: "approve",
        id: wfId,
        enableImmediately: true,
      }),
    });
    assert.equal(approved.status, 200);

    // Preview must never queue jobs in the workspace.
    const exec = await tenantA.request<{
      preview: { steps: string[]; enqueued: boolean };
    }>("/api/automations", {
      method: "PATCH",
      body: JSON.stringify({ action: "test_run", id: wfId }),
    });
    assert.equal(exec.status, 200);
    assert.equal(exec.data.preview.enqueued, false);
    assert.ok(exec.data.preview.steps.includes("delay"));
  });

  await test("Isolation: workflow approval, subscription history and version download are scoped", async () => {
    const a = await tenantA.request<{ workflows: { id: number }[] }>(
      "/api/automations",
    );
    assert.equal(
      (
        await tenantB.request("/api/automations", {
          method: "PATCH",
          body: JSON.stringify({
            action: "approve",
            id: a.data.workflows[0].id,
          }),
        })
      ).status,
      404,
    );
    assert.deepEqual(
      (await tenantB.request("/api/automations")).data.executions,
      [],
    );
    assert.deepEqual(
      (await tenantB.request(`/api/billing?tenantId=${tenantA.tenantId}`)).data
        .history,
      [],
    );
    assert.equal(
      (await tenantB.request(`/api/documents?id=${docAId}&download=1`)).status,
      404,
    );
    assert.equal(
      (await employeeClient.request(`/api/documents?id=${docAId}&download=1`))
        .status,
      403,
    );
  });
  await test("Auth: cookie only, no demo shortcut, missing/expired sessions rejected", async () => {
    const demo = await makeClient().request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ demoRole: "owner" }),
    });
    assert.equal(demo.status, 400);
    const header = await makeClient().request("/api/auth/me", {
      headers: { "x-opspilot-session": tenantA.cookie.split("=")[1] },
    });
    assert.equal(header.status, 401);
    const temp = makeClient();
    const login = await temp.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: emailA, password: "AlphaPass!2026" }),
    });
    assert.equal(login.status, 200);
    assert.equal("sessionToken" in login.data, false);
    assert.match(login.raw.headers.get("set-cookie")!, /SameSite=lax/i);
    // Insert a separate already-expired fixture. Never grant runtime UPDATE on sessions to age a test cookie.
    const { generateSecureToken, sha256 } = await import("../src/lib/security");
    const expired = generateSecureToken(32);
    const inserted = await pool.query(
      `insert into sessions (user_id,active_tenant_id,token_hash,csrf_token,expires_at)
       select user_id,active_tenant_id,$2,csrf_token,now()-interval '1 second' from sessions where token_hash=$1`,
      [sha256(temp.cookie.split("=")[1]), sha256(expired)],
    );
    assert.equal(inserted.rowCount, 1);
    temp.cookie = `opspilot_session=${expired}`;
    assert.equal((await temp.request("/api/auth/me")).status, 401);
  });
  await test("Agency: preview/import once, time entry, activation checklist and non-owner privacy", async () => {
    const csv = `name,company,email\nFixture Contact,"Studio, Inc.",import-${runTag}@example.test`;
    const batch = (confirm: boolean) =>
      tenantA.request("/api/crm/customers/import", {
        method: "POST",
        body: JSON.stringify({ csv, confirm }),
      });
    assert.deepEqual((await batch(false)).data, {
      confirmed: false,
      add: 1,
      skipped: 0,
    });
    const project = await tenantA.request<{
      projects: { id: number; loggedMinutes: number }[];
    }>("/api/projects");
    const id = project.data.projects[0].id;
    const entry = {
      action: "log_time",
      projectId: id,
      workDate: "2026-11-01",
      minutes: 75,
    };
    assert.equal(
      (
        await tenantB.request("/api/projects", {
          method: "POST",
          body: JSON.stringify(entry),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await tenantA.request("/api/projects", {
          method: "POST",
          body: JSON.stringify(entry),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await tenantA.request<{ projects: { loggedMinutes: number }[] }>(
          "/api/projects",
        )
      ).data.projects[0].loggedMinutes,
      75,
    );
    assert.equal((await batch(true)).data.add, 1);
    assert.equal((await batch(true)).data.add, 0);
    assert.deepEqual(
      new Set(
        (
          await tenantA.request<{ setup: string[] }>("/api/dashboard")
        ).data.setup,
      ),
      new Set(["customer", "project", "financial", "invitation"]),
    );
    assert.deepEqual(
      (await employeeClient.request("/api/dashboard")).data.setup,
      [],
    );
  });
  await test("Settlement: simultaneous final payments post a single linked ledger entry", async () => {
    const res = await tenantB.request<{ customer: { id: number } }>(
      "/api/crm/customers",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Finance Fixture",
          company: "Fixture Services",
          email: `settlement-${runTag}@example.test`,
        }),
      },
    );
    const project = await tenantB.request<{ project: { id: number } }>(
      "/api/projects",
      {
        method: "POST",
        body: JSON.stringify({
          action: "create_project",
          name: "Settlement engagement",
          deadline: "2027-03-01",
          customerId: res.data.customer.id,
        }),
      },
    );
    assert.equal(project.status, 201);
    const doc = await tenantB.request<{ invoice: { id: number } }>(
      "/api/sales/invoices",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: res.data.customer.id,
          projectId: project.data.project.id,
          docType: "invoice",
          items: [
            {
              description: "Fixture",
              quantity: 1,
              unitPrice: 10,
              taxRateBps: 0,
            },
          ],
        }),
      },
    );
    const id = doc.data.invoice.id;
    const post = () =>
      tenantB.request("/api/sales/invoices", {
        method: "PATCH",
        body: JSON.stringify({
          action: "record_payment",
          id,
          amountCents: 1000,
        }),
      });
    assert.deepEqual(
      (await Promise.all([post(), post()])).map((r) => r.status).sort(),
      [200, 400],
    );
    const ledger = await pool.query(
      "select amount_cents from transactions where invoice_id=$1 and tenant_id=$2",
      [id, tenantB.tenantId],
    );
    assert.equal(ledger.rowCount, 1);
    assert.equal(Number(ledger.rows[0].amount_cents), 1000);
    const expense = await tenantB.request("/api/finance", {
      method: "POST",
      body: JSON.stringify({
        type: "expense",
        category: "Delivery",
        description: "Fixture hosting",
        amountCents: 250,
        projectId: project.data.project.id,
      }),
    });
    assert.equal(expense.status, 201);
    const summary = (
      await tenantB.request<{
        projects: {
          billedCents: number;
          dueCents: number;
          netCashCents: number;
        }[];
      }>("/api/projects")
    ).data.projects[0];
    assert.equal(summary.billedCents, 1000);
    assert.equal(summary.dueCents, 0);
    assert.equal(summary.netCashCents, 750);
    const emp = (
      await employeeClient.request<{
        projects: { netCashCents: number | null }[];
      }>("/api/projects")
    ).data.projects[0];
    assert.equal(emp.netCashCents, null);
  });
  await test("Notification read receipts are per member, not one shared workspace bit", async () => {
    const noticeId = (
      await pool.query(
        "insert into notifications(tenant_id,title,message,link) values($1,'Fixture notice','Fixture only','/app') returning id",
        [tenantA.tenantId],
      )
    ).rows[0].id;
    await tenantA.request("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ id: noticeId }),
    });
    const read = async (c: TestClient) =>
      (
        await c.request<{ notifications: { id: number; isRead: boolean }[] }>(
          "/api/notifications",
        )
      ).data.notifications.find((n) => n.id === noticeId)?.isRead;
    assert.equal(await read(tenantA), true);
    assert.equal(await read(employeeClient), false);
    assert.equal(await read(tenantB), undefined);
  });
  await test("All seven roles: owner-only billing and RBAC boundaries survive member changes", async () => {
    const ws = await tenantA.request<{
      members: { id: number; email: string }[];
    }>("/api/workspace");
    const memberId = ws.data.members.find((m) => m.email === empEmailA)!.id;
    const patch = (client: TestClient, body: object) =>
      client.request("/api/workspace/members", {
        method: "PATCH",
        body: JSON.stringify({ memberId, ...body }),
      });
    for (const role of [
      "administrator",
      "manager",
      "hr_manager",
      "accountant",
      "salesperson",
      "employee",
    ]) {
      assert.equal((await patch(tenantA, { role })).status, 200);
      const login = await employeeClient.request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: empEmailA, password: "EmpPass!2026" }),
      });
      assert.equal(login.data.role, role);
      assert.equal((await employeeClient.request("/api/billing")).status, 403);
      assert.equal(
        (await employeeClient.request("/api/finance")).status,
        ["administrator", "manager", "accountant"].includes(role) ? 200 : 403,
      );
      if (role === "administrator") {
        assert.equal(
          (await patch(employeeClient, { role: "owner" })).status,
          403,
        );
        assert.equal(
          (
            await employeeClient.request("/api/workspace", {
              method: "PATCH",
              body: JSON.stringify({
                action: "update_role_permissions",
                rolePermissions: {},
              }),
            })
          ).status,
          403,
        );
      }
    }
    const owner = await tenantA.request("/api/auth/me");
    assert.equal(owner.data.role, "owner");
    assert.equal((await tenantA.request("/api/billing")).status, 200);
  });
  await test("API Billing & Auth Logout: unverified plan changes rejected; CSRF required", async () => {
    const up1 = await tenantA.request("/api/billing", {
      method: "POST",
      body: JSON.stringify({ action: "change_plan", plan: "starter" }),
    });
    assert.equal(up1.status, 400);

    const up2 = await tenantA.request("/api/billing", {
      method: "POST",
      body: JSON.stringify({ action: "change_plan", plan: "pro" }),
    });
    assert.equal(up2.status, 400);
    assert.equal(
      (await tenantA.request("/api/billing")).data.currentPlan,
      "community",
    );
    assert.equal(
      (
        await tenantB.request("/api/auth/logout", {
          method: "POST",
          skipCsrf: true,
        })
      ).status,
      403,
    );

    const out = await tenantB.request("/api/auth/logout", { method: "POST" });
    assert.equal(out.status, 200);
    const after = await tenantB.request("/api/auth/me");
    assert.equal(after.status, 401);
  });

  await test("API Auth: Password recovery token issuance, reset & re-login", async () => {
    const anon = makeClient();
    const req = await anon.request<{ devResetToken?: string }>(
      "/api/auth/password-reset",
      {
        method: "POST",
        body: JSON.stringify({ step: "request", email: emailB }),
      },
    );
    assert.equal(req.status, 200);
    const unknown = await anon.request("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({
        step: "request",
        email: `unknown-${runTag}@example.test`,
      }),
    });
    assert.deepEqual(req.data, unknown.data);
    assert.deepEqual(Object.keys(req.data), ["message"]);
    const token = await fixtureCode("recovery", emailB);
    await tenantB.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: emailB, password: "BravoPass!2026" }),
    });

    const confirm = await anon.request("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({
        step: "confirm",
        token,
        newPassword: "NewBravoPass!99",
      }),
    });
    assert.equal(confirm.status, 200);
    assert.equal((await tenantB.request("/api/auth/me")).status, 401);
    assert.equal(
      (
        await anon.request("/api/auth/password-reset", {
          method: "POST",
          body: JSON.stringify({
            step: "confirm",
            token,
            newPassword: "AnotherPass99",
          }),
        })
      ).status,
      400,
    );

    const relogin = await anon.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: emailB, password: "NewBravoPass!99" }),
    });
    assert.equal(relogin.status, 200);
  });

  await test("API Dashboard, Global Search, Notifications & Receipt Ledger Posting", async () => {
    const dash = await tenantA.request<{
      kpis: {
        revenueCents: number;
        customersCount: number;
        activeProjectsCount: number;
      };
      charts: { financialTrends: unknown[] };
    }>("/api/dashboard");
    assert.equal(dash.status, 200);
    assert.equal(dash.data.kpis.revenueCents, 11800000);
    assert.equal(dash.data.kpis.customersCount, 2);
    assert.equal(dash.data.kpis.activeProjectsCount, 1);
    assert.equal(dash.data.charts.financialTrends.length, 6);

    const search = await tenantA.request<{ results: Array<{ type: string }> }>(
      `/api/search?q=${encodeURIComponent("Studio Router")}`,
    );
    assert.equal(search.status, 200);
    assert.ok(search.data.results.some((r) => r.type === "product"));

    const notif = await tenantA.request<{ notifications: unknown[] }>(
      "/api/notifications",
    );
    assert.equal(notif.status, 200);
    assert.ok(notif.data.notifications.length >= 1);

    const receiptPost = await tenantA.request<{
      extracted: { totalCents: number };
      savedTransaction: { id: number };
    }>("/api/ai", {
      method: "POST",
      body: JSON.stringify({
        action: "extract_receipt",
        rawText:
          "Vendor: Stratos\nInvoice #: S-10\nDate: 2026-04-01\nSubtotal: ₹5,000\nGST (18%): ₹900\nTotal Amount: ₹5,900",
        saveAsExpense: true,
      }),
    });
    assert.equal(receiptPost.status, 200);
    assert.equal(receiptPost.data.extracted.totalCents, 590000);
    assert.ok(receiptPost.data.savedTransaction.id > 0);
  });

  await test("Physical stock: conversion issues stock once; cancelling an unpaid invoice restores it once", async () => {
    const qty = async () =>
      Number(
        (
          await pool.query(
            "select stock_quantity from products where tenant_id=$1 and id=$2",
            [tenantA.tenantId, productAId],
          )
        ).rows[0].stock_quantity,
      );
    const initial = await qty();
    const quote = await tenantA.request<{ invoice: { id: number } }>(
      "/api/sales/invoices",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: customerAId,
          docType: "quotation",
          items: [
            {
              productId: productAId,
              description: "Fixture item",
              quantity: 1,
              unitPrice: 1,
              taxRateBps: 0,
            },
          ],
        }),
      },
    );
    assert.equal(quote.status, 201);
    assert.equal(await qty(), initial);
    const change = (action: string) =>
      tenantA.request("/api/sales/invoices", {
        method: "PATCH",
        body: JSON.stringify({ action, id: quote.data.invoice.id }),
      });
    assert.equal((await change("convert_to_invoice")).status, 200);
    assert.equal(await qty(), initial - 1);
    assert.equal((await change("convert_to_invoice")).status, 409);
    assert.equal((await change("cancel")).status, 200);
    assert.equal((await change("cancel")).status, 409);
    assert.equal(await qty(), initial);
  });
  await test("Existing verified account can join only with its own unexpired invitation; rotation invalidates the prior cookie", async () => {
    // Use a separate fresh login so neither owner loses their primary test client.
    const alt = makeClient();
    assert.equal(
      (
        await alt.request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: emailB, password: "NewBravoPass!99" }),
        })
      ).status,
      200,
    );
    const inv = await tenantA.request("/api/workspace/members", {
      method: "POST",
      body: JSON.stringify({ email: emailB, role: "employee" }),
    });
    assert.equal(inv.status, 201);
    const before = makeClient();
    before.cookie = alt.cookie;
    const code = await fixtureCode("invitation", emailB);
    const accept = () =>
      alt.request("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({ action: "accept_invitation", inviteCode: code }),
      });
    assert.equal((await accept()).status, 200);
    assert.equal((await before.request("/api/auth/me")).status, 401);
    assert.equal((await alt.request("/api/finance")).status, 403);
    assert.equal((await accept()).status, 400);
  });
  await test("Frontend & Security Headers: Public and application shells return 200 with nosniff/SAMEORIGIN", async () => {
    const routes = [
      "/",
      "/demo",
      "/login",
      "/register",
      "/forgot-password",
      "/app",
      "/app/crm",
      "/app/sales",
      "/app/finance",
      "/app/hrms",
      "/app/inventory",
      "/app/procurement",
      "/app/projects",
      "/app/documents",
      "/app/ai",
      "/app/automations",
      "/app/billing",
      "/app/settings",
    ];
    for (const r of routes) {
      const res = await fetch(`${BASE_URL}${r}`);
      assert.equal(res.status, 200, `Route ${r} returned ${res.status}`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(
        res.headers.get("content-security-policy") || "",
        /object-src 'none'/,
      );
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run()
  .finally(() => pool.end())
  .catch((err) => {
    console.error("Test runner fatal error:", err);
    process.exit(1);
  });
