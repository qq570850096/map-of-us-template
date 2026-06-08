import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4002),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24),
  WEB_ORIGIN: z.string().default("http://localhost:3002"),
  DEFAULT_SPACE_NAME: z.string().default("Map of Us"),
  DEFAULT_SPACE_SLUG: z.string().default("map-of-us"),
  DEFAULT_USER_1_USERNAME: z.string().default("me"),
  DEFAULT_USER_1_PASSWORD: z.string().default("1234"),
  DEFAULT_USER_1_DISPLAY_NAME: z.string().default("Me"),
  DEFAULT_USER_2_USERNAME: z.string().default("her"),
  DEFAULT_USER_2_PASSWORD: z.string().default("1234"),
  DEFAULT_USER_2_DISPLAY_NAME: z.string().default("Her"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("map-of-us"),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  ASTRBOT_BASE_URL: z.string().optional(),
  ASTRBOT_API_KEY: z.string().optional(),
});

export const config = envSchema.parse(process.env);
export const isProduction = config.NODE_ENV === "production";
