# Debian (glibc) base on both stages: better-sqlite3 is a native module and
# Playwright's chromium (used by the cookie-auth WebCDP capture flow) targets
# glibc/Debian, not Alpine/musl. Keeping both stages on the same libc avoids
# native-ABI mismatches when node_modules is copied across.
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# Browsers are installed in the runtime stage, not here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Toolchain for native deps (better-sqlite3) in case no prebuild matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/portal/package.json ./packages/portal/
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=builder /app/packages/server/dist ./server
COPY --from=builder /app/node_modules ./node_modules
# node_modules/@a-workbench/* are workspace symlinks into packages/, which isn't
# shipped — they dangle. Drop them and ship @a-workbench/shared (the only one the
# server imports) as a real package so its `main` resolves cleanly.
RUN rm -rf node_modules/@a-workbench
COPY --from=builder /app/packages/shared/package.json ./node_modules/@a-workbench/shared/package.json
COPY --from=builder /app/packages/shared/dist ./node_modules/@a-workbench/shared/dist
COPY --from=builder /app/packages/portal/dist ./portal
COPY --from=builder /app/packages/plugins ./plugins
# Cookie-auth capture spawns chromium via playwright's chromium.executablePath().
# Bake the matching browser + its system libraries into the image so the flow
# works headless in-container. Installed world-readable so any runtime uid works.
RUN npx playwright install --with-deps chromium \
 && chmod -R a+rx /ms-playwright
RUN npm install -g tsx@4.19.4
EXPOSE 3000
CMD ["tsx", "server/index.js"]
