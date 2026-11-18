# OpsPilot

A workspace for small service agencies: bring in a customer, scope a project, log delivery time, issue an invoice, record a payment, and see what remains to collect. The existing CRM, finance, people, inventory, procurement, documents, assistant and workflow modules are retained. Start with one engagement, not thirteen modules.

**Release state: local release candidate, not approved for customer data or paid launch.** Read [the release decision and evidence](PRODUCTION_READINESS.md). `/demo` is a disposable browser walkthrough; it does not sign anyone into a database. There is no live payment switch in this release.

## Run locally

For a disposable full-stack check on a Docker host, run `bash scripts/rehearse-compose.sh`. It uses a new database and a private mail catcher, tests signup across a worker restart, then cleans up its own stack. The [runbook](DEPLOYMENT_RUNBOOK.md) also has the commands for an interactive Compose workspace that keeps its data.

For native development use Node 22, npm, PostgreSQL 16 and a private SMTP catcher. Follow [environment setup](ENVIRONMENT_SETUP.md) to provision the DB roles. Run `npm ci`, then `npm run db:migrate -- --grant-runtime` **in a one-shot migration-owner environment**. In separate runtime-only terminals, run `npm run dev` and `npm run worker`. Do not put both database credentials in the web environment.

The browser uses same-origin `/api/...` requests. Set `APP_ORIGIN` to match the actual URL. The worker is not part of `next start`. No seed is required. For a local production-mode rehearsal use [the runbook](DEPLOYMENT_RUNBOOK.md); do not use `drizzle-kit push --force`, a shared demo password, or a public mail catcher.

## Try one fictional engagement

Start at `/demo` for the no-login walkthrough; reload to reset its sample task. To check the database-backed path, register a fictional owner with a **private** mail catcher, verify the mailbox, and use an empty workspace:

1. In CRM, preview then confirm a CSV with header `name,company,email` and one row, e.g. `Ari Example,Cedar Studio,ari@example.test`.
2. Create a project for Cedar Studio and log 30 minutes. Choose **Invoice this engagement**, enter one service at 100 in the workspace currency with zero tax/discount, then issue it.
3. The project should show 100 invoiced and 100 to collect. In Sales, record a payment of 100; reopen the project. It should show **0 to collect** and **100 net recorded project cash** before expenses. No money moves. This is the workflow covered by the [browser test](tests/browser.test.ts).

## Where to look

| Question | Starting point |
|---|---|
| What works? What is simulated or needs credentials? | [Feature matrix](FEATURE_MATRIX.md), [API](docs/API.md) |
| What did the ZIP actually contain? What changed? | [Audit](AUDIT.md), [security findings](SECURITY_AUDIT.md), [changelog](CHANGELOG.md) |
| What do we test, and what blocks a pilot? | [Release gates](PRODUCTION_READINESS.md), [tasks](TASKS.md), [implementation order](IMPLEMENTATION_ROADMAP.md) |
| How would we operate and recover it? | [Architecture](PRODUCTION_ARCHITECTURE.md), [backup](BACKUP_AND_RECOVERY.md), [incident response](INCIDENT_RESPONSE.md), [cost](COST_ESTIMATE.md) |
| Who is it for, and how should we learn? | [Market choice](MARKET_OPPORTUNITY.md), [personas](CUSTOMER_PERSONAS.md), [competition](COMPETITOR_ANALYSIS.md), [positioning](POSITIONING.md), [pricing](PRICING_RESEARCH.md) |
| How do we get permission to test demand? | [GTM](GTM_STRATEGY.md), [outreach](OUTREACH_PLAYBOOK.md), [content](CONTENT_CALENDAR.md), [launch drafts](PRODUCT_HUNT_LAUNCH.md), [referrals](REFERRAL_STRATEGY.md) |
| How do we handle customer data? | [Draft privacy and data procedures](PRIVACY_AND_DATA.md), [proposed DPA schedules](DPA_DRAFT.md). Not approved terms. |

`src/app` is the Next App Router and JSON API; `src/lib` holds server controls and domain logic; `src/db/schema.ts` and `drizzle/` define the database; `scripts/` contains operator commands. The historical ZIP and MIT license are preserved. Do not deploy the archive instead of the extracted app.
