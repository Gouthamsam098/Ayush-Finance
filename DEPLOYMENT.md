# Anush LMS — Production Deployment (DigitalOcean)

Target: a single Ubuntu LTS droplet running the full stack behind Caddy (TLS),
sized for ~10–15 concurrent users. Deliberately simple — no Kubernetes, no
microservices. Everything below is derived from the production readiness audit.

```
Internet
  │  :80 / :443 only
  ▼
Caddy ── TLS termination, HTTP→HTTPS, HSTS
  ├── /api/*  →  backend  (Go API :4000)   internal network only
  └── /*      →  web      (nginx :8080, static SPA)
                     backend → postgres    internal network only, NO host port
```

---

## ⚠ Read first: outstanding risks

These are **known, unfixed** items from the audit. Decide consciously before
handling real customer money.

| Risk | Status | Impact |
|---|---|---|
| **Documents stored in Postgres** | `bytea` rows, no object storage | DB and every backup grow with file volume |
| **Single-replica rate limiting** | The login limiter is in-process (`internal/httpx/ratelimit.go`) | Counters reset on restart, and the limit is per replica — needs a shared store before scaling out |
| **Audit trail covers payments only** | `POST /collections` writes `audit_log`; loan/customer/document mutations do not yet | A deleted loan or a KYC download still leaves no trail |
| **Nothing has been deployed yet** | The prod compose, Caddy TLS, nginx image and backup script are written but have **never been executed** | Expect first-run issues; TLS, backup **and restore** must be proven before real data |
| **Existing rows keep old money figures** | The rounding fix applies to new writes only | A live loan's stored interest may sit ₹1 below what the UI computes until re-saved |

Fixed since the audit (listed so the history is clear): **documents IDOR**
(download/delete scoped by `customerId`); **logout** clears the persisted token;
**payment idempotency** (`Idempotency-Key` + partial unique index — a retry
returns the original payment); **payment atomicity** (one transaction with
`SELECT … FOR UPDATE` on the loan, so the insert and auto-close commit together);
**money truncation** (`DBRupees` rounds; a test pins agreement with the frontend
across 24,000 principal/rate combinations); **login rate limiting**; **audit_log
writes** for payments; **MIME magic-byte sniffing** on upload (a spoofed
content type is rejected); **filename sanitisation**; **PII log redaction**;
**disabled-admin lockout** on `/users`; and **keyboard access** for the date
picker and the loan actions menu.

Mitigations for what remains: keep the operator count small and trusted, use a
long random admin password, watch the access log for repeated 401s and for the
`auto-close FAILED` warnings the status sync now emits, and take backups (below).

---

## 1. Droplet preparation

```bash
# Ubuntu 22.04/24.04 LTS, 2 vCPU / 4 GB is comfortable for this workload.
adduser deploy && usermod -aG sudo deploy
# Copy your public key to /home/deploy/.ssh/authorized_keys, then harden SSH:
#   /etc/ssh/sshd_config →  PasswordAuthentication no
#                           PermitRootLogin no
systemctl restart ssh

# Firewall: only SSH + HTTPS. The database and API are NEVER public.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp     # Caddy needs :80 for ACME HTTP-01 + the HTTPS redirect
ufw allow 443/tcp
ufw enable

# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Also enable the **DigitalOcean cloud firewall** with the same rules — defence in
depth if `ufw` is ever flushed.

## 2. DNS

Point an `A` record for your domain at the droplet IP **before** deploying —
Caddy cannot obtain a certificate until DNS resolves.

## 3. Configure

```bash
git clone <your-repo> /opt/anush-lms
cd /opt/anush-lms/backend

cp .env.production.example .env.production
# Fill in EVERY value. Generate real secrets — never reuse anything from
# docker-compose.yml (those dev credentials are public in the repo):
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 24   # ADMIN_PASSWORD
chmod 600 .env.production
```

Compose uses `${VAR:?}` for every secret, so a missing value **aborts the
deploy** with a named error rather than silently starting with a dev default.

## 4. Deploy

```bash
cd /opt/anush-lms/backend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
```

The backend self-provisions on first boot: generates the RS256 keypair into the
`jwt_keys` volume, applies migrations, seeds the admin from `ADMIN_*`.

## 5. Post-deploy verification

```bash
curl -I  http://YOUR_DOMAIN            # expect 301 → https
curl -sI https://YOUR_DOMAIN | grep -i strict-transport   # HSTS present
curl -s  https://YOUR_DOMAIN/api/v1/../health             # backend liveness

# Log in, then confirm the security headers on the SPA:
curl -sI https://YOUR_DOMAIN | grep -Ei 'content-security-policy|x-frame|nosniff'

# The database must NOT be reachable from outside:
nc -zv YOUR_DOMAIN 5432 ; nc -zv YOUR_DOMAIN 5433   # both must FAIL
```

**Immediately after first login:** change the admin password in the app, then
remove `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_FULL_NAME` from
`.env.production` and redeploy so the bootstrap credentials no longer exist on
disk.

**Smoke-test the money paths** with one throwaway customer: create a loan of
each type you use, record a normal payment, a bulk payment, a partial payment,
clear overdue, then foreclose — and confirm the ledger and the dashboard Profit
figure agree. Delete the test data afterwards.

## 6. Backups — mandatory

```bash
cd /opt/anush-lms/backend
chmod +x scripts/backup-db.sh
crontab -e
# 02:15 IST nightly
15 2 * * *  cd /opt/anush-lms/backend && ./scripts/backup-db.sh >> /var/log/anush-backup.log 2>&1
```

Then **copy the dumps off the droplet** (DigitalOcean Spaces, or a managed
database with automated backups + PITR, which is the better long-term answer).
A backup on the same disk as the database is not a backup.

### Test the restore — a backup you have never restored is not a backup

```bash
# Restore the latest dump into a scratch database and check it has real rows.
LATEST=$(ls -t backups/*.dump | head -1)
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  createdb -U "$POSTGRES_USER" restore_test
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d restore_test < "$LATEST"
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d restore_test \
  -c "SELECT (SELECT count(*) FROM customers) AS customers,
             (SELECT count(*) FROM loans)     AS loans,
             (SELECT count(*) FROM collections) AS collections;"
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  dropdb -U "$POSTGRES_USER" restore_test
```

Do this once now and once a quarter. Record your RPO (24h with nightly dumps)
and RTO (how long the above actually took).

## 7. Updating

```bash
cd /opt/anush-lms && git pull
cd backend && docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Migrations apply automatically on backend boot. **Take a backup before any
deploy that includes a migration** — the runner has no automated rollback path.

Rollback: `git checkout <previous-tag>` and rebuild. A schema change may not be
backward compatible, so restore the pre-deploy dump if a migration ran.

## 8. Monitoring

Enable DigitalOcean Monitoring + alerts for CPU, memory, and disk (documents
live in Postgres, so disk grows with uploads). Add an external uptime check on
`https://YOUR_DOMAIN`. Container logs are JSON with rotation caps
(10 MB × 3–5 files) configured in the compose file.

```bash
# Watch for brute-force attempts while login is unthrottled:
docker compose --env-file .env.production -f docker-compose.prod.yml logs backend \
  | grep '"path":"/api/v1/auth/login"' | grep '"status":401'
```

## 9. Operational notes

- **Timezone**: containers run `TZ=Asia/Kolkata`. Loan dates are local-calendar
  based — changing this shifts what "today" means and mis-dates receipts.
- **JWT keys**: live in the `jwt_keys` volume. Deleting it invalidates all
  sessions (everyone re-logs in); it does not affect data.
- **Sessions**: hard 1-hour expiry, no refresh. Users re-login hourly by design.
- **`docker compose down -v` destroys the database.** Never run it in
  production. Use `down` without `-v`.
