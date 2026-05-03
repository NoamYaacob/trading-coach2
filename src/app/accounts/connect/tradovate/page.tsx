import { Suspense } from "react";
import { ConnectTradovateClient } from "./_components/connect-tradovate-client";

export default function ConnectTradovatePage() {
  return (
    <Suspense>
      <ConnectTradovateClient />
    </Suspense>
  );
}
