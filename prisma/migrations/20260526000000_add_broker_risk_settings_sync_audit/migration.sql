-- CreateTable
CREATE TABLE "BrokerRiskSettingsSyncAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "externalAccountId" TEXT,
    "brokerConnectionId" TEXT,
    "broker" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "environment" TEXT,
    "dryRun" BOOLEAN NOT NULL,
    "brokerEnforcementEnabled" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "gateFailureReason" TEXT,
    "skipReason" TEXT,
    "payloadPreviewJson" JSONB,
    "brokerResponseJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerRiskSettingsSyncAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerRiskSettingsSyncAudit_userId_createdAt_idx" ON "BrokerRiskSettingsSyncAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BrokerRiskSettingsSyncAudit_accountId_createdAt_idx" ON "BrokerRiskSettingsSyncAudit"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BrokerRiskSettingsSyncAudit_outcome_createdAt_idx" ON "BrokerRiskSettingsSyncAudit"("outcome", "createdAt");

-- AddForeignKey
ALTER TABLE "BrokerRiskSettingsSyncAudit" ADD CONSTRAINT "BrokerRiskSettingsSyncAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerRiskSettingsSyncAudit" ADD CONSTRAINT "BrokerRiskSettingsSyncAudit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
