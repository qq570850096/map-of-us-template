# Deploy Server To Zeabur And Build Android APK

This project deploys the backend API as a Docker service and packages the static
frontend into a Capacitor Android APK.

## Zeabur Backend

1. Push this repository to GitHub.
2. In Zeabur, create a new project.
3. Add a PostgreSQL service.
4. Add a Git service from this repository.
5. Use the root `Dockerfile` as the server build entry.
6. Set the public domain for the server service, for example:

```text
https://map-of-us-api.zeabur.app
```

Set these variables on the server service:

```text
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=<Zeabur PostgreSQL connection string>
JWT_SECRET=<a long random secret, at least 24 chars>
WEB_ORIGIN=capacitor://localhost,http://localhost,https://localhost
SEED_ON_START=true

DEFAULT_SPACE_NAME=Map of Us
DEFAULT_SPACE_SLUG=map-of-us
DEFAULT_USER_1_USERNAME=me
DEFAULT_USER_1_PASSWORD=<your password>
DEFAULT_USER_1_DISPLAY_NAME=Me
DEFAULT_USER_2_USERNAME=her
DEFAULT_USER_2_PASSWORD=<her password>
DEFAULT_USER_2_DISPLAY_NAME=Her

S3_ENDPOINT=<S3/R2/OSS endpoint>
S3_REGION=auto
S3_ACCESS_KEY_ID=<object storage access key>
S3_SECRET_ACCESS_KEY=<object storage secret>
S3_BUCKET=map-of-us
S3_PUBLIC_BASE_URL=<public bucket base url>

ASTRBOT_BASE_URL=<optional AstrBot base url>
ASTRBOT_API_KEY=<optional AstrBot api key>
```

After the first successful deploy, set `SEED_ON_START=false` unless you want the
two default account display names and roles refreshed on every boot.

The container starts with:

```bash
prisma migrate deploy
node apps/server/dist/src/index.js
```

If `SEED_ON_START=true`, it runs the seed script between migration and server
startup.

## Android APK

Build the APK with the deployed Zeabur API URL baked into the static frontend:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="https://map-of-us-api.zeabur.app"
npm run mobile:android:build
```

The debug APK is generated at:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Requirements for local APK builds:

- JDK installed and available as `java`
- Android SDK installed
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` points to the SDK directory
- Android SDK platform and build tools installed

If those tools are missing, `npm run mobile:android:sync` still verifies the web
assets and Capacitor Android project sync, but Gradle cannot produce an APK.
