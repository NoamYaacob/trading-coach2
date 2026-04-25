-- =============================================================================
-- Prisma Baseline Migration (20260424000000_init)
-- =============================================================================
-- This represents the full database schema as it existed in production before
-- Stripe billing fields were added.
--
-- EXISTING PRODUCTION DATABASES:
--   This file is NEVER EXECUTED. The startup script marks it as applied via
--   `prisma migrate resolve --applied 20260424000000_init`, which creates the
--   _prisma_migrations tracking table and records this migration as done —
--   without running any of the SQL below.
--
-- FRESH DATABASES (new environments, staging, CI):
--   `prisma migrate deploy` executes this file first, creating all tables,
--   then applies 20260425000000_add_stripe_fields on top.
-- =============================================================================

-- Enums

CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'INACTIVE', 'CANCELED');
CREATE TYPE "TraderCurrentState" AS ENUM ('NONE', 'FOMO', 'REVENGE', 'TILTED', 'CONFUSED', 'PREMARKET_READY', 'JUST_TOOK_LOSS', 'JUST_TOOK_TWO_LOSSES', 'RESETTING', 'CALM');
CREATE TYPE "GuardianConnectionStatus" AS ENUM ('NOT_CONNECTED', 'MOCK_CONNECTED');
CREATE TYPE "GuardianLockoutReason" AS ENUM ('NONE', 'MAX_TRADES_PER_DAY', 'MAX_DAILY_LOSS', 'CONSECUTIVE_LOSSES', 'DAILY_PROFIT_TARGET');
CREATE TYPE "GuardianResetMode" AS ENUM ('DAILY', 'MANUAL');
CREATE TYPE "TradingPlatform" AS ENUM ('tradovate', 'tradingview', 'manual');
CREATE TYPE "AccountType" AS ENUM ('evaluation', 'funded', 'personal', 'demo');
CREATE TYPE "AccountRiskState" AS ENUM ('NORMAL', 'WARNING', 'STOPPED');

-- User

CREATE TABLE "User" (
    "id"                 TEXT                 NOT NULL,
    "email"              TEXT                 NOT NULL,
    "passwordHash"       TEXT,
    "role"               "UserRole"           NOT NULL DEFAULT 'USER',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialStartedAt"     TIMESTAMP(3),
    "trialEndsAt"        TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Session

CREATE TABLE "Session" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "tokenHash" TEXT         NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- TelegramConnection

CREATE TABLE "TelegramConnection" (
    "id"               TEXT         NOT NULL,
    "userId"           TEXT         NOT NULL,
    "telegramUserId"   TEXT         NOT NULL,
    "telegramUsername" TEXT,
    "telegramChatId"   TEXT,
    "connectedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWebhookAt"    TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramConnection_userId_key"         ON "TelegramConnection"("userId");
CREATE UNIQUE INDEX "TelegramConnection_telegramUserId_key" ON "TelegramConnection"("telegramUserId");
CREATE INDEX        "TelegramConnection_telegramChatId_idx" ON "TelegramConnection"("telegramChatId");

-- TelegramLinkToken

CREATE TABLE "TelegramLinkToken" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "token"     TEXT         NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLinkToken_token_key"           ON "TelegramLinkToken"("token");
CREATE INDEX        "TelegramLinkToken_userId_expiresAt_idx" ON "TelegramLinkToken"("userId", "expiresAt");

-- TraderProfile

CREATE TABLE "TraderProfile" (
    "id"                TEXT         NOT NULL,
    "userId"            TEXT         NOT NULL,
    "tradingExperience" TEXT,
    "primaryMarket"     TEXT,
    "tradingStyle"      TEXT,
    "experienceYears"   INTEGER,
    "tradingDays"       TEXT,
    "tradingSession"    TEXT,
    "preferredSession"  TEXT,
    "timezone"          TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraderProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TraderProfile_userId_key" ON "TraderProfile"("userId");

-- RiskRules

CREATE TABLE "RiskRules" (
    "id"              TEXT          NOT NULL,
    "userId"          TEXT          NOT NULL,
    "accountSize"     DECIMAL(12,2),
    "maxDailyLoss"    DECIMAL(10,2),
    "riskPerTrade"    DECIMAL(10,2),
    "maxRiskPerTrade" DECIMAL(10,2),
    "maxTradesPerDay" INTEGER,
    "stopAfterLosses" INTEGER,
    "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "RiskRules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskRules_userId_key" ON "RiskRules"("userId");

-- MentalProfile

CREATE TABLE "MentalProfile" (
    "id"                     TEXT         NOT NULL,
    "userId"                 TEXT         NOT NULL,
    "primaryChallenge"       TEXT,
    "tiltTrigger"            TEXT,
    "tiltThought"            TEXT,
    "coachingTone"           TEXT,
    "interruptionStyle"      TEXT,
    "responseStyle"          TEXT,
    "tiltTriggers"           TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "confidenceNotes"        TEXT,
    "tradingWhy"             TEXT,
    "tradingGoal"            TEXT,
    "groundingReminder"      TEXT,
    "preferredAddress"       TEXT,
    "disciplineBreakPattern" TEXT,
    "whatHelpsRefocus"       TEXT,
    "reminderAnchors"        TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentalProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MentalProfile_userId_key" ON "MentalProfile"("userId");

-- CoachingPreferences

CREATE TABLE "CoachingPreferences" (
    "id"                                 TEXT         NOT NULL,
    "userId"                             TEXT         NOT NULL,
    "coachingTone"                       TEXT,
    "checkInFrequency"                   TEXT,
    "remindersEnabled"                   BOOLEAN      NOT NULL DEFAULT true,
    "reflectionStyle"                    TEXT,
    "premarketCheckinEnabled"            BOOLEAN      NOT NULL DEFAULT false,
    "postmarketReviewEnabled"            BOOLEAN      NOT NULL DEFAULT false,
    "checkinFormat"                      TEXT,
    "reviewFocus"                        TEXT,
    "newsAlertsEnabled"                  BOOLEAN      NOT NULL DEFAULT false,
    "preNewsMinutes"                     INTEGER,
    "highImpactOnly"                     BOOLEAN      NOT NULL DEFAULT false,
    "economicCalendarProviderKey"        TEXT         DEFAULT 'mock',
    "economicCalendarStubScenario"       TEXT         DEFAULT 'mixed_day',
    "preferredLanguage"                  TEXT         DEFAULT 'he',
    "wantsMidSessionCheckIns"            BOOLEAN      NOT NULL DEFAULT false,
    "wantsGoalReminders"                 BOOLEAN      NOT NULL DEFAULT true,
    "wantsToughInterventionWhenTilting"  BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"                          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingPreferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachingPreferences_userId_key" ON "CoachingPreferences"("userId");

-- TraderState

CREATE TABLE "TraderState" (
    "id"               TEXT                 NOT NULL,
    "userId"           TEXT                 NOT NULL,
    "currentState"     "TraderCurrentState" NOT NULL DEFAULT 'NONE',
    "stateNotes"       TEXT,
    "recentLossStreak" INTEGER              DEFAULT 0,
    "needsCooldown"    BOOLEAN              NOT NULL DEFAULT false,
    "cooldownUntil"    TIMESTAMP(3),
    "lastStateAt"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "TraderState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TraderState_userId_key"                        ON "TraderState"("userId");
CREATE INDEX        "TraderState_currentState_lastStateAt_idx"      ON "TraderState"("currentState", "lastStateAt");
CREATE INDEX        "TraderState_needsCooldown_cooldownUntil_idx"   ON "TraderState"("needsCooldown", "cooldownUntil");

-- DailySessionEvent

CREATE TABLE "DailySessionEvent" (
    "id"             TEXT                 NOT NULL,
    "userId"         TEXT                 NOT NULL,
    "eventType"      TEXT                 NOT NULL,
    "source"         TEXT                 NOT NULL,
    "message"        TEXT                 NOT NULL,
    "detectedIntent" TEXT,
    "coachMode"      TEXT,
    "traderState"    "TraderCurrentState" NOT NULL DEFAULT 'NONE',
    "cooldownActive" BOOLEAN              NOT NULL DEFAULT false,
    "metadataJson"   JSONB,
    "createdAt"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailySessionEvent_userId_createdAt_idx"               ON "DailySessionEvent"("userId", "createdAt");
CREATE INDEX "DailySessionEvent_userId_traderState_createdAt_idx"   ON "DailySessionEvent"("userId", "traderState", "createdAt");

-- DailyGuardianSession

CREATE TABLE "DailyGuardianSession" (
    "id"             TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "sessionDateKey" TEXT         NOT NULL,
    "source"         TEXT         NOT NULL,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"        TIMESTAMP(3),
    "endedSource"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyGuardianSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyGuardianSession_userId_sessionDateKey_key" ON "DailyGuardianSession"("userId", "sessionDateKey");
CREATE INDEX        "DailyGuardianSession_userId_startedAt_idx"      ON "DailyGuardianSession"("userId", "startedAt");

-- GuardianProfile

CREATE TABLE "GuardianProfile" (
    "id"                         TEXT                      NOT NULL,
    "userId"                     TEXT                      NOT NULL,
    "guardianEnabled"            BOOLEAN                   NOT NULL DEFAULT true,
    "adapterKey"                 TEXT                      NOT NULL DEFAULT 'mock',
    "platformName"               TEXT                      DEFAULT 'Mock Platform',
    "connectionStatus"           "GuardianConnectionStatus" NOT NULL DEFAULT 'MOCK_CONNECTED',
    "maxTradesPerDay"            INTEGER,
    "maxDailyLoss"               DECIMAL(10,2),
    "stopAfterConsecutiveLosses" INTEGER,
    "dailyProfitTarget"          DECIMAL(10,2),
    "copyTradeMode"              BOOLEAN                   NOT NULL DEFAULT false,
    "resetMode"                  "GuardianResetMode"       NOT NULL DEFAULT 'DAILY',
    "dailyResetHour"             INTEGER                   NOT NULL DEFAULT 9,
    "dailyResetTimezone"         TEXT                      NOT NULL DEFAULT 'UTC',
    "createdAt"                  TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3)              NOT NULL,

    CONSTRAINT "GuardianProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuardianProfile_userId_key" ON "GuardianProfile"("userId");

-- GuardianStatus

CREATE TABLE "GuardianStatus" (
    "id"                   TEXT                    NOT NULL,
    "userId"               TEXT                    NOT NULL,
    "todayTradesCount"     INTEGER                 NOT NULL DEFAULT 0,
    "todayPnL"             DECIMAL(10,2)           NOT NULL DEFAULT 0,
    "consecutiveLosses"    INTEGER                 NOT NULL DEFAULT 0,
    "currentLockoutActive" BOOLEAN                 NOT NULL DEFAULT false,
    "lockoutReason"        "GuardianLockoutReason" NOT NULL DEFAULT 'NONE',
    "lockoutStartedAt"     TIMESTAMP(3),
    "lockoutEndsAt"        TIMESTAMP(3),
    "nextAllowedResetAt"   TIMESTAMP(3),
    "lastResetAt"          TIMESTAMP(3),
    "lockoutClearedAt"     TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "GuardianStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuardianStatus_userId_key"                               ON "GuardianStatus"("userId");
CREATE INDEX        "GuardianStatus_currentLockoutActive_lockoutReason_idx"   ON "GuardianStatus"("currentLockoutActive", "lockoutReason");

-- ConnectedAccount

CREATE TABLE "ConnectedAccount" (
    "id"                TEXT              NOT NULL,
    "userId"            TEXT              NOT NULL,
    "label"             TEXT              NOT NULL,
    "externalAccountId" TEXT,
    "platform"          "TradingPlatform" NOT NULL DEFAULT 'manual',
    "propFirm"          TEXT,
    "accountType"       "AccountType"     NOT NULL DEFAULT 'personal',
    "currency"          TEXT              NOT NULL DEFAULT 'USD',
    "isActive"          BOOLEAN           NOT NULL DEFAULT true,
    "connectionStatus"  TEXT              NOT NULL DEFAULT 'not_connected',
    "brokerUserId"      TEXT,
    "connectedAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectedAccount_userId_externalAccountId_platform_key" ON "ConnectedAccount"("userId", "externalAccountId", "platform");
CREATE INDEX        "ConnectedAccount_userId_isActive_idx"                    ON "ConnectedAccount"("userId", "isActive");

-- AccountRiskRules

CREATE TABLE "AccountRiskRules" (
    "id"               TEXT          NOT NULL,
    "accountId"        TEXT          NOT NULL,
    "maxDailyLoss"     DECIMAL(10,2),
    "riskPerTrade"     DECIMAL(10,2),
    "maxTradesPerDay"  INTEGER,
    "stopAfterLosses"  INTEGER,
    "allowedStartHour" INTEGER,
    "allowedEndHour"   INTEGER,
    "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "AccountRiskRules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountRiskRules_accountId_key" ON "AccountRiskRules"("accountId");

-- LiveSessionState

CREATE TABLE "LiveSessionState" (
    "id"                TEXT              NOT NULL,
    "accountId"         TEXT              NOT NULL,
    "sessionDate"       TEXT              NOT NULL,
    "dailyPnl"          DECIMAL(10,2)     NOT NULL DEFAULT 0,
    "tradesCount"       INTEGER           NOT NULL DEFAULT 0,
    "consecutiveLosses" INTEGER           NOT NULL DEFAULT 0,
    "lastTradeAt"       TIMESTAMP(3),
    "cooldownActive"    BOOLEAN           NOT NULL DEFAULT false,
    "cooldownUntil"     TIMESTAMP(3),
    "riskState"         "AccountRiskState" NOT NULL DEFAULT 'NORMAL',
    "createdAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "LiveSessionState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveSessionState_accountId_key" ON "LiveSessionState"("accountId");

-- NormalizedTradeEvent

CREATE TABLE "NormalizedTradeEvent" (
    "id"              TEXT          NOT NULL,
    "accountId"       TEXT          NOT NULL,
    "eventType"       TEXT          NOT NULL,
    "externalTradeId" TEXT,
    "side"            TEXT,
    "quantity"        DECIMAL(10,4),
    "price"           DECIMAL(12,4),
    "pnl"             DECIMAL(10,2),
    "rawPayload"      JSONB,
    "occurredAt"      TIMESTAMP(3)  NOT NULL,
    "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedTradeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NormalizedTradeEvent_accountId_occurredAt_idx"              ON "NormalizedTradeEvent"("accountId", "occurredAt");
CREATE INDEX "NormalizedTradeEvent_accountId_eventType_occurredAt_idx"    ON "NormalizedTradeEvent"("accountId", "eventType", "occurredAt");

-- GuardianIntervention

CREATE TABLE "GuardianIntervention" (
    "id"          TEXT         NOT NULL,
    "accountId"   TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "triggerType" TEXT         NOT NULL,
    "outcome"     TEXT         NOT NULL,
    "message"     TEXT,
    "sentAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianIntervention_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuardianIntervention_accountId_createdAt_idx" ON "GuardianIntervention"("accountId", "createdAt");
CREATE INDEX "GuardianIntervention_userId_createdAt_idx"    ON "GuardianIntervention"("userId", "createdAt");

-- OAuthConnection

CREATE TABLE "OAuthConnection" (
    "id"                TEXT         NOT NULL,
    "userId"            TEXT         NOT NULL,
    "provider"          TEXT         NOT NULL,
    "providerAccountId" TEXT         NOT NULL,
    "email"             TEXT,
    "displayName"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthConnection_provider_providerAccountId_key" ON "OAuthConnection"("provider", "providerAccountId");
CREATE INDEX        "OAuthConnection_userId_provider_idx"             ON "OAuthConnection"("userId", "provider");

-- Foreign Keys (declared after all tables to avoid ordering issues)

ALTER TABLE "Session"
    ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramConnection"
    ADD CONSTRAINT "TelegramConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramLinkToken"
    ADD CONSTRAINT "TelegramLinkToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TraderProfile"
    ADD CONSTRAINT "TraderProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiskRules"
    ADD CONSTRAINT "RiskRules_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MentalProfile"
    ADD CONSTRAINT "MentalProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingPreferences"
    ADD CONSTRAINT "CoachingPreferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TraderState"
    ADD CONSTRAINT "TraderState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailySessionEvent"
    ADD CONSTRAINT "DailySessionEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyGuardianSession"
    ADD CONSTRAINT "DailyGuardianSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianProfile"
    ADD CONSTRAINT "GuardianProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianStatus"
    ADD CONSTRAINT "GuardianStatus_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectedAccount"
    ADD CONSTRAINT "ConnectedAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountRiskRules"
    ADD CONSTRAINT "AccountRiskRules_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveSessionState"
    ADD CONSTRAINT "LiveSessionState_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NormalizedTradeEvent"
    ADD CONSTRAINT "NormalizedTradeEvent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianIntervention"
    ADD CONSTRAINT "GuardianIntervention_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthConnection"
    ADD CONSTRAINT "OAuthConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
