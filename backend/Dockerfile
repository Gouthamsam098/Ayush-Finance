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
FROM alpine:3.20
WORKDIR /app

# CA certs for any outbound TLS; wget is used by the compose healthcheck;
# tzdata so TZ=Asia/Kolkata resolves (the app works in IST calendar days).
RUN apk add --no-cache ca-certificates wget tzdata

COPY --from=build /out/server    /app/server
COPY --from=build /out/genkeys   /app/genkeys
COPY --from=build /out/seedadmin /app/seedadmin
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
