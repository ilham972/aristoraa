#!/usr/bin/env bash
set -e
cd /opt/openwa
cp .env.minimal .env
API_KEY=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
{
  echo ""
  echo "# Production overrides"
  echo "NODE_ENV=production"
  echo "API_MASTER_KEY=$API_KEY"
  echo "WEBHOOK_SECRET_PLACEHOLDER=$WEBHOOK_SECRET"
  echo "DASHBOARD_ENABLED=true"
  echo "PROXY_ENABLED=true"
} >> .env
sed -i "s|'127.0.0.1:\${DASHBOARD_PORT:-2886}:80'|'0.0.0.0:\${DASHBOARD_PORT:-2886}:80'|" docker-compose.yml
sed -i "s|'127.0.0.1:\${API_PORT:-2785}:2785'|'0.0.0.0:\${API_PORT:-2785}:2785'|" docker-compose.yml
echo "=== API_MASTER_KEY ==="
echo "$API_KEY"
echo "=== WEBHOOK_SECRET ==="
echo "$WEBHOOK_SECRET"
echo "=== port bindings ==="
grep -n "0.0.0.0" docker-compose.yml
