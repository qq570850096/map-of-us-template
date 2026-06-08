import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { config } from "./config.js";

const client =
  config.S3_ENDPOINT && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
    ? new S3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        },
      })
    : null;

const dataUrlPattern = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

export function parseDataImage(value: string) {
  const match = dataUrlPattern.exec(value);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function storeImage(spaceId: string, folder: string, image: string) {
  if (!image.startsWith("data:image/")) {
    return {
      key: image,
      url: image,
      mimeType: undefined,
    };
  }

  const parsed = parseDataImage(image);
  if (!parsed) throw new Error("Invalid image data URL");

  const extension = parsed.mimeType.includes("png")
    ? "png"
    : parsed.mimeType.includes("webp")
      ? "webp"
      : parsed.mimeType.includes("svg")
        ? "svg"
        : "jpg";
  const key = `${spaceId}/${folder}/${nanoid()}.${extension}`;

  if (client) {
    await client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: parsed.buffer,
        ContentType: parsed.mimeType,
      }),
    );
    const base = config.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
    return {
      key,
      url: base ? `${base}/${key}` : `${config.S3_ENDPOINT?.replace(/\/$/, "")}/${config.S3_BUCKET}/${key}`,
      mimeType: parsed.mimeType,
    };
  }

  return {
    key,
    url: image,
    mimeType: parsed.mimeType,
  };
}
