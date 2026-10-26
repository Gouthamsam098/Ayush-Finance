#!/bin/sh
# Container startup: make the backend self-provisioning so it runs with a
# single `docker compose up`. Generates JWT keys on first boot, seeds the
# bootstrap admin (idempotent), then starts the API server which applies DB
# migrations itself.
set -e

echo "[entrypoint] generating JWT keys if missing…"
if [ ! -f "$JWT_PRIVATE_KEY_PATH" ] || [ ! -f "$JWT_PUBLIC_KEY_PATH" ]; then
  /app/genkeys
else
  echo "[entrypoint] keys already present, skipping"
fi

# Create the admin only when credentials are provided and the account does not
# exist yet (--if-missing): restarting must never reset a password the admin
# changed in the app. To reset it deliberately: docker compose exec backend /app/seedadmin
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] && [ -n "$ADMIN_FULL_NAME" ]; then
  echo "[entrypoint] ensuring admin user ($ADMIN_EMAIL) exists…"
  /app/seedadmin --if-missing || echo "[entrypoint] seedadmin failed (continuing)"
else
  echo "[entrypoint] ADMIN_* not set, skipping admin seed"
fi

echo "[entrypoint] starting server…"
exec /app/server
