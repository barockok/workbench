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
COPY --from=builder /app/packages/server/node_modules ./server/node_modules
COPY --from=builder /app/packages/shared/dist ./server/node_modules/@a-workbench/shared
COPY --from=builder /app/packages/portal/dist ./portal
EXPOSE 3000
CMD ["node", "server/index.js"]
