#!/bin/sh
# Diagnostic wrapper: runs the API and keeps container alive on crash

echo "=== ENVIRONMENT ==="
echo "PWD: $(pwd)"
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version 2>/dev/null || echo 'not found')"

echo "=== NODE_MODULES TOP LEVEL ==="
ls node_modules/ 2>/dev/null | head -30 || echo "no node_modules at root"

echo "=== PNPM STORE ==="
ls node_modules/.pnpm 2>/dev/null | head -5 || echo "no .pnpm store"

echo "=== @crmwhats SYMLINKS ==="
ls -la node_modules/@crmwhats/ 2>/dev/null || echo "no @crmwhats dir"
ls -la apps/api/node_modules/@crmwhats/ 2>/dev/null || echo "no apps/api/node_modules/@crmwhats"

echo "=== DIST DIRS ==="
find . -path ./node_modules -prune -o -name "dist" -print 2>/dev/null
ls -la apps/api/dist/ 2>/dev/null || echo "apps/api/dist/ MISSING"
ls -la packages/types/dist/ 2>/dev/null || echo "packages/types/dist/ missing"

echo "=== ENV VARS ==="
echo "SUPABASE_URL set: $([ -n "$SUPABASE_URL" ] && echo YES || echo NO)"
echo "SUPABASE_SERVICE_ROLE_KEY set: $([ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo YES || echo NO)"

echo "=== STARTING NODE ==="
node apps/api/dist/main.js
EXIT_CODE=$?

echo "=== NODE EXITED: $EXIT_CODE ==="
sleep 30
exit $EXIT_CODE
