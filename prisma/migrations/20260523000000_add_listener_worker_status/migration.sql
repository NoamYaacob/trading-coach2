-- Singleton table mirroring the Tradovate listener-worker's enforcement env
-- flags so the web Safety Console can verify broker-write safety.
--
-- The web/app and listener-worker run as separate Railway services with
-- independent env configuration. The web runtime cannot read the
-- listener-worker's process.env, so the worker writes its own flag state here
-- on every reconcile loop (~every 60s). `reportedAt` lets readers treat a
-- stale row (stopped worker) as "not exposed" instead of trusting old values.
--
-- Diagnostics only: no broker enforcement behaviour reads this table.

CREATE TABLE "ListenerWorkerStatus" (
    "id" TEXT NOT NULL,
    "brokerEnforcementEnabled" BOOLEAN NOT NULL,
    "listenerLiveEnabled" BOOLEAN NOT NULL,
    "internalLockEnabled" BOOLEAN NOT NULL,
    "dryRunEnabled" BOOLEAN NOT NULL,
    "simulationEnabled" BOOLEAN NOT NULL,
    "demoAccountAllowlist" TEXT[],
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListenerWorkerStatus_pkey" PRIMARY KEY ("id")
);
