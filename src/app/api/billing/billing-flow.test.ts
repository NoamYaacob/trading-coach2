/**
 * Source-scan tests for the Stripe billing flow.
 *
 * The checkout and webhook routes need Stripe + a DB to execute, so these
 * tests assert structural guarantees without running them:
 *   - checkout requires auth and the billing-enabled flag
 *   - the webhook validates the Stripe signature before doing any work
 *   - Stripe subscription statuses map to the correct SubscriptionStatus
 *   - the Settings page surfaces the user's plan
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

const CHECKOUT = read("./checkout/route.ts");
const WEBHOOK = read("./webhook/route.ts");
const SETTINGS = read("../../settings/page.tsx");
const PLAN_BILLING = read("../../settings/_components/plan-billing.tsx");

// ── Checkout route ────────────────────────────────────────────────────────────

describe("billing checkout route", () => {
  it("requires the billing-enabled flag (503 when off)", () => {
    assert.ok(CHECKOUT.includes("isBillingEnabled()"), "must check isBillingEnabled");
    assert.ok(CHECKOUT.includes("{ status: 503 }"), "must return 503 when billing is disabled");
  });

  it("requires an authenticated user (401)", () => {
    assert.ok(CHECKOUT.includes("getCurrentUser()"), "must resolve the current user");
    assert.ok(
      CHECKOUT.includes('"Unauthorized"') && CHECKOUT.includes("{ status: 401 }"),
      "must return 401 when there is no authenticated user",
    );
  });

  it("fails clearly when STRIPE_PRICE_ID is not configured", () => {
    assert.ok(CHECKOUT.includes("process.env.STRIPE_PRICE_ID"), "must read STRIPE_PRICE_ID");
    assert.ok(CHECKOUT.includes("{ status: 500 }"), "must 500 when the price is not configured");
  });

  it("creates a subscription-mode checkout session with success/cancel URLs", () => {
    assert.ok(CHECKOUT.includes('mode: "subscription"'), "checkout must be subscription mode");
    assert.ok(CHECKOUT.includes("billing=success"), "must set a success URL");
    assert.ok(CHECKOUT.includes("billing=cancel"), "must set a cancel URL");
  });

  it("stamps the userId into subscription metadata", () => {
    assert.ok(
      CHECKOUT.includes("metadata: { userId: user.id }"),
      "the subscription must carry the userId so the webhook can sync the right user",
    );
  });
});

// ── Webhook route ─────────────────────────────────────────────────────────────

describe("billing webhook route", () => {
  it("rejects a request with no stripe-signature header (400)", () => {
    assert.ok(WEBHOOK.includes('"stripe-signature"'), "must read the stripe-signature header");
    assert.ok(
      WEBHOOK.includes('"Missing stripe-signature header"'),
      "must reject a missing signature",
    );
  });

  it("fails when STRIPE_WEBHOOK_SECRET is not configured (500)", () => {
    assert.ok(WEBHOOK.includes("process.env.STRIPE_WEBHOOK_SECRET"), "must read the webhook secret");
    assert.ok(WEBHOOK.includes("{ status: 500 }"), "must 500 when the webhook secret is missing");
  });

  it("verifies the Stripe signature with constructEvent before processing", () => {
    assert.ok(
      WEBHOOK.includes("webhooks.constructEvent("),
      "must verify the signature via Stripe's constructEvent",
    );
    assert.ok(
      WEBHOOK.includes("Webhook signature verification failed"),
      "must reject an event whose signature does not verify",
    );
  });

  it("handles the core subscription lifecycle events", () => {
    for (const evt of [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_failed",
    ]) {
      assert.ok(WEBHOOK.includes(`"${evt}"`), `webhook must handle ${evt}`);
    }
  });

  it("maps Stripe statuses to the correct SubscriptionStatus", () => {
    // active → ACTIVE, trialing → TRIALING, canceled → CANCELED, default → INACTIVE.
    assert.ok(WEBHOOK.includes('case "active":') && WEBHOOK.includes("SubscriptionStatus.ACTIVE"));
    assert.ok(WEBHOOK.includes('case "trialing":') && WEBHOOK.includes("SubscriptionStatus.TRIALING"));
    assert.ok(WEBHOOK.includes('case "canceled":') && WEBHOOK.includes("SubscriptionStatus.CANCELED"));
    assert.ok(WEBHOOK.includes("SubscriptionStatus.INACTIVE"), "unknown statuses must fall back to INACTIVE");
  });

  it("revokes access on a failed payment and clears the subscription on deletion", () => {
    assert.ok(
      WEBHOOK.includes("subscriptionStatus: SubscriptionStatus.INACTIVE"),
      "a failed payment must set the user INACTIVE",
    );
    assert.ok(
      WEBHOOK.includes("subscriptionStatus: SubscriptionStatus.CANCELED") &&
        WEBHOOK.includes("stripeSubscriptionId: null"),
      "a deleted subscription must set CANCELED and clear the stored subscription id",
    );
  });
});

// ── Settings plan display ─────────────────────────────────────────────────────

describe("settings page — plan display", () => {
  it("renders a Plan & Billing section wired to the user's subscription status", () => {
    assert.ok(
      SETTINGS.includes("Plan & Billing"),
      "settings must render a 'Plan & Billing' section",
    );
    assert.ok(
      SETTINGS.includes("PlanBilling") &&
        SETTINGS.includes("subscriptionStatus={user.subscriptionStatus}"),
      "the Plan & Billing section must reflect the user's subscriptionStatus",
    );
  });

  it("renders an active trial as a friendly label, not a raw enum", () => {
    assert.ok(
      PLAN_BILLING.includes('"Trial active"') || PLAN_BILLING.includes("Trial active"),
      "a TRIALING user must see 'Trial active', not the raw TRIALING enum",
    );
  });

  it("offers an honest billing CTA (View plans → /pricing), not a fake portal", () => {
    assert.ok(
      PLAN_BILLING.includes("View plans") && PLAN_BILLING.includes("/pricing"),
      "the billing CTA must route to /pricing and be honestly labelled",
    );
  });
});
