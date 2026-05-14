import "dotenv/config";

import { defineConfig } from "prisma/config";

// prisma generate does not need a real database connection — it only reads the
// schema to produce TypeScript types. Falling back to a dummy URL when
// DATABASE_URL is not set in the build environment (e.g. Railway CI builds
// that run `prisma generate` before runtime secrets are available) keeps the
// generate step working without exposing any credentials.
//
// Commands that DO need a live DB (prisma migrate deploy, prisma db push, etc.)
// will fail fast in the same way they always would if DATABASE_URL is unset.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://localhost/build-placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
