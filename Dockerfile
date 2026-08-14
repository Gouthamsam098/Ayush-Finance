# ──────────────────────────────────────────────────────────────────────────
# Frontend production image: build the static bundle, serve it with nginx.
#
# NOTE: this image serves a PRODUCTION build. The Vite dev server (npm run dev)
# must never face the internet — it ships source, runs HMR websockets, and has
# no caching/compression. For local development use `npm run dev` on the host
# or the dev compose file, not this image.
# ──────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifests first so the dependency layer caches independently of source.
# `npm ci` (not `install`) installs exactly the committed lockfile — reproducible.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* values are inlined into the bundle at BUILD time, so they must be
# present here, not at runtime. They are public by definition — never put a
# secret in a VITE_ var.
ARG VITE_USE_API=true
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_USE_API=$VITE_USE_API
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# `npm run build` runs `tsc -b` first, so a type error fails the image build.
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Drop the default site and install our SPA config (history fallback, gzip,
# cache policy, security headers).
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/app.conf

# Only the built assets — no source, no node_modules, no source maps.
COPY --from=build /app/dist /usr/share/nginx/html

# Run as the unprivileged nginx user. nginx needs write access to its runtime
# dirs and must bind an unprivileged port (8080, not 80) as non-root.
RUN sed -i 's/^user  nginx;/# user directive removed: container runs as nginx/' /etc/nginx/nginx.conf \
    && sed -i 's#pid        /var/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
