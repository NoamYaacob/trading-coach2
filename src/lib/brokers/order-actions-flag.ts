/**
 * Server-side gate for live Tradovate order actions (cancel orders, flatten positions).
 *
 * Default: false — all order actions run in dry-run simulation only.
 * To enable: set ENABLE_TRADOVATE_ORDER_ACTIONS=true in the server environment.
 *
 * This check runs server-side only and cannot be overridden from the frontend.
 * Live order actions require BOTH this flag AND Orders: Full Access permission
 * on the Tradovate OAuth token.
 */
export function isTradovateOrderActionsEnabled(): boolean {
  return process.env.ENABLE_TRADOVATE_ORDER_ACTIONS === "true";
}
