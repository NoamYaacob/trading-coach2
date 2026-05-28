/**
 * Pure helper that maps the host's environment variables into the public
 * version-info payload returned by `GET /api/version`.
 *
 * Kept separate from the route so it can be unit-tested without spinning up
 * Next's runtime.  Only a fixed allowlist of variables is consulted — never
 * the full `process.env` — so a typo or accidental key cannot leak.
 */

export type VersionInfo = {
  ok: true;
  commit: string;
  branch: string;
  environment: string;
  deployedAt: string;
};

/** Pick the first non-empty value from a list of candidates, else "unknown". */
function pick(env: NodeJS.ProcessEnv, keys: readonly string[]): string {
  for (const k of keys) {
    const v = env[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "unknown";
}

/**
 * Build the version-info payload.  Pure — takes the env explicitly so tests
 * don't have to mutate process.env globals.
 */
export function buildVersionInfo(env: NodeJS.ProcessEnv): VersionInfo {
  return {
    ok: true,
    commit: pick(env, ["RAILWAY_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT_SHA"]),
    branch: pick(env, ["RAILWAY_GIT_BRANCH", "VERCEL_GIT_COMMIT_REF", "GIT_BRANCH"]),
    environment: pick(env, ["RAILWAY_ENVIRONMENT_NAME", "VERCEL_ENV", "NODE_ENV"]),
    deployedAt: pick(env, ["RAILWAY_DEPLOYMENT_CREATED_AT", "VERCEL_DEPLOYMENT_CREATED_AT", "DEPLOYED_AT"]),
  };
}
