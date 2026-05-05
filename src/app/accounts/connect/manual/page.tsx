import { redirect } from "next/navigation";

// Manual account setup has been removed from primary flows.
// Guardrail is a broker-connected product — direct users to Tradovate setup.
export default function ConnectManualPage() {
  redirect("/accounts/connect/tradovate");
}
