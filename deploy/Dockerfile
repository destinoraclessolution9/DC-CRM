# =============================================================================
# Reference only — production is Vercel's edge CDN; do not use this to serve
# the SPA in production.
#
# This Dockerfile exists for LOCAL PARITY / SELF-HOST experiments only. It is
# NOT wired to any CI/CD pipeline. The canonical deploy path remains:
#   git push  ->  Vercel build (node build.mjs && npx vite build)  ->  edge CDN.
#
# Build CONTEXT is the repo ROOT (so build.mjs + sources are visible). From the
# project root run:
#   docker build -f deploy/Dockerfile -t crm-static .
#   docker run --rm -p 8080:80 crm-static   # then open http://localhost:8080
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: build — minify (esbuild), content-hash, brotli (.br), inject manifest
# Mirrors the production build command from vercel.json / package.json:
#   node build.mjs && (npx vite build || ...)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first so this layer caches independent of source edits.
COPY package*.json ./
RUN npm ci || npm install

# Bring in the full repo (build.mjs hashes + rewrites files in place, and the
# React island bundle in react-dist/ is committed, so the whole tree is needed).
COPY . .

# build.mjs is the source of truth (esbuild minify + brotli .br + content-hash +
# __ASSET_MANIFEST inject). vite build is best-effort — Vercel itself tolerates a
# vite skip and falls back to the committed react-dist/react-island.js bundle.
RUN node build.mjs && (npx vite build || echo "vite skipped — using committed react-dist")

# -----------------------------------------------------------------------------
# Stage 2: final — nginx serves the static tree with Vercel-mirrored headers
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine

# Replace the stock server block with our Vercel-mirroring config.
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the fully-built static tree (sources + .min + .br + hashed copies +
# manifest, robots, sitemap, *.html, react-dist, chunks, images, fonts).
COPY --from=build /app /usr/share/nginx/html

EXPOSE 80

# nginx:alpine already ships the default CMD ["nginx", "-g", "daemon off;"].
