import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastify from "fastify";
import { config } from "./config.js";
import { registerAuthRoutes } from "./auth.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerBackupRoutes } from "./routes/backup.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerTripGuideRoutes } from "./routes/tripGuides.js";

const app = fastify({ logger: true });
const defaultAllowedOrigins = [
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "ionic://localhost",
];
const configuredOrigins = config.WEB_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const allowAnyOrigin = configuredOrigins.includes("*");
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins.filter((origin) => origin !== "*")]);

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowAnyOrigin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
});
await app.register(jwt, { secret: config.JWT_SECRET });
await app.register(multipart);

app.get("/health", async () => ({ ok: true }));

await registerAuthRoutes(app);
await registerMemoryRoutes(app);
await registerAssetRoutes(app);
await registerSettingsRoutes(app);
await registerBackupRoutes(app);
await registerTripGuideRoutes(app);
await registerAiRoutes(app);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
