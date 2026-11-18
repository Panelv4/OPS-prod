# OpsPilot technical inventory · 18 November 2026

Source: the ZIP at repository root (147 entries including directories); extracted in place without replacing the original. This is a code and local-fixture review, not certification. Related findings, impact, fixes and test methods: [security register](SECURITY_AUDIT.md), [feature matrix](FEATURE_MATRIX.md), [release gates](PRODUCTION_READINESS.md). `CHANGELOG.md` in the archive is a claim set, not a test report.

## Archive baseline (before product edits)

Node 22.22.3 / npm 10.9.8, PostgreSQL 16.15 on loopback; synthetic data only. `npm ci` stopped with EUSAGE (no lock). After `npm install`, `npm run typecheck` passed. `npm run lint`: **29 errors**, primarily effect state and render purity. `npm run build`: **failed** fetching Plus Jakarta Sans and JetBrains Mono. `TEST_BASE_URL=… tsx tests/opspilot.test.ts` against the original dev server: **20 passed, 0 failed**. This includes assertions that *expected* plaintext recovery tokens, no frame header, and unverified plan grants. No `npm test` script. Runtime dependency advisory scan: one moderate, no high/critical at baseline. Docker CLI/daemon absent here.

## Architecture

Next App Router client pages → same-origin JSON handlers → server session + member permissions → Drizzle node-postgres Pool. Tailwind v4, custom primitives/theme and Recharts. Per-row tenant keys; no database row-level security in the initial SQL. Money largely uses integer minor units; payroll is a small rule table. AI is mostly SQL + deterministic text templates; optional OpenAI formatting. Workflow dispatch runs in the caller in the archive. `src/db/bootstrap.ts` executes SQL and seed on web requests. `drizzle/meta` describes the initial migration. No external queue, payment processor or SMTP transport in the original.

## Original API inventory

Each row is `src/app<path>/route.ts`. Gate column is the entry check; action-level checks must also be reviewed. `requireAuth` includes CSRF on writes. Public auth POSTs rely on their own checks.

| Path | Methods and entry gates |
|---|---|
| `/api/ai` | GET ai:use; POST ai:use |
| `/api/auth/login` | POST public |
| `/api/auth/logout` | POST session lookup |
| `/api/auth/me` | GET session lookup; PATCH session + action checks |
| `/api/auth/password-reset` | POST public |
| `/api/auth/register` | POST public |
| `/api/automations` | GET automation:view; POST automation:write; PATCH automation:write; DELETE automation:write |
| `/api/billing` | GET session + action checks; POST workspace:billing |
| `/api/crm/customers` | GET crm:view; POST crm:write; PATCH crm:write; DELETE crm:delete |
| `/api/crm/leads` | GET crm:view; POST crm:write; PATCH crm:write; DELETE crm:write |
| `/api/dashboard` | GET dashboard:view |
| `/api/documents` | GET documents:view; POST documents:write; DELETE documents:write |
| `/api/finance` | GET finance:view; POST finance:write; PATCH finance:reverse |
| `/api/health` | GET public |
| `/api/hrms` | GET session + action checks; POST session + action checks; PATCH session + action checks |
| `/api/inventory` | GET inventory:view; POST inventory:write; PATCH inventory:adjust |
| `/api/notifications` | GET session + action checks; PATCH session + action checks |
| `/api/procurement` | GET procurement:view; POST procurement:write; PATCH procurement:write |
| `/api/projects` | GET projects:view; POST projects:write; PATCH projects:write; DELETE projects:write |
| `/api/sales/invoices` | GET sales:view; POST sales:write; PATCH sales:write |
| `/api/search` | GET session + action checks |
| `/api/workspace/members` | POST workspace:users; PATCH workspace:users; DELETE workspace:users |
| `/api/workspace` | GET session + action checks; PATCH session + action checks |

## Original screens

`/app/ai`, `/app/automations`, `/app/billing`, `/app/crm`, `/app/documents`, `/app/finance`, `/app/hrms`, `/app/hrms/payslip/[id]`, `/app/inventory`, `/app`, `/app/procurement`, `/app/projects`, `/app/sales/[id]/print`, `/app/sales`, `/app/settings`, `/forgot-password`, `/login`, `/`, `/register`

## Database inventory

31 table definitions (not the README count of 26): `users`, `tenants`, `workspace_members`, `workspace_invitations`, `sessions`, `audit_logs`, `customers`, `customer_communications`, `leads`, `vendors`, `products`, `stock_movements`, `purchase_orders`, `purchase_order_items`, `invoices`, `invoice_items`, `documents`, `document_versions`, `transactions`, `employees`, `attendance_records`, `leave_requests`, `payroll_runs`, `projects`, `tasks`, `task_comments`, `workflows`, `workflow_executions`, `notifications`, `ai_messages`, `billing_events`.

## Release tooling & environment

`package.json`, Next config, Dockerfile, Compose and CI inspected. Original CI used `push --force`, seeded shared users, ignored audit failure, omitted lint. Runner copied a missing public directory. Backup script wrote gzip, **not encrypted backups**. Original `.env.example` advertised Redis, S3 and multiple LLM providers; declarations do not constitute working integrations. See ENVIRONMENT_SETUP.md for supported settings. API and deployment manuals are updated separately from the archive.

## Candidate delta (not reinterpreted archive evidence)

25 route files now: add `POST /api/crm/customers/import` (CRM write, JSON, preview by default) and `POST /api/billing/webhook` (raw signed test-mode body, no browser session). Billing GET **and** POST require owner billing scope; logout now requires session/CSRF. Workspace PATCH includes authenticated invitation acceptance. `/demo` is the only new public sample screen. Role and module changes are summarized in [the API guide](docs/API.md).

Seven journal entries, 39 application tables (not counting the Drizzle journal). Additions: `rate_windows`, `mail_jobs`, `gateway_events`, `subscription_invoices`, `project_time`, `workspace_activity`, `workspace_milestones`, `notification_reads`. `0001` adds tenant-paired keys and an append-only audit trigger; `0002`–`0006` cover worker cursor, AI access scope, activation, individual read receipts and project financial links. Row-level security is **not** enabled. No external cache or object store is required to run this build.

### Non-security findings register

| ID / severity | Finding / affected files | Verification and impact | Recommended correction → implemented status / evidence |
|---|---|---|---|
| A01 HIGH | No lock or `public/`; `package.json`, Dockerfile, CI | Archive `npm ci` EUSAGE; runner copied a missing directory. Build not reproducible | Lock, assets, same Node family, `npm ci` in image/CI. Clean native build and separate production-only dependency install verified; image gate open |
| A02 HIGH | `app/layout.tsx`, original fonts and lint | Original build attempted network font downloads; lint 29 errors. Release gate failed | Local font packages, fix effects and type-safe build. Native lint/typecheck/build pass |
| A03 HIGH | Original `lib/automation`, mail flags and workflow UI | Source: delay recorded a log, no durable wake-up; “sent” did not imply delivery. Missed reminders | Persist jobs, separate worker, retry, make preview side-effect free. Local process restart + loopback SMTP tests pass |
| A04 HIGH | Sales, finance, stock, procurement and HR multi-write paths | Archive inspection: postings and linked balances in separate statements; check susceptible to concurrent stale reads. No real loss observed | Transactional origin-module postings, locks, explicit reversal, linked project ledger. Concurrent final payment produces one posting; stock issue/cancel regression |
| A05 MEDIUM | `app/app/sales`, `lib/finance`, receipt parser | Uniform tax defaults, floating previews and invented missing reference/date could mislead | Default new workspace tax to zero; configure before issuing. Bound integer calculations, no fabricated receipt date/number. Minor-unit tests; employee creation rejects a missing estimate profile or withholding rate. Attendance no longer invents an hour at check-in; checkout interval and retry tested. Payroll remains illustrative |
| A06 MEDIUM | Original onboarding, links and `plans` | One shared sample login and no meaningful activation milestones. Hard to evaluate agency value | Detached sample, CRM import, linked engagement, checklist and aggregate cohorts. Chromium smoke, not a usability study |
| A07 MEDIUM | Old backup/deploy docs and scripts | Compressed file called a backup without a restore drill; stale setup instructions | Private custom-format dump, refuse nonempty targets, compare actual restore. No off-site encryption or PITR drill established |
| A08 INFORMATIONAL | Comparison/pricing/marketing claims in original README, landing and docs | Code/claims mismatch on live settlement, integrations, OCR and pricing | Replace release story; split proposed/supported/unsupported. `FEATURE_MATRIX.md`, cited research and draft-only GTM |

Risk-specific findings, severity, fixes, verification and remaining gaps are in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) names the exact test commands and what they do **not** prove.
