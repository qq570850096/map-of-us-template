# Map of Us

Map of Us is now an online-first, frontend/backend split private couple memory map. The frontend can be built for web, Electron desktop, and Capacitor mobile. The backend owns auth, Postgres data, S3-compatible object storage, backups, and AstrBot AI proxying.

## Structure

- `apps/web`: Next/React/Tailwind static frontend.
- `apps/server`: Fastify + Prisma API server.
- `apps/desktop`: Electron shell that loads `apps/web/out`.
- `apps/mobile`: Capacitor wrapper for Android/iOS.
- `packages/shared`: shared DTOs, schemas, and types.

## Local Development

```bash
cp .env.example .env
docker compose up -d postgres minio minio-init
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:server
npm run dev:web
```

Default seeded users:

```text
me / 1234
her / 1234
```

The web app defaults to `http://localhost:4002` for the API. Override it with `NEXT_PUBLIC_API_BASE_URL`.

## AI

Set `ASTRBOT_BASE_URL` and `ASTRBOT_API_KEY` on the server. The server calls AstrBot OpenAPI `POST /api/v1/chat` with a generated username in the form `mapofus:{spaceId}:{userId}` and feature-scoped session ids. AI output is saved as drafts first.

## Builds

```bash
npm run build:web
npm run desktop
npm run dist:win
npm run mobile:sync
npm run mobile:android:build
```

Desktop and mobile builds use the same static frontend and connect to the deployed backend.

## Deploy And APK

See [docs/deploy-zeabur-and-apk.md](docs/deploy-zeabur-and-apk.md) for Zeabur backend deployment variables and Android APK build steps.
