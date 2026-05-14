export async function register() {
  // Only run in the Node.js runtime — not in Edge workers.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logTradovateConfigDiagnostic } = await import("./lib/brokers/tradovate-env");
    logTradovateConfigDiagnostic();
  }
}
