import { eq, count, sum } from "drizzle-orm";
import type { Database } from "@/db";
import {
  tenants,
  workspaceMembers,
  workflows,
  documentVersions,
} from "@/db/schema";
import { ApiError } from "./http";
import { effectivePlan } from "./plans";

/** Called inside the same transaction as the insert. A workspace lock serializes concurrent reservations. */
export async function checkCapacity(
  tx: Database,
  tenantId: number,
  resource: "seat" | "workflow" | "bytes",
  extra = 1,
) {
  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .for("update");
  const plan = effectivePlan(tenant);
  const [usage] =
    resource === "bytes"
      ? await tx
          .select({ used: sum(documentVersions.sizeBytes) })
          .from(documentVersions)
          .where(eq(documentVersions.tenantId, tenantId))
      : resource === "seat"
        ? await tx
            .select({ used: count() })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.tenantId, tenantId))
        : await tx
            .select({ used: count() })
            .from(workflows)
            .where(eq(workflows.tenantId, tenantId));
  const limit =
    resource === "bytes"
      ? plan.storageLimit
      : resource === "seat"
        ? plan.maxUsers
        : plan.maxWorkflows;
  if (Number(usage.used || 0) + extra > limit)
    throw new ApiError(
      409,
      `Workspace ${resource} limit reached. Existing data is retained.`,
    );
}
