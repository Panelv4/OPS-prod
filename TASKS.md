# Persistent release ledger · 2026-11-18

P0 blocks real customer data; P1 blocks paid operation; P2 is demand-led. State describes this branch, not a public deployment. A = technical founder, B = product/ops; proposed owners, not signatures. “Local pass” is deliberately not “launch complete”.

| Task ID | Description / acceptance | Priority | Owner | Status / evidence / next step |
|---|---|---|---|---|
| OP-01 | Inventory source, claims, release files and original baseline | P0 | A | Done. [Audit](AUDIT.md); archive preserved. Original dev suite 20/20 included unsafe expectations |
| OP-02 | Reproducible native install/build, explicit PG16 migration, isolated demo | P0 | A | Local pass: clean ci and separate production-only install, seven journals twice, zero seeded users, browser sample resets. Legacy migration and container run not signed off |
| OP-03 | Verified auth, cookie/CSRF, mailbox-bound recovery/invites, revocation, durable rate limiter | P0 | A | Local auth/role tests + signup verified using a worker-delivered loopback SMTP code; external sender/domain/recovery drill pending |
| OP-04 | Multi-tenant/RBAC/files across reads, relations, writes and search/AI | P0 | A | Negative HTTP cases, tenant FKs, seven roles, scoped notification receipts. Independent review/custom-role matrix/load still open |
| OP-05 | Verified settlement, invoices, server quotas, cancellation/dunning/refund | P1 | A/B | Test-only adapter and signed raw handler; mature fixture lifecycle. No real provider, live merchant or charge. Sandbox + reconciliation gates open |
| OP-06 | Durable idempotent workflows, delay, approval, retries, dead letters | P1 | A | PG checkpoint/claim fixture + worker process restart/terminal failure. Preview doesn't enqueue. Alerting/manual replay/legacy version review pending |
| OP-07 | Financial transactions/stock consistency, file validation + AI privacy/cost control | P0 | A | Concurrent final payment, stock conversion/cancel, project-linked cash, explicit employee estimate inputs, receipt and restricted file tests. Accounting/payroll review, privacy/load/antivirus decisions open |
| OP-08 | Agency onboarding, import, time/project financials, activation/cohorts | P1 | A/B | Browser linked client/time/invoice/recorded-payment path passed; `npm run metrics` verified. Week-2 retention and WTP not validated; actual costs/paid funnel unavailable |
| OP-09 | Package/run, connection capacity, backup restoration, incident practice | P0 | A/B | Native PG16 split-role build, mail round trip and restore/ACL check passed. `npm run test:compose` ready, not run (no Docker). Need actual container/CI evidence, hosted monitoring, offsite/PITR and incident tabletop |
| OP-10 | Cited competitive/market research, pricing and zero-budget materials | P2 | B | Drafts complete; primary India, secondary UK. No outreach, real interviews, published listings or paid customers |
| OP-11 | Privacy, data lifecycle, GDPR/DPDP assessment, DPA/payment drafts | P0 | B/counsel | [Privacy](PRIVACY_AND_DATA.md), [DPA](DPA_DRAFT.md). Operator identity, subprocessors/locations, deletion tooling, legal review and approval required |
| OP-12 | Independent review and explicit founder release decision | P0 | both | **NO-GO** for customer data/paid launch. See [readiness](PRODUCTION_READINESS.md) |
| OP-13 | Remediate dev tool advisories | P0 for release | A | Prod audit 0; full 14 high/4 moderate package entries. Monitor picomatch/ESLint + Drizzle tooling patches; no force downgrade. Document risk approval if applicable |
| OP-14 | Observe provider delivery/queues/cost and confirm repeatable retention | P1 | A/B | Sign off monitoring budgets, worker lag, provider reconciliation and support process; do not report test payments as MRR |
