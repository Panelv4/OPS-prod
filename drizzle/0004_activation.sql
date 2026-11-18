CREATE TABLE "workspace_milestones" (
	"tenant_id" integer NOT NULL,
	"step" text NOT NULL,
	"reached_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_activity" (
	"tenant_id" integer NOT NULL,
	"day" text NOT NULL,
	"module" text NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_milestones" ADD CONSTRAINT "workspace_milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_activity" ADD CONSTRAINT "workspace_activity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_milestone_once_idx" ON "workspace_milestones" USING btree ("tenant_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_activity_once_idx" ON "workspace_activity" USING btree ("tenant_id","day","module");--> statement-breakpoint
CREATE INDEX "workspace_activity_day_idx" ON "workspace_activity" USING btree ("day");