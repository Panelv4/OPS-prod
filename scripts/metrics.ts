import "dotenv/config";
import { pool } from "../src/db";
// Operator-only aggregate dashboard. Never install an unscoped analytics API in a tenant workspace.
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing database");
  console.log(
    "OpsPilot · aggregate activation and retention (UTC; test payments are NOT MRR)",
  );
  const queries = [
    [
      "Registration cohorts",
      `select to_char(date_trunc('week',t.created_at),'YYYY-MM-DD') as week,count(*) as registrations,count(*) filter(where a.reached=4) as activated,count(*) filter(where exists(select 1 from workspace_activity d where d.tenant_id=t.id and d.module not in ('auth','workspace') and d.day::date >= current_date-6)) as active_last_7d from tenants t left join (select tenant_id,count(*) as reached from workspace_milestones group by tenant_id) a on a.tenant_id=t.id group by 1 order by 1 desc limit 12`,
    ],
    [
      "Module adoption, last 7 days",
      `select module,count(distinct tenant_id) as workspaces from workspace_activity where day::date >= current_date-6 group by module order by workspaces desc`,
    ],
    [
      "Week-one return, mature cohorts",
      `select to_char(date_trunc('week',t.created_at),'YYYY-MM-DD') as week,count(*) as eligible,count(*) filter(where exists(select from workspace_activity d where d.tenant_id=t.id and d.module not in ('auth','workspace') and d.day::date between t.created_at::date+7 and t.created_at::date+13)) as returned_week_two from tenants t where t.created_at::date <= current_date-14 group by 1 order by 1 desc limit 12`,
    ],
    [
      "Sandbox only · not revenue",
      `select count(*) as test_invoices,coalesce(sum(refunded_cents),0) as test_refunded_us_cents from subscription_invoices`,
    ],
    [
      "Usage and delivery",
      `select (select coalesce(sum(ai_tokens_used),0) from tenants where ai_usage_month=to_char(current_date,'YYYY-MM')) as ai_units_this_month,(select count(*) from mail_jobs where status='failed') as failed_deliveries,(select count(*) from workflow_executions where status='failed') as failed_workflows`,
    ],
  ];
  for (const [title, query] of queries) {
    console.log(title);
    console.table((await pool.query(query)).rows);
  }
  console.log(
    "Paid conversion, live MRR, churn and actual infrastructure cost: unavailable until approved live settlement and provider cost imports.",
  );
}
main()
  .catch(() => {
    console.error("Metrics unavailable; check connection and migrations.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
