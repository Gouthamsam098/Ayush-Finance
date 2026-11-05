#!/bin/sh
# Container startup: make the backend self-provisioning so it runs with a
# single `docker compose up`. Generates JWT keys on first boot, seeds the
# bootstrap admin (idempotent), then starts the API server which applies DB
# migrations itself.
set -e

# Run everything below as the unprivileged `app` user. When started as root
# (the default), first make the key directory app-owned — keys a previous,
# root-run image wrote there must stay readable — then drop privileges.
AS_APP=""
if [ "$(id -u)" = "0" ]; then
  KEY_DIR="$(dirname "${JWT_PRIVATE_KEY_PATH:-/app/secrets/jwt_private.pem}")"
  mkdir -p "$KEY_DIR"
  chown -R app:app "$KEY_DIR"
  AS_APP="su-exec app"
fi

echo "[entrypoint] generating JWT keys if missing…"
if [ ! -f "$JWT_PRIVATE_KEY_PATH" ] || [ ! -f "$JWT_PUBLIC_KEY_PATH" ]; then
  $AS_APP /app/genkeys
else
  echo "[entrypoint] keys already present, skipping"
fi

# Create the admin only when credentials are provided and the account does not
# exist yet (--if-missing): restarting must never reset a password the admin
# changed in the app. To reset it deliberately: docker compose exec backend /app/seedadmin
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] && [ -n "$ADMIN_FULL_NAME" ]; then
  echo "[entrypoint] ensuring admin user ($ADMIN_EMAIL) exists…"
  $AS_APP /app/seedadmin --if-missing || echo "[entrypoint] seedadmin failed (continuing)"
else
  echo "[entrypoint] ADMIN_* not set, skipping admin seed"
fi

echo "[entrypoint] starting server…"
exec $AS_APP /app/server
