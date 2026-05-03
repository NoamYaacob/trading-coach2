-- Migration: add_broker_connection_models
-- Adds BrokerConnection (shared token store) and PendingBrokerSetup
-- (short-lived OAuth flow state) and links ConnectedAccount to
-- BrokerConnection via a nullable FK.
--
-- SAFETY:
--   All new columns are nullable with no NOT NULL constraints.
--   Existing ConnectedAccount rows are untouched — brokerConnectionId
--   stays NULL for legacy rows and those rows continue to work via the
--   per-account token columns that already exist.

-- ── BrokerConnection ──────────────────────────────────────────────────────────
-- Holds one encrypted OAuth token set per broker authorization.
-- Multiple ConnectedAccount rows reference a single BrokerConnection so
-- tokens are not duplicated across accounts imported from one OAuth grant.

CREATE TABLE IF NOT EXISTS "BrokerConnection" (
    "id"                    TEXT         NOT NULL,
    "userId"                TEXT         NOT NULL,
    "platform"              "TradingPlatform" NOT NULL,
    "env"                   TEXT         NOT NULL,
    "brokerUserId"          TEXT,
    "connectionStatus"      TEXT         NOT NULL DEFAULT 'connected_readonly',
    "accessTokenEncrypted"  TEXT         NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt"        TIMESTAMP(3),
    "errorMessage"          TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'BrokerConnection_userId_fkey'
          AND table_name = 'BrokerConnection'
    ) THEN
        ALTER TABLE "BrokerConnection"
            ADD CONSTRAINT "BrokerConnection_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BrokerConnection_userId_platform_idx"
    ON "BrokerConnection"("userId", "platform");

-- ── PendingBrokerSetup ────────────────────────────────────────────────────────
-- Short-lived record (15-min TTL) that carries pre-OAuth form data and,
-- after the OAuth callback, the broker's discovered accounts JSON.
-- Cleaned up on finalize or left for TTL-based sweep.

CREATE TABLE IF NOT EXISTS "PendingBrokerSetup" (
    "id"                     TEXT         NOT NULL,
    "userId"                 TEXT         NOT NULL,
    "platform"               TEXT         NOT NULL DEFAULT 'tradovate',
    "env"                    TEXT         NOT NULL,
    "displayName"            TEXT,
    "accountSource"          TEXT         NOT NULL,
    "propFirmName"           TEXT,
    "brokerConnectionId"     TEXT,
    "discoveredAccountsJson" JSONB,
    "expiresAt"              TIMESTAMP(3) NOT NULL,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingBrokerSetup_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'PendingBrokerSetup_userId_fkey'
          AND table_name = 'PendingBrokerSetup'
    ) THEN
        ALTER TABLE "PendingBrokerSetup"
            ADD CONSTRAINT "PendingBrokerSetup_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'PendingBrokerSetup_brokerConnectionId_fkey'
          AND table_name = 'PendingBrokerSetup'
    ) THEN
        ALTER TABLE "PendingBrokerSetup"
            ADD CONSTRAINT "PendingBrokerSetup_brokerConnectionId_fkey"
            FOREIGN KEY ("brokerConnectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PendingBrokerSetup_userId_expiresAt_idx"
    ON "PendingBrokerSetup"("userId", "expiresAt");

-- ── ConnectedAccount.brokerConnectionId ──────────────────────────────────────
-- Nullable FK — NULL for all legacy rows; set only for accounts imported
-- via the multi-account OAuth flow. Legacy token columns remain in place.

ALTER TABLE "ConnectedAccount"
    ADD COLUMN IF NOT EXISTS "brokerConnectionId" TEXT;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ConnectedAccount_brokerConnectionId_fkey'
          AND table_name = 'ConnectedAccount'
    ) THEN
        ALTER TABLE "ConnectedAccount"
            ADD CONSTRAINT "ConnectedAccount_brokerConnectionId_fkey"
            FOREIGN KEY ("brokerConnectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL;
    END IF;
END $$;
