// ── Tradovate connection flow — product decision ──────────────────────────────
//
// Guardrail does not ask users to choose demo/live before OAuth. Tradovate's
// OAuth Registration is associated with a single Client ID that is recognised
// at one specific authorization host; sending users elsewhere (e.g. trader-d)
// produces a "Wrong client_id" error. Tradovate's account model is also
// per-user, not per-OAuth-env: a single user can have live, demo/sim, and
// prop-firm accounts under one login.
//
// The flow is therefore:
//   1. User connects Tradovate once via the OAuth host that recognises our CID.
//   2. After OAuth, Guardrail discovers all accounts returned by /account/list.
//   3. User selects which discovered accounts to add to Guardrail.
//   4. Prop firm / account label remain local metadata applied after selection;
//      account type can also be inferred from each discovered account's
//      Tradovate accountType.
//
// The pre-OAuth "env" form field is currently kept as local metadata (it does
// not drive Tradovate URL routing). Remove it once we are confident the
// detected account type is reliable enough to replace it entirely.
import { Suspense } from "react";
import { ConnectTradovateClient } from "./_components/connect-tradovate-client";

export default function ConnectTradovatePage() {
  return (
    <Suspense>
      <ConnectTradovateClient />
    </Suspense>
  );
}
