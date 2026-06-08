import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { astrBotUsername, callAstrBotStream, callAstrBotText } from "../astrbot.js";
import { prisma } from "../prisma.js";
import type { AuthenticatedRequest } from "../types.js";

function extractJsonObject(text: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function registerAiRoutes(app: FastifyInstance) {
  app.post("/ai/chat/stream", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { message?: unknown; sessionId?: unknown; purpose?: unknown } | null;
    if (!payload || typeof payload.message !== "string") {
      return reply.code(400).send({ error: "Invalid AI chat payload" });
    }

    const username = astrBotUsername(auth.spaceId, auth.userId);
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId
        ? payload.sessionId
        : `${typeof payload.purpose === "string" ? payload.purpose : "chat"}:${auth.spaceId}:${auth.userId}`;

    const upstream = await callAstrBotStream({
      username,
      sessionId,
      message: payload.message,
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });
    const reader = upstream.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(value);
    }
    reply.raw.end();
  });

  app.post("/ai/memory-drafts", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as { sourceText?: unknown; cityId?: unknown; date?: unknown } | null;
    if (!payload || typeof payload.sourceText !== "string" || !payload.sourceText.trim()) {
      return reply.code(400).send({ error: "Invalid memory draft payload" });
    }

    const prompt = [
      "你是 Map of Us 的旅行记录整理助手。",
      "请把用户的碎片描述整理为 JSON，不要输出解释。",
      "字段: cityId, date, title, text, tags。",
      "date 使用 YYYY.MM.DD，不确定可为空字符串；text 控制在 80 个中文字以内。",
      `用户描述: ${payload.sourceText}`,
      typeof payload.cityId === "string" ? `候选 cityId: ${payload.cityId}` : "",
      typeof payload.date === "string" ? `候选日期: ${payload.date}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callAstrBotText({
      username: astrBotUsername(auth.spaceId, auth.userId),
      sessionId: `memory-draft:${auth.spaceId}:${auth.userId}`,
      message: prompt,
    });
    const json = extractJsonObject(raw) ?? {
      cityId: typeof payload.cityId === "string" ? payload.cityId : "",
      date: typeof payload.date === "string" ? payload.date : "",
      title: "旅行回忆",
      text: raw || payload.sourceText.slice(0, 80),
      tags: [],
    };

    const draft = await prisma.aiDraft.create({
      data: {
        spaceId: auth.spaceId,
        userId: auth.userId,
        kind: "memory",
        payload: {
          status: "draft",
          cityId: typeof json.cityId === "string" ? json.cityId : "",
          date: typeof json.date === "string" ? json.date : "",
          title: typeof json.title === "string" ? json.title : "旅行回忆",
          text: typeof json.text === "string" ? json.text : payload.sourceText.slice(0, 80),
          tags: Array.isArray(json.tags) ? json.tags.filter((tag): tag is string => typeof tag === "string") : [],
          sourceText: payload.sourceText,
        },
        source: { raw },
      },
    });

    return { draft: { id: draft.id, status: draft.status, ...(draft.payload as object), createdAt: draft.createdAt.toISOString() } };
  });

  app.post("/ai/trip-plans", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as {
      origin?: unknown;
      destination?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      preferences?: unknown;
    } | null;
    if (
      !payload ||
      typeof payload.origin !== "string" ||
      !payload.origin.trim() ||
      typeof payload.destination !== "string" ||
      !payload.destination.trim()
    ) {
      return reply.code(400).send({ error: "Invalid trip plan payload" });
    }

    const origin = payload.origin.trim();
    const destination = payload.destination.trim();
    const prompt = [
      "你是 Map of Us 的情侣旅行规划助手，可以调用 AstrBot 已配置的高德地图、机票查询和 12306 MCP 能力。",
      "请基于出发地、目的地和偏好生成 JSON，不要输出解释。",
      "字段: title, origin, destination, destinationCityIds, summary, checkpoints, transportNotes。",
      `出发地: ${origin}`,
      `目的地: ${destination}`,
      typeof payload.startDate === "string" ? `开始日期: ${payload.startDate}` : "",
      typeof payload.endDate === "string" ? `结束日期: ${payload.endDate}` : "",
      typeof payload.preferences === "string" ? `偏好: ${payload.preferences}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callAstrBotText({
      username: astrBotUsername(auth.spaceId, auth.userId),
      sessionId: `trip-plan:${auth.spaceId}:${auth.userId}`,
      message: prompt,
    });
    const json = extractJsonObject(raw) ?? {
      title: `${origin}到${destination}旅行计划`,
      origin,
      destination,
      destinationCityIds: [],
      summary: raw || "AI 暂未返回结构化计划，请在草稿中继续编辑。",
      checkpoints: [],
      transportNotes: [],
    };

    const draft = await prisma.aiDraft.create({
      data: {
        spaceId: auth.spaceId,
        userId: auth.userId,
        kind: "trip_plan",
        payload: {
          status: "draft",
          title: typeof json.title === "string" ? json.title : `${origin}到${destination}旅行计划`,
          origin: typeof json.origin === "string" ? json.origin : origin,
          destination: typeof json.destination === "string" ? json.destination : destination,
          destinationCityIds: Array.isArray(json.destinationCityIds)
            ? json.destinationCityIds.filter((item): item is string => typeof item === "string")
            : [],
          startDate: typeof payload.startDate === "string" ? payload.startDate : "",
          endDate: typeof payload.endDate === "string" ? payload.endDate : "",
          summary: typeof json.summary === "string" ? json.summary : "",
          checkpoints: Array.isArray(json.checkpoints)
            ? json.checkpoints.filter((item): item is string => typeof item === "string")
            : [],
          transportNotes: Array.isArray(json.transportNotes)
            ? json.transportNotes.filter((item): item is string => typeof item === "string")
            : [],
        },
        source: { raw },
      },
    });

    return { draft: { id: draft.id, status: draft.status, ...(draft.payload as object), createdAt: draft.createdAt.toISOString() } };
  });

  app.post("/ai/drafts/:id/accept", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const draft = await prisma.aiDraft.findFirst({ where: { id, spaceId: auth.spaceId, status: "draft" } });
    if (!draft) return reply.code(404).send({ error: "Draft not found" });

    if (draft.kind === "trip_plan") {
      const payload = draft.payload as Record<string, unknown>;
      const plan = await prisma.tripPlan.create({
        data: {
          spaceId: auth.spaceId,
          title: typeof payload.title === "string" ? payload.title : "旅行计划",
          payload: payload as Prisma.InputJsonValue,
        },
      });
      await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "accepted" } });
      return { ok: true, tripPlan: plan };
    }

    await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "accepted" } });
    return { ok: true, draft: { id: draft.id, status: "accepted", ...(draft.payload as object) } };
  });
}
