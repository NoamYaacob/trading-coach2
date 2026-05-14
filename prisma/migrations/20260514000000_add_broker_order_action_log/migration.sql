-- CreateTable
CREATE TABLE "BrokerOrderActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "actionType" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "requestSummary" JSONB,
    "responseSummary" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerOrderActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerOrderActionLog_connectedAccountId_createdAt_idx" ON "BrokerOrderActionLog"("connectedAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "BrokerOrderActionLog_userId_createdAt_idx" ON "BrokerOrderActionLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BrokerOrderActionLog" ADD CONSTRAINT "BrokerOrderActionLog_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
