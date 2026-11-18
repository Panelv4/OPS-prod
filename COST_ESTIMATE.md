# Cost worksheet · USD/month, 2026-11-18

**Zero marketing spend is not zero operating cost.** No services purchased. Numbers below are planning arithmetic for one region, not quotes or customer revenue. Recheck provider region, taxes, currencies, team plan, bandwidth, storage, minimum term and current price before approval.

| Assumption | Lean synthetic staging | Small paid pilot proposal |
|---|---:|---:|
| Always-on web | $7 candidate; measure memory | $25 candidate 2 GB instance rather than assuming Next fits 512 MiB |
| Always-on worker | $7 | $7 (needs load test) |
| Managed Postgres compute | $6 entry, **not** an HA sizing recommendation | Budget $20–40 until pilot rows/storage/PITR and connections measured |
| Team collaboration plan | $0 if eligible for solo testing | Allow $25; verify current plan/collaborator terms |
| Mail | local catcher $0 | Example 5,000 small messages × $0.10/1,000 ≈ $0.50 before data/add-ons |
| Encrypted backups, monitors, domain, extra storage/egress | local only, not a production substitute | Planning allowance $5–20, not a vendor quote |
| **Modeled subtotal** | **$20** hosted floor (native local testing incurs no new service bill) | **$82.50–117.50** before taxes, fees, excess usage, support or AI |

Vendor evidence: Render's worksheet gives $7 each for web/worker and $6 entry Postgres [2](https://render.com/articles/fastapi-hosting-cost); its hosting page lists a $25/2 GB example [4](https://render.com/hosting/java); workspace vs compute pricing is separate [3](https://render.com/articles/best-netlify-alternatives-in-2026). SES lists outbound $0.10/1,000 plus applicable data/other charges [1](https://aws.amazon.com/ses/pricing/). Real sender approval, safeguarding, monitoring and storage costs remain unverified.

At planning ₹87/USD the pilot range is about ₹7,178–10,223/month. At $59 per workspace, **two full-price workspaces** cover roughly this illustrative hosting subtotal only; that says nothing about company profitability. Add card/FX/refund fees after merchant terms, tax, founder labor, counsel, support, off-site restores, and growth in DB/WAL. Optional external help would use a workspace BYO key; usage units in OpsPilot are not a dollar measurement. At $0 initial budget use local rehearsals and interviews, not an expiring free production database.

Weekly cost review: actual provider bill by service vs forecast, GiB by file version, CPU/working set, connections/queue ages, email per active workspace, estimated/actual external AI spend separately, and net settled MRR. Alert at 70/90% of approved budget; no automatic upgrades or spend. Both founders approve any new account, paid dependency or autoscaling policy.
