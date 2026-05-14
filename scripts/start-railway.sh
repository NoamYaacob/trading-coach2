#!/bin/sh
set -e

echo "=== Baselining Prisma migration history (safe no-op if already applied) ==="
npx prisma migrate resolve --applied 20260424000000_init || true

echo "=== Applying pending migrations ==="
npx prisma migrate deploy

echo "=== Starting Next.js on port ${PORT:-3000} ==="
exec npx next start -p "${PORT:-3000}"
