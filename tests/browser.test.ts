/** Optional browser gate. Point CHROMIUM_PATH at a local compatible Chromium binary. Synthetic loopback only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { assertPrivateFixture, fixtureCode } from "./fixture-mail";
import { pool } from "../src/db";

async function main() {
  assertPrivateFixture();
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    // Never allow scripts, uploads, analytics or email to contact a real service in this test.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.name));
    page.setDefaultTimeout(7000);
    await page.goto(`${base}/demo`);
    await page.getByRole("button", { name: "2. Project delivery" }).click();
    await page.getByText("Mark sample task delivered").click();
    await page.getByText("Status: Delivered").waitFor();
    await page.reload();
    await page.getByRole("button", { name: "2. Project delivery" }).click();
    await page.getByText("Status: In progress").waitFor();
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await page.locator("html.dark").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    console.log("PASS mobile demo, disposable state, local theme and width");
    await page.getByRole("link", { name: "Create an empty workspace" }).click();
    const email = `browser-${randomUUID()}@example.test`;
    await page.getByLabel("Full Name").fill("Browser Fixture");
    await page.getByLabel("Work Email").fill(email);
    await page.getByLabel("Password").fill(`Local9A-${randomUUID()}`);
    await page.getByLabel("Business / Workspace Name").fill("Browser Studio");
    await page.getByRole("button", { name: "Launch Workspace" }).click();
    await page
      .getByRole("heading", { name: "Verify your work email" })
      .waitFor();
    await page
      .getByLabel("Email code")
      .fill(await fixtureCode("verification", email));
    await page.getByText("Verify and open workspace").click();
    await page
      .getByRole("heading", { name: /Your first client engagement/ })
      .waitFor();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log(
      "PASS UI registration, required verification, mobile navigation and setup",
    );
    await page.goto(`${base}/app/crm`);
    await page.getByRole("button", { name: "Import CSV" }).click();
    const csv = page.getByRole("dialog", { name: "Import customers" });
    await csv
      .getByLabel(/CSV/)
      .fill(
        "name,company,email\nBrowser Contact,Cedar Example,cedar@example.test",
      );
    await csv.getByRole("button", { name: "Preview import" }).click();
    await csv.getByText("1 to add · 0 duplicates").waitFor();
    await csv.getByRole("button", { name: "Confirm import" }).click();
    await csv.waitFor({ state: "hidden" });
    await page.goto(`${base}/app`);
    await page
      .getByRole("link", { name: /✓ Add or import a customer/ })
      .waitFor();
    await page.getByRole("link", { name: /Set a project budget/ }).click();
    const project = page.getByRole("dialog", { name: "Create Project" });
    await project.waitFor();
    await page.keyboard.press("Escape");
    await project.waitFor({ state: "hidden" });
    await page.keyboard.press("Control+k");
    await page
      .getByRole("dialog", { name: "Global Workspace Search" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.goto(`${base}/app/projects?new=project`);
    await project.getByLabel("Project Name").fill("Cedar launch");
    await project
      .getByLabel("Client", { exact: true })
      .selectOption({ label: "Cedar Example" });
    await project.getByLabel("Deadline").fill("2027-03-15");
    await project
      .getByRole("button", { name: "Create Project", exact: true })
      .click();
    await project.waitFor({ state: "hidden" });
    await page.getByLabel("Minutes on Cedar launch today").fill("30");
    await page.getByRole("button", { name: "Log time" }).click();
    await page.getByText("Recorded project time: 0h 30m").waitFor();
    await page.getByRole("link", { name: "Invoice this engagement" }).click();
    const invoice = page.getByRole("dialog", {
      name: "Create Invoice, Sales Order or Quotation",
    });
    await invoice
      .getByLabel("Client project (optional)")
      .getByRole("option", { name: "Cedar launch" })
      .waitFor({ state: "attached" });
    assert.equal(
      await invoice
        .getByLabel("Client project (optional)")
        .locator("option:checked")
        .textContent(),
      "Cedar launch",
    );
    await invoice.getByPlaceholder("Item description").fill("Prototype review");
    await invoice.locator("input[type=number]").nth(1).fill("100");
    await invoice.getByRole("button", { name: "Issue Document" }).click();
    await invoice.waitFor({ state: "hidden" });
    await page.goto(`${base}/app/projects`);
    await page.getByText(/Invoiced: .*100.*To collect: .*100/).waitFor();
    await page.goto(`${base}/app/sales`);
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    const payment = page.getByRole("dialog", { name: /Record Payment —/ });
    assert.equal(
      await payment.getByLabel(/Payment Amount/).inputValue(),
      "100",
    );
    await payment.getByRole("button", { name: "Confirm Payment" }).click();
    await payment.waitFor({ state: "hidden" });
    await page.goto(`${base}/app/projects`);
    await page.getByText(/Invoiced: .*100.*To collect: \D*0$/).waitFor();
    await page.getByText(/Net recorded project cash: \D*100$/).waitFor();
    console.log(
      "PASS linked client → project → logged time → invoice → recorded collection",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS CSV review + commit, persisted checklist, deep link, keyboard dialogs; no page exceptions",
    );
  } finally {
    await browser.close();
  }
}
main()
  .catch((err) => {
    console.error(
      "Browser smoke failed:",
      String(err?.message || "unknown error").split("\n")[0],
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
