import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { tripGuidePayloadSchema } from "@map-of-us/shared";
import { requireAuth } from "../auth.js";
import { astrBotUsername, callAstrBotStream, callAstrBotText } from "../astrbot.js";
import { prisma } from "../prisma.js";
import type { AuthenticatedRequest } from "../types.js";

type JsonRecord = Record<string, unknown>;

type TripGuideInput = {
  origin: string;
  destination: string;
  days: number;
  startDate: string;
  endDate: string;
  preferences: string;
  transportPreference: string;
  travelStyle: "relaxed" | "balanced" | "packed";
  returnPlan?: string;
};

type TripGuideQuestion = {
  id: string;
  question: string;
  options: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function asPositiveDays(value: unknown, fallback = 3) {
  const days = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  return Number.isInteger(days) && days > 0 && days <= 30 ? days : fallback;
}

function asTravelStyle(value: unknown): "relaxed" | "balanced" | "packed" {
  if (value === "relaxed" || value === "balanced" || value === "packed") return value;
  if (value === "轻松慢游") return "relaxed";
  if (value === "尽量多打卡") return "packed";
  return "balanced";
}

function extractJsonCandidates(text: string) {
  const candidates: unknown[] = [];
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  const sources = [...text.matchAll(fencedPattern)].map((match) => match[1]).concat(text);

  for (const source of sources) {
    try {
      candidates.push(JSON.parse(source));
    } catch {
      // Continue with object scanning below.
    }

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (char === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          try {
            candidates.push(JSON.parse(source.slice(start, index + 1)));
          } catch {
            // Ignore malformed object fragments.
          }
          start = -1;
        }
      }
    }
  }

  return candidates;
}

function extractJsonObject(text: string, accepts?: (value: JsonRecord) => boolean) {
  for (const candidate of extractJsonCandidates(text)) {
    if (!isRecord(candidate)) continue;
    if (!accepts || accepts(candidate)) return candidate;
  }
  return null;
}

function hasToolFailure(text: string) {
  return /Permission denied|Shell execution|error:\s*Permission|Traceback|工具调用失败|MCP.*失败/i.test(text);
}

function normalizePolishCandidate(text: string) {
  return text.replace(/\s+/g, "").replace(/[。！？!?，,、；;：:]+$/g, "");
}

function collapseRepeatedPolishText(text: string) {
  const trimmed = text.trim();
  const sentences = trimmed.match(/[^。！？!?]+[。！？!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];

  if (sentences.length > 1) {
    const collapsed: string[] = [];
    for (const sentence of sentences) {
      const current = normalizePolishCandidate(sentence);
      const previous = normalizePolishCandidate(collapsed.at(-1) ?? "");
      if (current && current === previous) continue;
      collapsed.push(sentence);
    }
    return collapsed.join("").trim();
  }

  const compact = trimmed.replace(/\s+/g, "");
  for (let length = 1; length <= Math.floor(compact.length / 2); length += 1) {
    if (compact.length % length !== 0) continue;
    const unit = compact.slice(0, length);
    if (unit.repeat(compact.length / length) === compact) return unit;
  }

  return trimmed;
}

function cleanPolishedMemory(text: string) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/(?:^|\n)\s*(?:润色后|改写|结果|回忆|候选\d*)[:：]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(润色后|改写|结果|回忆|候选\d*)[:：]\s*/i, "");

  return collapseRepeatedPolishText(cleaned).slice(0, 80);
}

function buildMemoryPolishPrompt(input: {
  sourceText: string;
  cityId?: string;
  city?: string;
  date?: string;
}) {
  return [
    "你是 Map of Us 的一句话回忆润色助手。请只润色用户的一句话回忆。",
    "",
    "上下文：",
    `- 城市 ID：${input.cityId ?? ""}`,
    `- 城市：${input.city ?? ""}`,
    `- 日期：${input.date ?? ""}`,
    "",
    "原文：",
    input.sourceText,
    "",
    "要求：",
    "- 用中文。",
    "- 保留原意、地点、情绪和亲密感。",
    "- 更自然，更像情侣私密回忆。",
    "- 不要扩写成游记。",
    "- 不要输出 JSON、解释、标题、标签、引号或多条候选。",
    "- 不要重复输出同一句话。",
    "- 只输出一句话，最多 80 个中文字符。",
  ].join("\n");
}

function normalizeTripGuideInput(payload: {
  origin?: unknown;
  destination?: unknown;
  days?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  preferences?: unknown;
  transportPreference?: unknown;
  travelStyle?: unknown;
}): TripGuideInput {
  return {
    origin: asString(payload.origin),
    destination: asString(payload.destination),
    days: asPositiveDays(payload.days),
    startDate: asString(payload.startDate),
    endDate: asString(payload.endDate),
    preferences: asString(payload.preferences),
    transportPreference: asString(payload.transportPreference, "unknown"),
    travelStyle: asTravelStyle(payload.travelStyle),
  };
}

function localTripGuideQuestions(input: TripGuideInput) {
  const questions: TripGuideQuestion[] = [];
  if (!/(飞|飞机|航班|高铁|火车|自驾|开车)/.test(`${input.preferences} ${input.transportPreference}`)) {
    questions.push({
      id: "transportPreference",
      question: "这次交通方式怎么优先？",
      options: ["飞机优先", "高铁优先", "都可以，选更省时间的"],
    });
  }
  if (!input.preferences || !/(轻松|慢|打卡|紧凑|特种兵|拍照|美食)/.test(input.preferences)) {
    questions.push({
      id: "travelStyle",
      question: "这次行程节奏希望怎样？",
      options: ["轻松慢游", "均衡安排", "尽量多打卡"],
    });
  }
  if (!input.endDate) {
    questions.push({
      id: "returnPlan",
      question: "第三天是否需要安排返程？",
      options: ["第三天晚上返程", "第四天再返程", "暂不确定"],
    });
  }
  return questions.slice(0, 3);
}

function mapConfirmationAnswers(input: TripGuideInput, answers: JsonRecord): TripGuideInput {
  const transportAnswer = asString(answers.transportPreference, input.transportPreference);
  const styleAnswer = asString(answers.travelStyle);
  return {
    ...input,
    transportPreference:
      transportAnswer === "飞机优先"
        ? "flight_first"
        : transportAnswer === "高铁优先"
          ? "rail_first"
          : transportAnswer || input.transportPreference,
    travelStyle:
      styleAnswer === "轻松慢游"
        ? "relaxed"
        : styleAnswer === "尽量多打卡"
          ? "packed"
          : styleAnswer
            ? "balanced"
            : input.travelStyle,
    returnPlan: asString(answers.returnPlan, input.returnPlan ?? ""),
    preferences: [input.preferences, transportAnswer, styleAnswer, asString(answers.returnPlan)]
      .filter(Boolean)
      .join("；"),
  };
}

function buildMarkdown(payload: Omit<ReturnType<typeof tripGuidePayloadSchema.parse>, "markdown">) {
  const lines = [
    `# ${payload.title}`,
    "",
    `从 ${payload.origin || "出发地"} 到 ${payload.destination || "目的地"}，共 ${payload.days} 天。`,
    "",
    "## 交通方案",
    payload.transport.summary || "交通方案待补充。",
    ...payload.transport.outbound.map((item) => `- 去程：${item}`),
    ...payload.transport.returnTrip.map((item) => `- 返程：${item}`),
    ...payload.transport.local.map((item) => `- 当地：${item}`),
    ...payload.transport.warnings.map((item) => `- 提醒：${item}`),
    "",
    "## 每日安排",
    ...payload.daysPlan.flatMap((day) => [
      `### Day ${day.day} ${day.title || day.theme || "行程"}`,
      day.theme ? `主题：${day.theme}` : "",
      day.morning.length ? `上午：${day.morning.join("、")}` : "",
      day.afternoon.length ? `下午：${day.afternoon.join("、")}` : "",
      day.evening.length ? `晚上：${day.evening.join("、")}` : "",
      day.checkpoints.length ? `打卡点：${day.checkpoints.map((item) => item.name).join("、")}` : "",
      day.food?.length ? `美食：${day.food.join("、")}` : "",
      day.notes ? `备注：${day.notes}` : "",
      "",
    ]),
    "## 预算与提醒",
    ...(payload.budgetNotes.length ? payload.budgetNotes.map((item) => `- ${item}`) : ["- 预算待补充。"]),
    ...payload.packingNotes.map((item) => `- ${item}`),
    ...payload.risks.map((item) => `- ${item}`),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function normalizeTripGuidePayload(input: TripGuideInput, value: unknown) {
  const record = isRecord(value) ? value : {};
  const origin = asString(record.origin, input.origin);
  const destination = asString(record.destination, input.destination);
  const days = asPositiveDays(record.days, input.days);
  const rawTransport = isRecord(record.transport) ? record.transport : {};
  const rawDays = Array.isArray(record.daysPlan) ? record.daysPlan.filter(isRecord) : [];

  const withoutMarkdown = {
    title: asString(record.title, `${origin}到${destination}${days}日旅行攻略`),
    origin,
    destination,
    days,
    startDate: asString(record.startDate, input.startDate) || undefined,
    endDate: asString(record.endDate, input.endDate) || undefined,
    travelStyle: asTravelStyle(record.travelStyle ?? input.travelStyle),
    transport: {
      summary: asString(rawTransport.summary, "根据出发地、目的地和偏好安排交通，具体班次建议出发前再次查询。"),
      outbound: asStringArray(rawTransport.outbound),
      returnTrip: asStringArray(rawTransport.returnTrip),
      local: asStringArray(rawTransport.local),
      warnings: asStringArray(rawTransport.warnings),
    },
    daysPlan: Array.from({ length: days }, (_, index) => {
      const rawDay = rawDays.find((day) => asPositiveDays(day.day, index + 1) === index + 1) ?? rawDays[index] ?? {};
      const checkpoints = Array.isArray(rawDay.checkpoints) ? rawDay.checkpoints.filter(isRecord) : [];
      return {
        day: index + 1,
        title: asString(rawDay.title, `第 ${index + 1} 天`),
        theme: asString(rawDay.theme, index === 0 ? "抵达与轻松适应" : "城市探索"),
        morning: asStringArray(rawDay.morning),
        afternoon: asStringArray(rawDay.afternoon),
        evening: asStringArray(rawDay.evening),
        checkpoints: checkpoints.map((checkpoint) => ({
          name: asString(checkpoint.name, "待确认打卡点"),
          city: asString(checkpoint.city) || undefined,
          reason: asString(checkpoint.reason, "适合加入当天行程。"),
          suggestedDuration: asString(checkpoint.suggestedDuration) || undefined,
          tips: asString(checkpoint.tips) || undefined,
        })),
        food: asStringArray(rawDay.food),
        notes: asString(rawDay.notes) || undefined,
      };
    }),
    budgetNotes: asStringArray(record.budgetNotes),
    packingNotes: asStringArray(record.packingNotes),
    risks: asStringArray(record.risks),
  };

  return tripGuidePayloadSchema.parse({
    ...withoutMarkdown,
    markdown: asString(record.markdown) || buildMarkdown(withoutMarkdown),
  });
}

function buildTripGuideConfirmationPrompt(input: TripGuideInput) {
  return [
    "你是 Map of Us 的旅行攻略规划助手。你的任务不是直接生成攻略，而是判断用户信息是否足够生成高质量旅行攻略。",
    "",
    "用户输入：",
    `- 出发地：${input.origin}`,
    `- 目的地：${input.destination}`,
    `- 天数：${input.days}`,
    `- 日期：${input.startDate} 至 ${input.endDate}`,
    `- 偏好：${input.preferences}`,
    "",
    "请只返回 JSON，不要输出解释、Markdown、代码块或工具日志。",
    "",
    "如果信息足够，返回：",
    "{\"status\":\"ready\",\"normalizedInput\":{\"origin\":\"\",\"destination\":\"\",\"days\":3,\"startDate\":\"\",\"endDate\":\"\",\"preferences\":\"\",\"transportPreference\":\"flight_first\",\"travelStyle\":\"balanced\"},\"questions\":[]}",
    "",
    "如果信息不足，最多提出 3 个确认问题：",
    "{\"status\":\"needs_confirmation\",\"normalizedInput\":{\"origin\":\"\",\"destination\":\"\",\"days\":3,\"startDate\":\"\",\"endDate\":\"\",\"preferences\":\"\",\"transportPreference\":\"unknown\",\"travelStyle\":\"balanced\"},\"questions\":[{\"id\":\"transportPreference\",\"question\":\"这次是否优先坐飞机，还是高铁也可以？\",\"options\":[\"飞机优先\",\"高铁优先\",\"都可以，选更省时间的\"]}]}",
    "",
    "规则：",
    "- 不要调用 shell。",
    "- 不要输出自然语言解释。",
    "- 不要重复用户输入。",
    "- 不确定日期可以留空。",
  ].join("\n");
}

function buildTripGuideGenerationPrompt(input: TripGuideInput) {
  return [
    "你是 Map of Us 的情侣旅行攻略规划助手。请基于用户确认后的信息，生成适合直接保存到应用里的旅行攻略草稿。",
    "",
    "用户确认信息：",
    JSON.stringify(input, null, 2),
    "",
    "可使用已配置的地图、机票、铁路或地点查询能力辅助判断路线。但最终只返回一个 JSON 对象，不要输出解释、Markdown 代码块、工具调用日志、错误日志或重复内容。",
    "",
    "必须返回以下结构：",
    "{\"title\":\"\",\"origin\":\"\",\"destination\":\"\",\"days\":3,\"startDate\":\"\",\"endDate\":\"\",\"travelStyle\":\"relaxed|balanced|packed\",\"transport\":{\"summary\":\"\",\"outbound\":[],\"returnTrip\":[],\"local\":[],\"warnings\":[]},\"daysPlan\":[{\"day\":1,\"title\":\"\",\"theme\":\"\",\"morning\":[],\"afternoon\":[],\"evening\":[],\"checkpoints\":[{\"name\":\"\",\"city\":\"\",\"reason\":\"\",\"suggestedDuration\":\"\",\"tips\":\"\"}],\"food\":[],\"notes\":\"\"}],\"budgetNotes\":[],\"packingNotes\":[],\"risks\":[],\"markdown\":\"\"}",
    "",
    "内容要求：",
    "- 用中文。",
    "- markdown 是给用户阅读的完整攻略，结构清晰，但不要包含 JSON。",
    "- daysPlan 必须和 days 数量一致。",
    "- 每天安排控制在 3-5 个核心地点，不要塞满。",
    "- 如果目的地没有机场，要明确建议最近可落地机场和后续交通。",
    "- 如果无法确认实时航班或车次，只写“建议查询当天班次”，不要编造具体航班号或车次。",
    "- 输出必须是合法 JSON。",
  ].join("\n");
}

function serializeJob(job: {
  id: string;
  status: string;
  input: Prisma.JsonValue;
  result: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    status: job.status,
    input: job.input,
    result: job.result ?? undefined,
    error: job.error ?? undefined,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function serializeDraft(draft: {
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
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

async function runTripGuideJob(jobId: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: "running", error: null } });
    const input = normalizeTripGuideInput(job.input as JsonRecord);
    const raw = await callAstrBotText({
      username: astrBotUsername(job.spaceId, job.userId ?? "unknown"),
      sessionId: `trip-guide:${job.spaceId}:${job.userId ?? "unknown"}:${job.id}`,
      message: buildTripGuideGenerationPrompt(input),
    });

    if (!raw || hasToolFailure(raw)) throw new Error("AstrBot returned an unusable travel plan");

    const json = extractJsonObject(raw, (candidate) => tripGuidePayloadSchema.safeParse(normalizeTripGuidePayload(input, candidate)).success);
    const payload = normalizeTripGuidePayload(input, json ?? {});
    const draft = await prisma.aiDraft.create({
      data: {
        spaceId: job.spaceId,
        userId: job.userId,
        kind: "trip_plan",
        payload: payload as Prisma.InputJsonValue,
        source: { raw },
      },
    });

    const result = {
      draftId: draft.id,
      draft: serializeDraft(draft),
    };
    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        error: null,
      },
    });
  } catch (error) {
    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Trip guide generation failed",
      },
    });
  }
}

async function readTripGuideConfirmation(input: TripGuideInput, auth: { spaceId: string; userId: string }) {
  try {
    const raw = await callAstrBotText({
      username: astrBotUsername(auth.spaceId, auth.userId),
      sessionId: `trip-guide-confirm:${auth.spaceId}:${auth.userId}`,
      message: buildTripGuideConfirmationPrompt(input),
    });
    if (!raw || hasToolFailure(raw)) throw new Error("Invalid AstrBot confirmation");
    const json = extractJsonObject(raw);
    const normalizedInput = normalizeTripGuideInput(isRecord(json?.normalizedInput) ? json.normalizedInput : input);
    const questions = Array.isArray(json?.questions)
      ? json.questions.filter(isRecord).map((question) => ({
          id: asString(question.id),
          question: asString(question.question),
          options: asStringArray(question.options),
        })).filter((question) => question.id && question.question && question.options.length)
      : [];
    if (json?.status === "ready" && questions.length === 0) return { status: "ready" as const, normalizedInput, questions: [] };
    return { status: "needs_confirmation" as const, normalizedInput, questions: questions.slice(0, 3) };
  } catch {
    const questions = localTripGuideQuestions(input);
    return {
      status: questions.length ? "needs_confirmation" as const : "ready" as const,
      normalizedInput: input,
      questions,
    };
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

  app.post("/ai/memory-polish", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as {
      sourceText?: unknown;
      cityId?: unknown;
      city?: unknown;
      date?: unknown;
    } | null;
    const sourceText = asString(payload?.sourceText);
    if (!sourceText) return reply.code(400).send({ error: "Invalid memory polish payload" });

    const raw = await callAstrBotText({
      username: astrBotUsername(auth.spaceId, auth.userId),
      sessionId: `memory-polish:${auth.spaceId}:${auth.userId}`,
      message: buildMemoryPolishPrompt({
        sourceText,
        cityId: asString(payload?.cityId) || undefined,
        city: asString(payload?.city) || undefined,
        date: asString(payload?.date) || undefined,
      }),
    });

    const polishedText = cleanPolishedMemory(raw);
    if (!polishedText || hasToolFailure(raw)) {
      return reply.code(502).send({ error: "Memory polish failed" });
    }

    return { polishedText };
  });

  app.post("/ai/trip-guide/jobs", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as JsonRecord | null;
    const input = normalizeTripGuideInput(payload ?? {});
    if (!input.origin || !input.destination) return reply.code(400).send({ error: "Invalid trip guide job payload" });

    const confirmation = await readTripGuideConfirmation(input, auth);
    const job = await prisma.aiJob.create({
      data: {
        spaceId: auth.spaceId,
        userId: auth.userId,
        type: "trip_plan",
        status: confirmation.status === "needs_confirmation" ? "needs_confirmation" : "running",
        input: confirmation.normalizedInput as Prisma.InputJsonValue,
        result: confirmation.status === "needs_confirmation"
          ? { normalizedInput: confirmation.normalizedInput, questions: confirmation.questions } as Prisma.InputJsonValue
          : Prisma.JsonNull,
      },
    });

    if (confirmation.status === "ready") void runTripGuideJob(job.id);
    return { job: serializeJob(job) };
  });

  app.get("/ai/trip-guide/jobs/:id", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const job = await prisma.aiJob.findFirst({ where: { id, spaceId: auth.spaceId, type: "trip_plan" } });
    if (!job) return reply.code(404).send({ error: "Trip guide job not found" });
    return { job: serializeJob(job) };
  });

  app.post("/ai/trip-guide/jobs/:id/confirm", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const job = await prisma.aiJob.findFirst({ where: { id, spaceId: auth.spaceId, type: "trip_plan" } });
    if (!job) return reply.code(404).send({ error: "Trip guide job not found" });
    if (job.status !== "needs_confirmation") return reply.code(400).send({ error: "Trip guide job does not need confirmation" });

    const payload = request.body as { answers?: unknown } | null;
    const answers = isRecord(payload?.answers) ? payload.answers : {};
    const input = mapConfirmationAnswers(normalizeTripGuideInput(job.input as JsonRecord), answers);
    const updated = await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        input: input as Prisma.InputJsonValue,
        result: Prisma.JsonNull,
        error: null,
      },
    });
    void runTripGuideJob(job.id);
    return { job: serializeJob(updated) };
  });

  app.post("/ai/trip-guide/jobs/:id/save-draft", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const job = await prisma.aiJob.findFirst({ where: { id, spaceId: auth.spaceId, type: "trip_plan" } });
    if (!job) return reply.code(404).send({ error: "Trip guide job not found" });
    if (job.status !== "completed" || !isRecord(job.result)) {
      return reply.code(400).send({ error: "Trip guide job is not completed" });
    }
    const draftId = asString(job.result.draftId);
    const draft = draftId
      ? await prisma.aiDraft.findFirst({ where: { id: draftId, spaceId: auth.spaceId, kind: "trip_plan" } })
      : null;
    if (!draft) return reply.code(404).send({ error: "Trip guide draft not found" });
    return { draft: serializeDraft(draft) };
  });

  app.post("/ai/trip-plans", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const payload = request.body as JsonRecord | null;
    const input = normalizeTripGuideInput(payload ?? {});
    if (!input.origin || !input.destination) return reply.code(400).send({ error: "Invalid trip plan payload" });

    const raw = await callAstrBotText({
      username: astrBotUsername(auth.spaceId, auth.userId),
      sessionId: `trip-plan:${auth.spaceId}:${auth.userId}`,
      message: buildTripGuideGenerationPrompt(input),
    });
    const json = !raw || hasToolFailure(raw) ? null : extractJsonObject(raw);
    const guide = normalizeTripGuidePayload(input, json ?? {});
    const draft = await prisma.aiDraft.create({
      data: {
        spaceId: auth.spaceId,
        userId: auth.userId,
        kind: "trip_plan",
        payload: guide as Prisma.InputJsonValue,
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
      const parsed = tripGuidePayloadSchema.safeParse(draft.payload);
      const payload = parsed.success ? parsed.data : (draft.payload as Record<string, unknown>);
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
