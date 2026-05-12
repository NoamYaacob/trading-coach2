import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");

const webConfig = JSON.parse(readFileSync(join(root, "railway.json"), "utf8"));
const cronConfig = JSON.parse(
  readFileSync(join(root, "railway-cron-config", "railway.json"), "utf8"),
);

describe("railway.json — web service config", () => {
  it("web service startCommand is npm run start:railway", () => {
    assert.equal(webConfig.deploy?.startCommand, "npm run start:railway");
  });

  it("web service has healthcheckPath /api/health", () => {
    assert.equal(webConfig.deploy?.healthcheckPath, "/api/health");
  });

  it("web service has healthcheckTimeout set", () => {
    assert.ok(
      typeof webConfig.deploy?.healthcheckTimeout === "number",
      "healthcheckTimeout should be a number",
    );
  });

  it("web service buildCommand is npm run build", () => {
    assert.equal(webConfig.build?.buildCommand, "npm run build");
  });

  it("web service does NOT use the cron start command", () => {
    assert.notEqual(
      webConfig.deploy?.startCommand,
      "node scripts/cron-renew-tradovate-tokens.mjs",
    );
  });
});

describe("railway-cron-config/railway.json — cron service config", () => {
  it("cron service startCommand is node scripts/cron-renew-tradovate-tokens.mjs", () => {
    assert.equal(
      cronConfig.deploy?.startCommand,
      "node scripts/cron-renew-tradovate-tokens.mjs",
    );
  });

  it("cron service has cronSchedule */10 * * * *", () => {
    assert.equal(cronConfig.deploy?.cronSchedule, "*/10 * * * *");
  });

  it("cron service does NOT have a healthcheckPath", () => {
    assert.ok(
      !cronConfig.deploy?.healthcheckPath,
      "cron service should not declare a healthcheckPath",
    );
  });

  it("cron service buildCommand is npm run build", () => {
    assert.equal(cronConfig.build?.buildCommand, "npm run build");
  });

  it("cron service does NOT use npm run start:railway", () => {
    assert.notEqual(cronConfig.deploy?.startCommand, "npm run start:railway");
  });

  it("cron script file exists", () => {
    const scriptSource = readFileSync(
      join(root, "scripts", "cron-renew-tradovate-tokens.mjs"),
      "utf8",
    );
    assert.ok(scriptSource.length > 0, "cron script should be non-empty");
  });
});

describe("service isolation", () => {
  it("web and cron services have different startCommands", () => {
    assert.notEqual(
      webConfig.deploy?.startCommand,
      cronConfig.deploy?.startCommand,
    );
  });

  it("only cron service has cronSchedule", () => {
    assert.ok(!webConfig.deploy?.cronSchedule, "web service should not have cronSchedule");
    assert.ok(cronConfig.deploy?.cronSchedule, "cron service should have cronSchedule");
  });
});
