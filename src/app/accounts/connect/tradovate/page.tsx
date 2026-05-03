import { Suspense } from "react";
import { isDemoOAuthConfigured } from "@/lib/brokers/tradovate-env";
import { ConnectTradovateClient } from "./_components/connect-tradovate-client";

export default function ConnectTradovatePage() {
  const demoOAuthConfigured = isDemoOAuthConfigured();
  return (
    <Suspense>
      <ConnectTradovateClient demoOAuthConfigured={demoOAuthConfigured} />
    </Suspense>
  );
}
