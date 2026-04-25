import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getOrCreateStripeCustomer, getStripe } from "@/lib/stripe";
import { isBillingEnabled } from "@/lib/subscription";

export async function POST() {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Billing is not enabled yet" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price not configured" }, { status: 500 });
  }

  const customerId = await getOrCreateStripeCustomer(user.id, user.email);

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?billing=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?billing=cancel`,
    subscription_data: {
      metadata: { userId: user.id },
    },
  });

  return NextResponse.json({ url: session.url });
}
