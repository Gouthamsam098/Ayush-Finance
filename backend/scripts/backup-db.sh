#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────
# Nightly PostgreSQL backup for Anush LMS.
#
# This is the loan ledger — the money system of record. Without backups a lost
# droplet, a failed disk, or a stray `docker compose down -v` destroys every
# customer, loan and payment permanently.
#
# What it does:
#   1. pg_dump (custom format, compressed) into ./backups
#   2. Verifies the dump is readable (a dump that cannot be listed is not a
#      backup) — pg_restore --list acts as an integrity check
#   3. Prunes dumps older than RETAIN_DAYS
#
# Install (on the droplet, from backend/):
#   chmod +x scripts/backup-db.sh
#   crontab -e
#   # 02:15 IST daily:
#   15 2 * * *  cd /opt/anush-lms/backend && ./scripts/backup-db.sh >> /var/log/anush-backup.log 2>&1
#
# ⚠ A backup that lives only on the same droplet as the database is NOT a
# backup. Copy the dumps off-host — DigitalOcean Spaces, for example:
#   s3cmd put "$OUT" s3://your-space/anush-lms/
# and TEST A RESTORE (see DEPLOYMENT.md) before you rely on any of this.
# ──────────────────────────────────────────────────────────────────────────
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found — run from the backend/ directory." >&2
  exit 1
fi

# POSTGRES_USER / POSTGRES_DB come from the env file (never hardcoded here).
# shellcheck disable=SC1090
. "$ENV_FILE"
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/anush_lms-$STAMP.dump"

echo "[backup] dumping $POSTGRES_DB → $OUT"
# -Fc = custom format: compressed and restorable selectively with pg_restore.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "[backup] FAILED: dump is empty" >&2
  rm -f "$OUT"
  exit 1
fi

# Integrity check: if pg_restore cannot read the table of contents, the file is
# corrupt and must not be counted as a successful backup.
echo "[backup] verifying dump is readable"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      pg_restore --list /dev/stdin < "$OUT" > /dev/null 2>&1; then
  echo "[backup] FAILED: dump did not verify (corrupt) — keeping it for inspection" >&2
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] OK: $OUT ($SIZE)"

echo "[backup] pruning dumps older than $RETAIN_DAYS days"
find "$BACKUP_DIR" -name 'anush_lms-*.dump' -type f -mtime "+$RETAIN_DAYS" -print -delete

echo "[backup] done. REMINDER: copy $BACKUP_DIR off this droplet."
