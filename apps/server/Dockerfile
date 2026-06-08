FROM node:24-alpine AS deps
WORKDIR /app
COPY . .
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY . .
RUN npm run db:generate
RUN npm run build -w @map-of-us/shared
RUN npm run build:server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/packages/shared ./packages/shared
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
EXPOSE 4002
CMD ["npm", "run", "start:zeabur", "-w", "@map-of-us/server"]
