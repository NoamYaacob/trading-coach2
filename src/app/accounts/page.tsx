import { redirect } from "next/navigation";

// Broker Connections is no longer a standalone user-facing page.
// All account management lives on the Dashboard (add/review/sync)
// and in Settings (disconnect/reconnect).
export default function AccountsPage() {
  redirect("/dashboard");
}
