import { NextResponse } from "next/server";
import { ApiError, handleApiError } from "@/lib/auth";
import { readBytes } from "@/lib/http";
import { reconcileBilling, stripeTest } from "@/lib/billing";
export async function POST(request: Request) {
  try {
    const stripe = stripeTest();
    const bytes = await readBytes(request, 512 * 1024);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        bytes,
        request.headers.get("stripe-signature") || "",
        process.env.STRIPE_WEBHOOK_SECRET!,
        300,
      );
    } catch {
      throw new ApiError(400, "Invalid webhook signature.");
    }
    await reconcileBilling(stripe, event);
    return NextResponse.json({ received: true });
  } catch (err) {
    return handleApiError(err);
  }
}
