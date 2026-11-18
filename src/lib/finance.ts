import { ApiError } from "./http";
export interface LineItemInput {
  description: string;
  productId?: number | null;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  taxRateBps?: number;
}

export interface ComputedLineItem {
  description: string;
  productId: number | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRateBps: number;
  netBeforeTaxCents: number;
  taxAmountCents: number;
  lineTotalCents: number;
}

export interface ComputedInvoiceTotals {
  items: ComputedLineItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Deterministic integer-cents calculation for invoice/quotation/PO line items.
 * Never uses floating-point currency math.
 */
export function calculateInvoiceTotals(
  rawItems: LineItemInput[],
  orderDiscountCents = 0,
): ComputedInvoiceTotals {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(400, "At least one line item is required.");
  }
  if (!Number.isInteger(orderDiscountCents) || orderDiscountCents < 0) {
    throw new ApiError(
      400,
      "Order discount must be a non-negative integer in minor units.",
    );
  }

  let subtotalCents = 0;
  let itemDiscountTotal = 0;
  let taxCents = 0;

  const items: ComputedLineItem[] = rawItems.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ApiError(
        400,
        `Invalid quantity for "${item.description}". Must be a positive integer.`,
      );
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new ApiError(
        400,
        `Invalid unit price for "${item.description}". Must be non-negative.`,
      );
    }
    const discountCents = item.discountCents ?? 0;
    const taxRateBps = item.taxRateBps ?? 0;
    if (!Number.isInteger(discountCents) || discountCents < 0) {
      throw new ApiError(400, `Invalid discount for "${item.description}".`);
    }
    if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
      throw new ApiError(400, `Invalid tax rate for "${item.description}".`);
    }

    const gross = item.quantity * item.unitPriceCents;
    if (
      !Number.isSafeInteger(gross) ||
      !Number.isSafeInteger(gross * taxRateBps)
    )
      throw new ApiError(400, "Line amount exceeds supported precision.");
    if (discountCents > gross) {
      throw new ApiError(
        400,
        `Line discount cannot exceed line gross amount for "${item.description}".`,
      );
    }
    const netBeforeTaxCents = gross - discountCents;
    const taxAmountCents = Math.round((netBeforeTaxCents * taxRateBps) / 10000);
    const lineTotalCents = netBeforeTaxCents + taxAmountCents;

    subtotalCents += gross;
    itemDiscountTotal += discountCents;
    taxCents += taxAmountCents;

    return {
      description: item.description.trim(),
      productId: item.productId ?? null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents,
      taxRateBps,
      netBeforeTaxCents,
      taxAmountCents,
      lineTotalCents,
    };
  });

  const maxOrderDiscount = subtotalCents - itemDiscountTotal + taxCents;
  if (![subtotalCents, taxCents, maxOrderDiscount].every(Number.isSafeInteger))
    throw new ApiError(400, "Invoice exceeds supported precision.");
  if (orderDiscountCents > maxOrderDiscount) {
    throw new ApiError(
      400,
      "Order-level discount cannot exceed invoice total.",
    );
  }

  const totalDiscount = itemDiscountTotal + orderDiscountCents;
  const totalCents =
    subtotalCents - itemDiscountTotal + taxCents - orderDiscountCents;

  return {
    items,
    subtotalCents,
    discountCents: totalDiscount,
    taxCents,
    totalCents,
  };
}

export function applyPaymentToInvoice(
  current: {
    totalCents: number;
    paidCents: number;
    refundedCents: number;
    status: string;
    dueDate: string;
  },
  paymentCents: number,
): { paidCents: number; balanceCents: number; status: string } {
  if (current.status === "cancelled") {
    throw new ApiError(400, "Cannot record payment on a cancelled document.");
  }
  if (!Number.isInteger(paymentCents) || paymentCents <= 0) {
    throw new ApiError(400, "Payment amount must be greater than zero.");
  }
  const effectivePaid = current.paidCents - current.refundedCents;
  const currentBalance = Math.max(0, current.totalCents - effectivePaid);
  if (currentBalance === 0) {
    throw new ApiError(
      400,
      "This invoice has no remaining outstanding balance.",
    );
  }
  if (paymentCents > currentBalance) {
    throw new ApiError(
      400,
      "Payment amount cannot exceed remaining outstanding balance.",
    );
  }

  const newPaidCents = current.paidCents + paymentCents;
  const newBalanceCents = Math.max(
    0,
    current.totalCents - (newPaidCents - current.refundedCents),
  );
  const status = newBalanceCents === 0 ? "paid" : "partial";

  return {
    paidCents: newPaidCents,
    balanceCents: newBalanceCents,
    status,
  };
}

export function applyRefundToInvoice(
  current: {
    totalCents: number;
    paidCents: number;
    refundedCents: number;
    status: string;
  },
  refundCents: number,
): { refundedCents: number; balanceCents: number; status: string } {
  if (!Number.isInteger(refundCents) || refundCents <= 0) {
    throw new ApiError(400, "Refund amount must be greater than zero.");
  }
  const refundable = current.paidCents - current.refundedCents;
  if (refundable <= 0) {
    throw new ApiError(400, "No paid balance available to refund.");
  }
  if (refundCents > refundable) {
    throw new ApiError(400, "Refund amount cannot exceed net paid amount.");
  }

  const newRefunded = current.refundedCents + refundCents;
  const netPaid = current.paidCents - newRefunded;
  const balanceCents =
    netPaid === 0 ? 0 : Math.max(0, current.totalCents - netPaid);
  const status = netPaid === 0 ? "refunded" : "partial";

  return {
    refundedCents: newRefunded,
    balanceCents,
    status,
  };
}

export interface JurisdictionRule {
  code: string;
  name: string;
  statutoryLabel: string;
  statutoryRateBps: number;
  defaultTaxBps: number;
}

export const PAYROLL_JURISDICTIONS: Record<string, JurisdictionRule> = {
  IN: {
    code: "IN",
    name: "India (EPF / PT / TDS)",
    statutoryLabel: "EPF (12%) & Professional Tax",
    statutoryRateBps: 1200,
    defaultTaxBps: 1000,
  },
  US: {
    code: "US",
    name: "United States (FICA & Federal)",
    statutoryLabel: "FICA (Social Security & Medicare 7.65%)",
    statutoryRateBps: 765,
    defaultTaxBps: 1500,
  },
  GB: {
    code: "GB",
    name: "United Kingdom (NI & PAYE)",
    statutoryLabel: "National Insurance (8%) & PAYE",
    statutoryRateBps: 800,
    defaultTaxBps: 1400,
  },
  SG: {
    code: "SG",
    name: "Singapore (CPF & IRAS)",
    statutoryLabel: "Employee CPF Contribution",
    statutoryRateBps: 2000,
    defaultTaxBps: 700,
  },
  AE: {
    code: "AE",
    name: "UAE (WPS — 0% Income Tax)",
    statutoryLabel: "WPS Standard Processing",
    statutoryRateBps: 0,
    defaultTaxBps: 0,
  },
};

export function calculatePayroll(params: {
  baseSalaryCents: number;
  allowancesCents: number;
  customDeductionsCents: number;
  taxRateBps: number;
  jurisdiction: string;
}): {
  jurisdiction: string;
  statutoryLabel: string;
  grossCents: number;
  statutoryDeductionCents: number;
  taxDeductionCents: number;
  netPayCents: number;
} {
  const rule = PAYROLL_JURISDICTIONS[params.jurisdiction];
  if (!rule)
    throw new ApiError(
      400,
      "Payroll estimates are not configured for this jurisdiction.",
    );
  const grossCents = params.baseSalaryCents + params.allowancesCents;
  const computedStatutory = Math.round(
    (params.baseSalaryCents * rule.statutoryRateBps) / 10000,
  );
  const statutoryDeductionCents =
    computedStatutory + Math.max(0, params.customDeductionsCents);
  const effectiveTaxBps =
    rule.code === "AE" ? 0 : Math.max(0, params.taxRateBps);
  const taxableCents = Math.max(0, grossCents - computedStatutory);
  const taxDeductionCents = Math.round(
    (taxableCents * effectiveTaxBps) / 10000,
  );
  const netPayCents = Math.max(
    0,
    grossCents - statutoryDeductionCents - taxDeductionCents,
  );

  return {
    jurisdiction: rule.code,
    statutoryLabel: rule.statutoryLabel,
    grossCents,
    statutoryDeductionCents,
    taxDeductionCents,
    netPayCents,
  };
}

export function toCents(amountMajor: number): number {
  if (!Number.isFinite(amountMajor)) {
    throw new ApiError(400, "Invalid monetary amount.");
  }
  const [coefficient, exponent = "0"] = String(amountMajor).split("e");
  const cents = Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
  if (!Number.isSafeInteger(cents))
    throw new ApiError(400, "Amount exceeds supported precision.");
  return cents;
}

export function formatMoney(
  cents: number,
  currency = "INR",
  compact = false,
): string {
  const major = (cents || 0) / 100;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  if (compact && Math.abs(major) >= 100000 && currency === "INR") {
    if (Math.abs(major) >= 10000000) {
      return `₹${(major / 10000000).toFixed(2)} Cr`;
    }
    return `₹${(major / 100000).toFixed(2)} L`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}
