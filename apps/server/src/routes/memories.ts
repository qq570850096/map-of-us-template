import type { FastifyInstance } from "fastify";
import type { MemoryPhoto } from "@prisma/client";
import { memoryUpsertPayloadSchema } from "@map-of-us/shared";
import { cityInfo } from "../cities.js";
import { requireAuth } from "../auth.js";
import { prisma } from "../prisma.js";
import { memoryStore, serializeMemory } from "../serializers.js";
import { storeImage } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";

const datePattern = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/;

function normalizeDate(value: string) {
  const match = datePattern.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

async function readSpaceMemories(spaceId: string) {
  const memories = await prisma.memory.findMany({
    where: { spaceId },
    include: { photos: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return memories.map(serializeMemory);
}

export async function registerMemoryRoutes(app: FastifyInstance) {
  app.get("/memories", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    return { memories: memoryStore(await readSpaceMemories(auth.spaceId)) };
  });

  app.post("/memories", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const parsed = memoryUpsertPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid memory payload" });

    const normalizedDate = normalizeDate(parsed.data.memory.date);
    if (!normalizedDate) return reply.code(400).send({ error: "Invalid memory date" });

    const info = cityInfo(parsed.data.memory.cityId, {
      name: parsed.data.memory.city,
      nameEn: parsed.data.memory.cityEn,
    });
    const rawPhotos = parsed.data.memory.photos?.length
      ? parsed.data.memory.photos
      : parsed.data.memory.image
        ? [parsed.data.memory.image]
        : [];

    const memory = await prisma.memory.create({
      data: {
        spaceId: auth.spaceId,
        createdById: auth.userId,
        cityId: info.id,
        city: info.name,
        cityEn: info.nameEn,
        date: normalizedDate,
        text: parsed.data.memory.text.trim(),
      },
    });

    const uploaded = await Promise.all(
      rawPhotos.map((photo, index) => storeImage(auth.spaceId, `memories/${memory.id}`, photo).then((stored) => ({ ...stored, index }))),
    );
    const createdPhotos = uploaded.length
      ? await Promise.all(
          uploaded.map((photo) =>
            prisma.memoryPhoto.create({
              data: {
                memoryId: memory.id,
                key: photo.key,
                url: photo.url,
                mimeType: photo.mimeType,
                sortOrder: photo.index,
              },
            }),
          ),
        )
      : [];

    if (createdPhotos[0]) {
      await prisma.memory.update({
        where: { id: memory.id },
        data: { coverPhotoId: createdPhotos[0].id },
      });
    }

    const memories = await readSpaceMemories(auth.spaceId);
    return { memory: memories.find((item) => item.id === memory.id), memories: memoryStore(memories) };
  });

  app.patch("/memories", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as
      | { cityId?: unknown; memoryId?: unknown; coverImage?: unknown; memory?: unknown }
      | null;

    if (
      !payload ||
      typeof payload.cityId !== "string" ||
      typeof payload.memoryId !== "string"
    ) {
      return reply.code(400).send({ error: "Invalid memory patch payload" });
    }

    const existing = await prisma.memory.findFirst({
      where: { id: payload.memoryId, cityId: payload.cityId, spaceId: auth.spaceId },
      include: { photos: true },
    });
    if (!existing) return reply.code(404).send({ error: "Memory not found" });

    if (typeof payload.coverImage === "string") {
      const photo = existing.photos.find((item: MemoryPhoto) => item.url === payload.coverImage);
      if (!photo) return reply.code(400).send({ error: "Cover image is not part of memory" });
      await prisma.memory.update({
        where: { id: existing.id },
        data: { coverPhotoId: photo.id },
      });
    } else {
      const parsed = memoryUpsertPayloadSchema.safeParse({ memory: payload.memory });
      if (!parsed.success) return reply.code(400).send({ error: "Invalid memory update payload" });
      const normalizedDate = normalizeDate(parsed.data.memory.date);
      if (!normalizedDate) return reply.code(400).send({ error: "Invalid memory date" });
      const info = cityInfo(parsed.data.memory.cityId, {
        name: parsed.data.memory.city,
        nameEn: parsed.data.memory.cityEn,
      });
      await prisma.memory.update({
        where: { id: existing.id },
        data: {
          cityId: info.id,
          city: info.name,
          cityEn: info.nameEn,
          date: normalizedDate,
          text: parsed.data.memory.text.trim(),
        },
      });

      if (parsed.data.memory.photos?.length) {
        await prisma.memoryPhoto.deleteMany({ where: { memoryId: existing.id } });
        const uploaded = await Promise.all(
          parsed.data.memory.photos.map((photo, index) =>
            storeImage(auth.spaceId, `memories/${existing.id}`, photo).then((stored) => ({ ...stored, index })),
          ),
        );
        const created = await Promise.all(
          uploaded.map((photo) =>
            prisma.memoryPhoto.create({
              data: {
                memoryId: existing.id,
                key: photo.key,
                url: photo.url,
                mimeType: photo.mimeType,
                sortOrder: photo.index,
              },
            }),
          ),
        );
        await prisma.memory.update({
          where: { id: existing.id },
          data: { coverPhotoId: created[0]?.id ?? null },
        });
      }
    }

    const memories = await readSpaceMemories(auth.spaceId);
    return { memory: memories.find((item) => item.id === existing.id), memories: memoryStore(memories) };
  });

  app.delete("/memories", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { cityId?: unknown; memoryId?: unknown } | null;
    if (!payload || typeof payload.cityId !== "string" || typeof payload.memoryId !== "string") {
      return reply.code(400).send({ error: "Invalid memory delete payload" });
    }

    const existing = await prisma.memory.findFirst({
      where: { id: payload.memoryId, cityId: payload.cityId, spaceId: auth.spaceId },
    });
    if (!existing) return reply.code(404).send({ error: "Memory not found" });

    await prisma.memory.delete({ where: { id: existing.id } });
    return { memories: memoryStore(await readSpaceMemories(auth.spaceId)) };
  });
}
