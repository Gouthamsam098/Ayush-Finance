# ── Build stage ──────────────────────────────────────────────
FROM golang:1.26-alpine AS build
WORKDIR /src

# Cache modules first.
COPY go.mod go.sum ./
RUN go mod download

# Build both the server and the helper commands (genkeys, seedadmin) into
# static binaries so the runtime image needs no Go toolchain.
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server    ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux go build -o /out/genkeys   ./cmd/genkeys \
 && CGO_ENABLED=0 GOOS=linux go build -o /out/seedadmin ./cmd/seedadmin

# ── Runtime stage ────────────────────────────────────────────
# A supported Alpine branch (3.20 reached end of life in April 2026).
FROM alpine:3.22
WORKDIR /app

# CA certs for any outbound TLS; wget is used by the compose healthcheck;
# tzdata so TZ=Asia/Kolkata resolves (the app works in IST calendar days);
# su-exec so the entrypoint can drop from root to the `app` user.
RUN apk add --no-cache ca-certificates wget tzdata su-exec \
 && addgroup -S app && adduser -S -G app -H -h /app app \
 && mkdir -p /app/secrets && chown app:app /app/secrets

COPY --from=build /out/server    /app/server
COPY --from=build /out/genkeys   /app/genkeys
COPY --from=build /out/seedadmin /app/seedadmin
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000
# The entrypoint starts as root ONLY to hand the key volume to `app` (a volume
# created by an earlier, root-run image holds root-owned keys), then runs the
# key generator, the admin seeder and the server as the unprivileged user.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
