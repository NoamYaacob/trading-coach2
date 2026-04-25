import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { SubscriptionStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function stripeStatusToSubscriptionStatus(
  status: Stripe.Subscription["status"],
): SubscriptionStatus {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INACTIVE;
  }
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: stripeStatusToSubscriptionStatus(subscription.status),
      trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      stripeSubscriptionId: subscription.id,
    },
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscription = await getStripe().subscriptions.retrieve(
          String(session.subscription),
        );
        // Backfill userId into subscription metadata if missing
        if (!subscription.metadata?.userId) {
          const userId =
            session.metadata?.userId ??
            (await prisma.user
              .findFirst({
                where: { stripeCustomerId: String(session.customer) },
                select: { id: true },
              })
              .then((u) => u?.id ?? null));
          if (userId) {
            await getStripe().subscriptions.update(subscription.id, {
              metadata: { userId },
            });
            subscription.metadata = { ...subscription.metadata, userId };
          }
        }
        await syncSubscription(subscription);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionStatus: SubscriptionStatus.CANCELED,
            stripeSubscriptionId: null,
          },
        });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
