import type { FastifyInstance } from "fastify";
import { Prisma, type CityAsset, type LoginPhoto } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { prisma } from "../prisma.js";
import { storeImage } from "../storage.js";
import type { AuthenticatedRequest } from "../types.js";

export async function registerAssetRoutes(app: FastifyInstance) {
  app.get("/city-assets", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const assets = await prisma.cityAsset.findMany({ where: { spaceId: auth.spaceId } });
    return { assets: Object.fromEntries(assets.map((asset: CityAsset) => [asset.cityId, asset.url])) };
  });

  app.put("/city-assets", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { cityId?: unknown; image?: unknown } | null;
    if (!payload || typeof payload.cityId !== "string" || typeof payload.image !== "string") {
      return reply.code(400).send({ error: "Invalid city asset payload" });
    }

    const stored = await storeImage(auth.spaceId, `city-assets/${payload.cityId}`, payload.image);
    await prisma.cityAsset.upsert({
      where: { spaceId_cityId: { spaceId: auth.spaceId, cityId: payload.cityId } },
      create: {
        spaceId: auth.spaceId,
        cityId: payload.cityId,
        key: stored.key,
        url: stored.url,
        mimeType: stored.mimeType,
      },
      update: {
        key: stored.key,
        url: stored.url,
        mimeType: stored.mimeType,
      },
    });

    const assets = await prisma.cityAsset.findMany({ where: { spaceId: auth.spaceId } });
    return { assets: Object.fromEntries(assets.map((asset: CityAsset) => [asset.cityId, asset.url])) };
  });

  app.delete("/city-assets", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { cityId?: unknown } | null;
    if (!payload || typeof payload.cityId !== "string") {
      return reply.code(400).send({ error: "Invalid city asset payload" });
    }

    await prisma.cityAsset.deleteMany({ where: { spaceId: auth.spaceId, cityId: payload.cityId } });
    const assets = await prisma.cityAsset.findMany({ where: { spaceId: auth.spaceId } });
    return { assets: Object.fromEntries(assets.map((asset: CityAsset) => [asset.cityId, asset.url])) };
  });

  app.get("/login-photos", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const rows = await prisma.loginPhoto.findMany({ where: { spaceId: auth.spaceId } });
    return {
      photos: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.url ? [[row.slotId, row.url] as const] : []))),
      texts: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.text ? [[row.slotId, row.text] as const] : []))),
    };
  });

  app.put("/login-photos", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { slotId?: unknown; image?: unknown; text?: unknown } | null;
    if (!payload || typeof payload.slotId !== "string") {
      return reply.code(400).send({ error: "Invalid login photo payload" });
    }

    const stored = typeof payload.image === "string"
      ? await storeImage(auth.spaceId, `login-photos/${payload.slotId}`, payload.image)
      : null;
    const text =
      payload.text && typeof payload.text === "object" && !Array.isArray(payload.text)
        ? (payload.text as Prisma.InputJsonValue)
        : undefined;

    await prisma.loginPhoto.upsert({
      where: { spaceId_slotId: { spaceId: auth.spaceId, slotId: payload.slotId } },
      create: {
        spaceId: auth.spaceId,
        slotId: payload.slotId,
        key: stored?.key,
        url: stored?.url,
          text,
      },
      update: {
        ...(stored ? { key: stored.key, url: stored.url } : {}),
        ...(text ? { text } : {}),
      },
    });

    const rows = await prisma.loginPhoto.findMany({ where: { spaceId: auth.spaceId } });
    return {
      photos: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.url ? [[row.slotId, row.url] as const] : []))),
      texts: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.text ? [[row.slotId, row.text] as const] : []))),
    };
  });

  app.patch("/login-photos", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { texts?: unknown } | null;
    if (!payload || typeof payload.texts !== "object" || payload.texts === null || Array.isArray(payload.texts)) {
      return reply.code(400).send({ error: "Invalid login photo text payload" });
    }

    await Promise.all(
      Object.entries(payload.texts as Record<string, unknown>).map(([slotId, text]) =>
        prisma.loginPhoto.upsert({
          where: { spaceId_slotId: { spaceId: auth.spaceId, slotId } },
          create: { spaceId: auth.spaceId, slotId, text: text as Prisma.InputJsonValue },
          update: { text: text as Prisma.InputJsonValue },
        }),
      ),
    );
    return { ok: true };
  });

  app.delete("/login-photos", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { slotId?: unknown; kind?: unknown } | null;
    if (!payload || typeof payload.slotId !== "string") {
      return reply.code(400).send({ error: "Invalid login photo delete payload" });
    }

    if (payload.kind === "text") {
      await prisma.loginPhoto.updateMany({
        where: { spaceId: auth.spaceId, slotId: payload.slotId },
        data: { text: undefined },
      });
    } else {
      await prisma.loginPhoto.updateMany({
        where: { spaceId: auth.spaceId, slotId: payload.slotId },
        data: { key: null, url: null },
      });
    }

    const rows = await prisma.loginPhoto.findMany({ where: { spaceId: auth.spaceId } });
    return {
      photos: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.url ? [[row.slotId, row.url] as const] : []))),
      texts: Object.fromEntries(rows.flatMap((row: LoginPhoto) => (row.text ? [[row.slotId, row.text] as const] : []))),
    };
  });
}
