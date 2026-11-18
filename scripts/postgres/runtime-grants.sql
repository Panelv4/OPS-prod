-- Opt-in after migrations, on the dedicated OpsPilot DB as its schema migrator.
-- No default privileges: new tables and new destructive operations require review.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;
DO $$ BEGIN
  IF current_user <> 'opspilot_migrator'
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opspilot_runtime' AND rolcanlogin
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'opspilot_runtime'::regrole)
    OR EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user)
    OR has_schema_privilege('opspilot_runtime', 'public', 'CREATE')
    OR has_database_privilege('opspilot_runtime', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Unexpected database ownership or runtime role provisioning';
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM opspilot_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM opspilot_runtime;
GRANT SELECT, INSERT ON
  ai_messages, attendance_records, audit_logs, billing_events, customer_communications,
  customers, document_versions, documents, employees, gateway_events, invoice_items,
  invoices, leads, leave_requests, mail_jobs, notification_reads, notifications,
  payroll_runs, products, project_time, projects, purchase_order_items, purchase_orders,
  rate_windows, sessions, stock_movements, subscription_invoices, task_comments, tasks,
  tenants, transactions, users, vendors, workflow_executions, workflows, workspace_activity,
  workspace_invitations, workspace_members, workspace_milestones
TO opspilot_runtime;
GRANT UPDATE ON
  ai_messages, attendance_records, customers, documents, employees, invoices, leads,
  leave_requests, mail_jobs, payroll_runs, products, projects, purchase_order_items,
  purchase_orders, rate_windows, subscription_invoices, tasks, tenants, transactions,
  users, workflow_executions, workflows, workspace_activity, workspace_invitations, workspace_members
TO opspilot_runtime;
GRANT DELETE ON customers, documents, leads, mail_jobs, rate_windows, sessions, tasks, workflows TO opspilot_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO opspilot_runtime;
COMMIT;
