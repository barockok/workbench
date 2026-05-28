FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/portal/package.json ./packages/portal/
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/server/dist ./server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./node_modules/@a-workbench/shared
COPY --from=builder /app/packages/portal/dist ./portal
COPY --from=builder /app/packages/plugins ./plugins
EXPOSE 3000
RUN npm install -g tsx@4.19.4
CMD ["tsx", "server/index.js"]
