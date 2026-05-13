/**
 * Tradovate real-time listener worker — Railway long-running service.
 *
 * Scaffold only. This file is intentionally not wired to production yet.
 * Wire in the next PR after validating listener modules in isolation.
 *
 * Responsibilities:
 *   1. Query all active, full-access BrokerConnections from DB.
 *   2. Start one TradovateUserSyncListener per connection (deduplication
 *      is handled by TradovateListenerManager).
 *   3. On each position/fill/order props event, run decideRealtimeEnforcement()
 *      and write enforcement outcomes to DB.
 *   4. Write DB heartbeat fields (listenerStatus, listenerLastHeartbeatAt, etc.)
 *      on each state change and heartbeat.
 *   5. Re-scan DB every 60 s for new/removed connections.
 *   6. Call manager.closeAll() on SIGTERM for graceful shutdown.
 *
 * Token safety:
 *   - getAccessToken is a closure; the token value is never stored in a
 *     variable that could be serialized, logged, or returned.
 *   - See TradovateListenerManager source-scan tests for enforcement.
 *
 * To run locally (with a real DB):
 *   node --experimental-strip-types scripts/tradovate-listener-worker.ts
 *
 * Railway service config (add to railway.json):
 *   {
 *     "name": "listener-worker",
 *     "startCommand": "node --experimental-strip-types scripts/tradovate-listener-worker.ts",
 *     "buildCommand": "npm run build"
 *   }
 *
 * See docs/TRADOVATE_REALTIME_DEPLOYMENT.md for the full deployment plan.
 */

// ── NOT WIRED YET ─────────────────────────────────────────────────────────────
//
// Uncomment and complete in the next PR. All referenced modules are ready.
//
// import { PrismaClient } from "@prisma/client";
// import WebSocket from "ws";
// import { TradovateListenerManager } from "../src/lib/brokers/tradovate-listener-manager.ts";
// import { decideRealtimeEnforcement, buildEventContextFromPropsEvent } from "../src/lib/brokers/tradovate-realtime-enforcement.ts";
// import { getDecryptedAccessToken } from "../src/lib/brokers/tradovate-token.ts"; // TODO: confirm path
//
// const prisma = new PrismaClient();
// const manager = new TradovateListenerManager((url) => new WebSocket(url));
//
// async function startListenersForAllActiveConnections() {
//   const connections = await prisma.brokerConnection.findMany({
//     where: { status: "active", permissionLevel: "full_access" },
//     include: { connectedAccounts: { include: { riskRules: true } } },
//   });
//
//   for (const conn of connections) {
//     await manager.startListener({
//       connectionId: conn.id,
//       tradovateUserId: conn.tradovateUserId,
//       env: conn.env as "live" | "demo",
//       permissionLevel: conn.permissionLevel as "full_access",
//       getAccessToken: () => getDecryptedAccessToken(conn.id),
//       onPositionEvent: async (connectionId, props) => {
//         // TODO: load positions, call decideRealtimeEnforcement, write DB
//         console.info("[worker] position event", { connectionId, entityType: props.entityType });
//       },
//       onHeartbeat: async (connectionId, at) => {
//         await prisma.brokerConnection.update({
//           where: { id: connectionId },
//           data: { listenerLastHeartbeatAt: at, listenerStatus: "connected" },
//         });
//       },
//     });
//
//     await prisma.brokerConnection.update({
//       where: { id: conn.id },
//       data: { listenerStatus: "connecting", listenerConnectedAt: null },
//     });
//   }
// }
//
// // Periodic re-scan for new/removed connections
// setInterval(startListenersForAllActiveConnections, 60_000);
//
// // Graceful shutdown
// process.on("SIGTERM", () => {
//   console.info("[worker] SIGTERM received, closing all listeners");
//   manager.closeAll();
//   prisma.$disconnect().then(() => process.exit(0));
// });
//
// // Start
// startListenersForAllActiveConnections().catch((err) => {
//   console.error("[worker] fatal startup error", err);
//   process.exit(1);
// });
// ─────────────────────────────────────────────────────────────────────────────

console.info("[tradovate-listener-worker] scaffold — not yet wired to production");
console.info("See docs/TRADOVATE_REALTIME_DEPLOYMENT.md for the deployment plan.");
console.info("Wire in the next PR after validating listener modules in isolation.");
