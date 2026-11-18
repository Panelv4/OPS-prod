/** Server-only runtime settings. Builds do not need (and must not embed) credentials. */
export function vaultMaterial(): string {
  const value = process.env.OPSPILOT_SECRET_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value) || /^(.)\1+$/.test(value)) {
    throw new Error(
      "OPSPILOT_SECRET_KEY must be generated with openssl rand -hex 32.",
    );
  }
  return value;
}

export function validateRuntimeConfig() {
  vaultMaterial();
  const url = new URL(process.env.DATABASE_URL || "about:blank");
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DATABASE_URL must identify a PostgreSQL database.");
  if (process.env.NODE_ENV === "production") {
    const origin = new URL(process.env.APP_ORIGIN || "about:blank");
    const local = ["localhost", "127.0.0.1"].includes(origin.hostname);
    if (
      origin.origin !== process.env.APP_ORIGIN ||
      !(origin.protocol === "https:" || (local && origin.protocol === "http:"))
    )
      throw new Error(
        "Set APP_ORIGIN to the canonical HTTPS origin (HTTP loopback allowed locally).",
      );
    if (!["off", "stripe_test"].includes(process.env.BILLING_MODE || "off"))
      throw new Error("Only off or stripe_test billing modes are supported.");
    if (
      process.env.BILLING_MODE === "stripe_test" &&
      (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
        !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    )
      throw new Error(
        "Test billing requires a dedicated test key and endpoint secret.",
      );
    if (
      !local &&
      (!process.env.SMTP_HOST ||
        !process.env.SMTP_FROM ||
        process.env.SMTP_LOCAL_SINK === "1")
    )
      throw new Error(
        "Configure transactional SMTP; local catchers may not serve public app origins.",
      );
    if (
      url.pathname.endsWith("_demo") ||
      process.env.OPSPILOT_SEED_DEMO === "1"
    )
      throw new Error("Demo databases are prohibited in production.");
  }
}
