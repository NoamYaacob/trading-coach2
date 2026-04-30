/**
 * Tradovate OAuth callback — canonical path.
 *
 * TRADOVATE_REDIRECT_URI points here:
 *   https://guardrail-trade.com/api/brokers/tradovate/callback
 *
 * The implementation lives in /api/auth/tradovate/callback so OAuth logic
 * stays under the /auth/ namespace. This file re-exports the handler so
 * Next.js can route incoming Tradovate redirects here without duplicating
 * any logic.
 */
export { GET } from "@/app/api/auth/tradovate/callback/route";
