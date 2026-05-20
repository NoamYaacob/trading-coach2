CREATE TABLE "RuleChangeAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "scope" TEXT NOT NULL,
    "oldValuesJson" JSONB,
    "newValuesJson" JSONB NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "blockReason" TEXT,
    "sessionRiskState" TEXT,
    "listenerFreshAt" TIMESTAMP(3),
    "hasOpenPosition" BOOLEAN,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleChangeAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuleChangeAudit_userId_createdAt_idx" ON "RuleChangeAudit"("userId", "createdAt");
CREATE INDEX "RuleChangeAudit_accountId_createdAt_idx" ON "RuleChangeAudit"("accountId", "createdAt");
CREATE INDEX "RuleChangeAudit_allowed_createdAt_idx" ON "RuleChangeAudit"("allowed", "createdAt");

ALTER TABLE "RuleChangeAudit" ADD CONSTRAINT "RuleChangeAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleChangeAudit" ADD CONSTRAINT "RuleChangeAudit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
