#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo ".env not found. Copy .env.example to .env and set values."
  exit 1
fi

DOMAIN="$(grep '^DOMAIN=' .env | head -n1 | cut -d'=' -f2-)"

if [[ -z "${DOMAIN}" ]]; then
  echo "DOMAIN is empty in .env"
  exit 1
fi

echo "Checking ONLYOFFICE endpoint..."
curl -fsS "https://${DOMAIN}/web-apps/apps/api/documents/api.js" >/dev/null
echo "OK: https://${DOMAIN}/web-apps/apps/api/documents/api.js"

echo "Checking EasyVault callback endpoint reachability..."
curl -fsS "https://easy-vault.com/api/apps/69970fbb1f1de2b0bede99df/functions/onlyofficeCallback" >/dev/null
echo "OK: callback endpoint reachable"

echo "Container status:"
docker compose ps

