CREATE UNIQUE INDEX "customers_tenant_pair" ON "customers" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_pair" ON "documents" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_pair" ON "employees" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_pair" ON "invoices" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_pair" ON "products" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_tenant_pair" ON "projects" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_pair" ON "purchase_orders" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_tenant_pair" ON "tasks" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_pair" ON "transactions" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_tenant_pair" ON "vendors" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_tenant_pair" ON "workflows" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE TABLE "gateway_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "project_time" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"minutes" integer NOT NULL,
	"work_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_windows" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"subscription_id" text NOT NULL,
	"charge_id" text,
	"plan" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_charge_id_unique" UNIQUE("charge_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "ai_token_limit" SET DEFAULT 50000;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "invite_code" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_usage_month" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "paid_through" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "next_step" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "run_after" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "event_key" text;
--> statement-breakpoint
ALTER TABLE "project_time" ADD CONSTRAINT "project_time_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_time" ADD CONSTRAINT "project_time_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_time" ADD CONSTRAINT "project_time_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_time" ADD CONSTRAINT "project_time_projectId_tenant_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mail_due_idx" ON "mail_jobs" USING btree ("status","run_after");
--> statement-breakpoint
CREATE INDEX "project_time_workspace_idx" ON "project_time" USING btree ("tenant_id","project_id");
--> statement-breakpoint
CREATE INDEX "rate_window_expiry" ON "rate_windows" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "subscription_invoice_workspace_idx" ON "subscription_invoices" USING btree ("tenant_id","period_end");
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_tenant_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_customerId_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_tenant_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_documentId_tenant_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_productId_tenant_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customerId_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_tenant_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_employeeId_tenant_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_transactionId_tenant_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_vendorId_tenant_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_tenant_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_productId_tenant_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_tenant_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_tenant_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_tenant_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_tenant_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_attachmentDocumentId_tenant_fk" FOREIGN KEY ("tenant_id","attachment_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customerId_tenant_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendorId_tenant_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoiceId_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_purchaseOrderId_tenant_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiptDocumentId_tenant_fk" FOREIGN KEY ("tenant_id","receipt_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflowId_tenant_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_exec_due_idx" ON "workflow_executions" USING btree ("status","run_after");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_event_once_idx" ON "workflow_executions" USING btree ("workflow_id","event_key");
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_stripe_customer_id_unique" UNIQUE("stripe_customer_id");
--> statement-breakpoint
-- Raw codes from older installs are deliberately no longer retrievable; their hashes remain usable.
UPDATE workspace_invitations SET invite_code = NULL WHERE invite_code IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION opspilot_audit_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit entries are append only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER audit_readonly BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION opspilot_audit_readonly();
