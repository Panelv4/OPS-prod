# OpsPilot changes

## Unreleased · 2026-11-18 · agency pilot candidate

- Recovered the existing app from the supplied ZIP. Added a lockfile, local fonts, explicit PG migrations, build configuration, local stack definition and CI gates. Removed web-triggered DDL/seeding and credential-based public demos.
- Restricted auth to cookie sessions; verified email gates business routes; mailbox-bound recovery/invites, role transitions, multi-workspace switching, PG throttles and secret validation. Role-aware dashboard, search, files, notifications and AI. Audit rows contain action/entity summaries rather than sensitive business payloads.
- Added a test-only subscription adapter, hosted checkout/portal entry points, signed event reconciliation and server limits. Replaced rupee placeholder tiers with configurable USD **hypotheses**. No live checkout.
- Added an encrypted transactional mail outbox and separate worker. Workflow approvals, delays, retries and daily UTC sweeps use persistent checkpoints; previews no longer produce side effects.
- Linked invoices, manual project expenses and recorded payments to client projects; added time entries, customer CSV preview/confirm, first-run checklist and aggregate activation/cohort reporting. Dashboard, finance and assistant labels distinguish cash flow from profit; the browser test records the payment and checks the project balance. Cash tracking is not accrual accounting.
- Extended financial transaction boundaries, stock cancellation/conversion checks, upload/version checks, and local regression and browser coverage. Employee estimate profile and income-tax rate must be supplied rather than inferred. Attendance starts at zero completed minutes; checkout uses the recorded interval and duplicate punches cannot replace it. Verified the production-only dependency install and rehearsed a logical database restore.

- Split local Compose bootstrap/migrator/runtime credentials. Added explicit runtime grants, role checks after restore, and one disposable Compose gate for CI/operators. Verified signup from a worker-delivered SMTP code and reran the native suite with the restricted login; the actual Docker/Mailpit gate and the independent verify job also passed on `425a1b3` (see release report).

The original archive changelog labelled an initial release “complete”. Its contents remain in the ZIP for provenance; it is not evidence of deployment, settlement, legal compliance, end-to-end mail deliverability, OCR or an independent audit. Current results and exceptions: [readiness](PRODUCTION_READINESS.md).
