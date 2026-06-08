import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { cityInfo } from "../cities.js";
import { prisma } from "../prisma.js";
import { memoryStore, serializeMemory } from "../serializers.js";
import { storeImage } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function registerBackupRoutes(app: FastifyInstance) {
  app.post("/backup/import", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as unknown;
    if (!isRecord(payload)) return reply.code(400).send({ error: "Invalid backup payload" });

    if (isRecord(payload.memories)) {
      await prisma.memory.deleteMany({ where: { spaceId: auth.spaceId } });
      for (const [cityId, value] of Object.entries(payload.memories)) {
        const entries = Array.isArray(value) ? value : [value];
        for (const entry of entries) {
          if (!isRecord(entry)) continue;
          const info = cityInfo(cityId, {
            name: typeof entry.city === "string" ? entry.city : undefined,
            nameEn: typeof entry.cityEn === "string" ? entry.cityEn : undefined,
          });
          const memory = await prisma.memory.create({
            data: {
              spaceId: auth.spaceId,
              createdById: auth.userId,
              cityId: info.id,
              city: info.name,
              cityEn: info.nameEn,
              date: typeof entry.date === "string" ? entry.date : "待添加日期",
              text: typeof entry.text === "string" ? entry.text : "",
            },
          });
          const photos = Array.isArray(entry.photos)
            ? entry.photos.filter((photo): photo is string => typeof photo === "string")
            : typeof entry.image === "string"
              ? [entry.image]
              : [];
          const created = await Promise.all(
            photos.map(async (photo, index) => {
              const stored = await storeImage(auth.spaceId, `memories/${memory.id}`, photo);
              return prisma.memoryPhoto.create({
                data: {
                  memoryId: memory.id,
                  key: stored.key,
                  url: stored.url,
                  mimeType: stored.mimeType,
                  sortOrder: index,
                },
              });
            }),
          );
          if (created[0]) {
            await prisma.memory.update({ where: { id: memory.id }, data: { coverPhotoId: created[0].id } });
          }
        }
      }
    }

    if (isRecord(payload.settings)) {
      await prisma.setting.upsert({
        where: { spaceId_key: { spaceId: auth.spaceId, key: "app" } },
        create: { spaceId: auth.spaceId, key: "app", value: payload.settings as Prisma.InputJsonValue },
        update: { value: payload.settings as Prisma.InputJsonValue },
      });
    }

    if (isRecord(payload.cityAssets)) {
      await Promise.all(
        Object.entries(payload.cityAssets).flatMap(([cityId, image]) =>
          typeof image === "string"
            ? [
                storeImage(auth.spaceId, `city-assets/${cityId}`, image).then((stored) =>
                  prisma.cityAsset.upsert({
                    where: { spaceId_cityId: { spaceId: auth.spaceId, cityId } },
                    create: {
                      spaceId: auth.spaceId,
                      cityId,
                      key: stored.key,
                      url: stored.url,
                      mimeType: stored.mimeType,
                    },
                    update: { key: stored.key, url: stored.url, mimeType: stored.mimeType },
                  }),
                ),
              ]
            : [],
        ),
      );
    }

    const memories = await prisma.memory.findMany({
      where: { spaceId: auth.spaceId },
      include: { photos: true },
      orderBy: { createdAt: "desc" },
    });
    return { ok: true, memories: memoryStore(memories.map(serializeMemory)) };
  });
}
