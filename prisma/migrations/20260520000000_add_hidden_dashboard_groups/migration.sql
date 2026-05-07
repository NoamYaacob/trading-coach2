-- HiddenDashboardGroup: per-user list of dashboard group IDs hidden from the
-- main account list. UI-only; does not affect any account/sync/enforcement data.

CREATE TABLE "HiddenDashboardGroup" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "groupId"   TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenDashboardGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HiddenDashboardGroup_userId_groupId_key"
    ON "HiddenDashboardGroup"("userId", "groupId");

CREATE INDEX "HiddenDashboardGroup_userId_idx"
    ON "HiddenDashboardGroup"("userId");

ALTER TABLE "HiddenDashboardGroup"
    ADD CONSTRAINT "HiddenDashboardGroup_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
