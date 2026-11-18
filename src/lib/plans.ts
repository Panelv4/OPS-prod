import type { PlanTier } from "@/db/schema";
import catalog from "./plans.json";

export interface PlanDefinition {
  id: PlanTier;
  name: string;
  usdCents: number;
  priceDisplay: string;
  period: string;
  tagline: string;
  aiTokenLimit: number;
  maxUsers: number;
  maxWorkflows: number;
  storageLimit: number;
  features: string[];
  highlighted: boolean;
}
// One operator-owned catalog for the landing page, checkout validation, and enforcement. Legacy IDs are stable.
export const DEFAULT_PLANS: PlanDefinition[] = catalog.map((p) => ({
  ...p,
  id: p.id as PlanTier,
  priceDisplay: `$${p.usdCents / 100}`,
  period: "/ workspace per month · proposed USD",
  highlighted: p.id === "pro",
  storageLimit: p.storageMiB * 1024 * 1024,
  features: [
    `${p.maxUsers} included seats`,
    `${p.maxWorkflows} workflows`,
    `${p.storageMiB} MiB versioned files`,
    `${p.aiTokenLimit.toLocaleString("en-US")} AI usage units/month`,
  ],
}));
export function effectivePlan(tenant: {
  plan: PlanTier;
  paidThrough: Date | null;
}) {
  return (
    (tenant.paidThrough &&
      tenant.paidThrough > new Date() &&
      DEFAULT_PLANS.find((p) => p.id === tenant.plan)) ||
    DEFAULT_PLANS[0]
  );
}
