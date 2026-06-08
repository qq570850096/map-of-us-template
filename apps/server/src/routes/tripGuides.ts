import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { tripGuidePayloadSchema } from "@map-of-us/shared";
import { requireAuth } from "../auth.js";
import { prisma } from "../prisma.js";
import type { AuthenticatedRequest } from "../types.js";

type TripPlanRow = {
  id: string;
  title: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function serializeTripPlan(plan: TripPlanRow) {
  return {
    id: plan.id,
    payload: plan.payload,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function serializeTripDraft(draft: {
  id: string;
  status: string;
  payload: Prisma.JsonValue;
  source: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: draft.id,
    status: draft.status,
    payload: draft.payload,
    source: draft.source,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export async function registerTripGuideRoutes(app: FastifyInstance) {
  app.get("/trip-guides", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const [plans, drafts] = await Promise.all([
      prisma.tripPlan.findMany({
        where: { spaceId: auth.spaceId },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.aiDraft.findMany({
        where: { spaceId: auth.spaceId, kind: "trip_plan", status: "draft" },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return {
      guides: plans.map(serializeTripPlan),
      drafts: drafts.map(serializeTripDraft),
    };
  });

  app.get("/trip-guides/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const plan = await prisma.tripPlan.findFirst({ where: { id, spaceId: auth.spaceId } });
    if (!plan) return reply.code(404).send({ error: "Trip guide not found" });
    return { guide: serializeTripPlan(plan) };
  });

  app.post("/trip-guides", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const parsed = tripGuidePayloadSchema.safeParse((request.body as { payload?: unknown } | null)?.payload ?? request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip guide payload" });

    const plan = await prisma.tripPlan.create({
      data: {
        spaceId: auth.spaceId,
        title: parsed.data.title,
        payload: parsed.data as Prisma.InputJsonValue,
      },
    });
    return { guide: serializeTripPlan(plan) };
  });

  app.patch("/trip-guides/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const existing = await prisma.tripPlan.findFirst({ where: { id, spaceId: auth.spaceId } });
    if (!existing) return reply.code(404).send({ error: "Trip guide not found" });

    const parsed = tripGuidePayloadSchema.safeParse((request.body as { payload?: unknown } | null)?.payload ?? request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip guide payload" });

    const plan = await prisma.tripPlan.update({
      where: { id: existing.id },
      data: {
        title: parsed.data.title,
        payload: parsed.data as Prisma.InputJsonValue,
      },
    });
    return { guide: serializeTripPlan(plan) };
  });

  app.delete("/trip-guides/:id", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await prisma.tripPlan.deleteMany({ where: { id, spaceId: auth.spaceId } });
    return { ok: true };
  });

  app.patch("/trip-guide-drafts/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const existing = await prisma.aiDraft.findFirst({
      where: { id, spaceId: auth.spaceId, kind: "trip_plan", status: "draft" },
    });
    if (!existing) return reply.code(404).send({ error: "Trip guide draft not found" });

    const parsed = tripGuidePayloadSchema.safeParse((request.body as { payload?: unknown } | null)?.payload ?? request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip guide draft payload" });

    const draft = await prisma.aiDraft.update({
      where: { id: existing.id },
      data: { payload: parsed.data as Prisma.InputJsonValue },
    });
    return { draft: serializeTripDraft(draft) };
  });

  app.post("/trip-guide-drafts/:id/accept", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const draft = await prisma.aiDraft.findFirst({
      where: { id, spaceId: auth.spaceId, kind: "trip_plan", status: "draft" },
    });
    if (!draft) return reply.code(404).send({ error: "Trip guide draft not found" });

    const parsed = tripGuidePayloadSchema.safeParse(draft.payload);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid trip guide draft payload" });

    const plan = await prisma.tripPlan.create({
      data: {
        spaceId: auth.spaceId,
        title: parsed.data.title,
        payload: parsed.data as Prisma.InputJsonValue,
      },
    });
    await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "accepted" } });
    return { ok: true, guide: serializeTripPlan(plan) };
  });

  app.delete("/trip-guide-drafts/:id", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await prisma.aiDraft.updateMany({
      where: { id, spaceId: auth.spaceId, kind: "trip_plan", status: "draft" },
      data: { status: "rejected" },
    });
    return { ok: true };
  });
}
