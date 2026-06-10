import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { auxiliaryKinds } from "@map-of-us/shared";
import { requireAuth } from "../auth.js";
import { cityInfo } from "../cities.js";
import { prisma } from "../prisma.js";
import { memoryStore, serializeMemory } from "../serializers.js";
import { storeImage } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))]
    .map((tag) => tag.startsWith("e2ee:v1:") ? tag : tag.slice(0, 12))
    .slice(0, 12);
}

function auxiliaryEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entries]) => {
    const legacyKind = key.includes("favorite") ? "favorite" : key.includes("anniversar") ? "anniversary" : key.includes("capsule") ? "capsule" : "";
    if (!legacyKind || !Array.isArray(entries)) return [];
    return entries.filter(isRecord).map((entry): Record<string, unknown> => ({ ...entry, kind: typeof entry.kind === "string" ? entry.kind : legacyKind }));
  });
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
              tags: normalizeTags(entry.tags),
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

    const auxiliary = auxiliaryEntries((payload as Record<string, unknown>).auxiliary);
    if (auxiliary.length > 0) {
      await prisma.auxiliaryItem.deleteMany({ where: { spaceId: auth.spaceId } });
      await prisma.auxiliaryItem.createMany({
        data: auxiliary.flatMap((item) => {
          const kind = typeof item.kind === "string" && auxiliaryKinds.includes(item.kind as never) ? item.kind as never : null;
          const title = typeof item.title === "string" ? item.title.trim() : "";
          if (!kind || !title) return [];
          return [{
            spaceId: auth.spaceId,
            kind,
            title,
            date: typeof item.date === "string" ? item.date : null,
            note: typeof item.note === "string" ? item.note : "",
            cityId: typeof item.cityId === "string" ? item.cityId : null,
            payload: item.payload === undefined ? Prisma.JsonNull : item.payload as Prisma.InputJsonValue,
          }];
        }),
      });
    }

    const memories = await prisma.memory.findMany({
      where: { spaceId: auth.spaceId },
      include: { photos: true },
      orderBy: { createdAt: "desc" },
    });
    return { ok: true, memories: memoryStore(memories.map(serializeMemory)) };
  });
}
