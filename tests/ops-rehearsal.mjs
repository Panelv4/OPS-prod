/** Private packaging gate. The SQL connection is read-only; mailbox codes never come from the DB. */
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";

class GateError extends Error {}
function check(condition, message) {
  if (!condition) throw new GateError(message);
}
async function eventually(read, message) {
  const until = Date.now() + 30000;
  do {
    const value = await read();
    if (value) return value;
    await sleep(250);
  } while (Date.now() < until);
  throw new GateError(message);
}

async function checkRole(db) {
  const {
    rows: [p],
  } = await db.query(`select
    current_user = 'opspilot_runtime' and session_user = current_user as identity_ok,
    not (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolreplication) and
      not exists (select from pg_auth_members where member = r.oid) as not_privileged,
    not has_database_privilege(current_database(),'CREATE,TEMP') and
      not has_schema_privilege('public','CREATE') and not has_schema_privilege('drizzle','USAGE') as no_ddl,
    not exists (select from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='drizzle' and c.relkind='r' and has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as no_journal,
    has_table_privilege('public.audit_logs','INSERT') and has_table_privilege('public.audit_logs','SELECT') and
      not has_table_privilege('public.audit_logs','UPDATE,DELETE,TRUNCATE,TRIGGER') as audit_append_only,
    not has_table_privilege('public.sessions','UPDATE') and not exists (
      select from pg_tables where schemaname='public' and (tableowner=current_user or
        has_table_privilege(format('%I.%I',schemaname,tablename),'TRUNCATE'))) as no_owner_rights
    from pg_roles r where rolname=current_user`);
  for (const [name, ok] of Object.entries(p))
    check(ok, `Database role gate failed: ${name}`);
  console.log(
    "PASS restricted DB login: no elevated membership, schema creation, migration journal, table ownership, truncate or audit edits",
  );
}

function sessionClient(origin) {
  let cookie, csrf;
  return async function request(method, path, expected, body) {
    const headers = { origin };
    if (body) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (csrf) headers["x-csrf-token"] = csrf;
    const res = await fetch(origin + path, {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    check(
      res.status === expected,
      `${method} ${path}: expected ${expected}, got ${res.status}`,
    );
    const data = await res.json();
    const pair = res.headers.get("set-cookie")?.split(";")[0];
    if (pair) cookie = pair;
    if (data.csrfToken) csrf = data.csrfToken;
    return data;
  };
}
async function verificationJobs(db) {
  const { rows } = await db.query(
    "select status, attempts, payload is null as scrubbed from mail_jobs where kind='verification'",
  );
  check(rows.length === 1, "Expected exactly one synthetic verification job");
  return rows[0];
}
function extractCode(text) {
  const code = String(text).match(/(?:^|\n)([a-f0-9]{48})\s*$/)?.[1];
  check(code, "No verification code in captured SMTP message");
  return code;
}
async function fromMailpit(email) {
  // Fixed private service on the disposable Compose network. Do not make this a generic mailbox client.
  const get = async (path) => {
    const res = await fetch("http://mailpit:8025/api/v1/" + path, {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    check(res.ok, `Local mail catcher returned HTTP ${res.status}`);
    return res.json();
  };
  const match = await eventually(
    async () =>
      (await get("messages?limit=20")).messages.find(
        (m) =>
          m.Subject === "OpsPilot · Verify your work email" &&
          m.To?.some((to) => to.Address === email),
      ),
    "No verification email in the private catcher",
  );
  const msg = await get("message/" + encodeURIComponent(match.ID));
  check(
    msg.To?.length === 1 && msg.To[0].Address === email,
    "Unexpected verification recipient",
  );
  return extractCode(msg.Text);
}
async function requireFresh(db) {
  const {
    rows: [s],
  } = await db.query(
    "select not exists(select from users) and not exists(select from tenants) and not exists(select from mail_jobs) as empty",
  );
  check(s.empty, "Refusing to register: use an empty rehearsal database");
}
async function enqueue(db, origin, creds) {
  const request = sessionClient(origin);
  const result = await request("POST", "/api/auth/register", 201, {
    ...creds,
    fullName: "Rehearsal Owner",
    workspaceName: "Fictional Studio",
  });
  check(
    result.emailVerificationPending === true,
    "Signup did not require mailbox verification",
  );
  await request("GET", "/api/dashboard", 403);
  const job = await verificationJobs(db);
  check(
    job.status === "queued" && job.attempts === 0 && !job.scrubbed,
    "Expected queued mail while worker is offline",
  );
  console.log(
    "PASS signup persisted during worker downtime; unverified workspace access denied",
  );
}
async function finish(db, origin, creds, readCode) {
  const code = await readCode(creds.email);
  const request = sessionClient(origin);
  await request("POST", "/api/auth/login", 200, creds);
  const result = await request("PATCH", "/api/auth/me", 200, {
    verificationToken: code,
  });
  check(
    result.user?.emailVerified === true,
    "Mailbox verification did not complete",
  );
  await request("GET", "/api/dashboard", 200);
  const billing = await request("GET", "/api/billing", 200);
  check(
    billing.mode === "off" && billing.currentPlan === "community",
    "Expected free/off billing",
  );
  const csv = "name,company,email\nAri Example,Cedar Studio,ari@example.test";
  const added = await request("POST", "/api/crm/customers/import", 200, {
    csv,
    confirm: true,
  });
  check(
    added.add === 1 && added.confirmed === true,
    "Verified owner could not import a fictional client",
  );
  await eventually(async () => {
    const job = await verificationJobs(db);
    return job.status === "sent" && job.attempts === 1 && job.scrubbed;
  }, "Expected one successful delivery with terminal payload scrubbed");
  console.log(
    "PASS delivered mailbox code verified the owner; CRM write, free billing and scrubbed outbox confirmed",
  );
}

// Native equivalent of the mail/DB path only; no simulated Docker or Mailpit API.
async function nativeMail(db, origin, creds) {
  const { SMTPServer } = await import("smtp-server");
  let message;
  const sink = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    onRcptTo(recipient, _s, cb) {
      cb(
        recipient.address === creds.email
          ? undefined
          : new Error("Unexpected fixture recipient"),
      );
    },
    onData(stream, _s, cb) {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        message = Buffer.concat(chunks).toString("utf8");
        cb();
      });
    },
  });
  await new Promise((resolve, reject) => {
    sink.once("error", reject);
    sink.listen(0, "127.0.0.1", resolve);
  });
  try {
    const env = {
      ...process.env,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(sink.server.address().port),
      SMTP_LOCAL_SINK: "1",
      SMTP_FROM: "fixture@example.test",
    };
    const once = () =>
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "scripts/worker.ts", "--once"],
        { env, timeout: 20000 },
      );
    await once();
    await enqueue(db, origin, creds);
    await once();
    await finish(db, origin, creds, () => extractCode(message));
  } finally {
    await new Promise((resolve) => sink.close(resolve));
  }
}

async function main() {
  const phase = process.argv[2];
  check(
    ["acl", "enqueue", "verify", "native-mail"].includes(phase),
    "Specify acl, enqueue, verify or native-mail",
  );
  const dsn = new URL(process.env.DATABASE_URL || "about:blank");
  const native = ["127.0.0.1", "localhost"].includes(dsn.hostname);
  check(
    (native || dsn.hostname === "postgres") &&
      (dsn.pathname.endsWith("_test") ||
        (phase === "acl" && dsn.pathname.endsWith("_restore"))),
    "Only private disposable test databases (or acl on isolated restores) are permitted",
  );
  for (const key of [
    "OPSPILOT_MIGRATOR_PASSWORD",
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
  ])
    check(
      !process.env[key],
      "Do not pass administrative credentials to the application or probe",
    );
  const db = new pg.Client({
    connectionString: dsn.href,
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 8000,
  });
  await db.connect();
  try {
    await checkRole(db);
    if (phase === "acl") return;
    const origin = new URL(process.env.APP_ORIGIN || "about:blank");
    check(
      dsn.pathname === "/opspilot_packaging_test" &&
        origin.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(origin.hostname) &&
        origin.origin === process.env.APP_ORIGIN,
      "Mail rehearsal requires the dedicated packaging DB and exact HTTP loopback origin",
    );
    check(
      process.env.BILLING_MODE === "off" &&
        process.env.ENABLE_EXTERNAL_AI === "0" &&
        !process.env.STRIPE_SECRET_KEY &&
        !process.env.SMTP_USER &&
        !process.env.SMTP_PASS,
      "External services must be disabled",
    );
    check(
      phase === "native-mail"
        ? native &&
            (!process.env.SMTP_HOST ||
              ["127.0.0.1", "localhost"].includes(process.env.SMTP_HOST))
        : !native &&
            process.env.SMTP_HOST === "mailpit" &&
            process.env.SMTP_LOCAL_SINK === "1",
      "Refusing non-fixture mail or DB settings",
    );
    const key =
      phase === "native-mail"
        ? randomBytes(24).toString("hex")
        : process.env.REHEARSAL_KEY;
    check(
      /^[0-9a-f]{48}$/.test(key || ""),
      "Missing private throwaway rehearsal key",
    );
    const creds = {
      email: `fixture-${key.slice(0, 16)}@example.test`,
      password: `Aa9-${key}`,
    };
    if (phase !== "verify") await requireFresh(db); // Before even starting a one-shot worker.
    if (phase === "native-mail") await nativeMail(db, origin.origin, creds);
    else if (phase === "enqueue") await enqueue(db, origin.origin, creds);
    else await finish(db, origin.origin, creds, fromMailpit);
  } finally {
    await db.end();
  }
}
main().catch((err) => {
  // Never print raw request/response bodies, DSNs, captured messages or subprocess environment.
  console.error(
    err instanceof GateError
      ? err.message
      : `Packaging probe failed (${err.code || err.name || "error"}).`,
  );
  process.exitCode = 1;
});
