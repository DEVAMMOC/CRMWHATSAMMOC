#!/bin/sh
# Diagnostic wrapper: runs the API and keeps container alive on crash
# so logs are readable via Coolify API

echo "=== START-API-DEBUG ==="
echo "Working dir: $(pwd)"
echo "Node version: $(node --version)"
echo "Checking dist file..."
ls -la apps/api/dist/main.js 2>&1 || echo "ERROR: dist/main.js not found!"
echo "Checking types dist..."
ls -la packages/types/dist/index.js 2>&1 || echo "WARNING: types dist not found (may be ok)"
echo "Checking node_modules/@crmwhats/types..."
ls -la node_modules/@crmwhats/types 2>&1 || echo "WARNING: @crmwhats/types symlink not found"
echo "SUPABASE_URL set: $([ -n "$SUPABASE_URL" ] && echo YES || echo NO)"
echo "SUPABASE_SERVICE_ROLE_KEY set: $([ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo YES || echo NO)"
echo "=== STARTING NODE ==="

node apps/api/dist/main.js
EXIT_CODE=$?

echo "=== NODE EXITED with code $EXIT_CODE ==="
echo "Sleeping to allow log collection (30s)..."
sleep 30
echo "=== DONE SLEEPING, exiting ==="
exit $EXIT_CODE
