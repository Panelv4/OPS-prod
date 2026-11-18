ALTER TABLE "invoices" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_tenant_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_tenant_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "transactions_project_idx" ON "transactions" USING btree ("tenant_id","project_id");