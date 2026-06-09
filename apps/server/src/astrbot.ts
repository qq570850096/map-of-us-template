import { config } from "./config.js";

type AstrBotMessage =
  | string
  | Array<
      | { type: "plain"; text: string }
      | { type: "file" | "image" | "record" | "video"; attachment_id: string }
    >;

export function astrBotUsername(spaceId: string, userId: string) {
  return `mapofus:${spaceId}:${userId}`;
}

function ensureAstrBotConfigured() {
  if (!config.ASTRBOT_BASE_URL || !config.ASTRBOT_API_KEY) {
    throw new Error("AstrBot is not configured");
  }
}

export async function callAstrBotStream({
  username,
  sessionId,
  message,
  signal,
}: {
  username: string;
  sessionId?: string;
  message: AstrBotMessage;
  signal?: AbortSignal;
}) {
  ensureAstrBotConfigured();
  const response = await fetch(`${config.ASTRBOT_BASE_URL?.replace(/\/$/, "")}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.ASTRBOT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      session_id: sessionId,
      message,
      enable_streaming: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const messageText = await response.text().catch(() => "");
    throw new Error(`AstrBot chat failed (${response.status}): ${messageText || response.statusText}`);
  }

  return response;
}

type AstrBotSseText =
  | { kind: "delta"; text: string }
  | { kind: "complete"; text: string };

function stringFromData(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (typeof record.message === "string") return record.message;
  return "";
}

function extractTextFromSseData(data: string): AstrBotSseText | null {
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (typeof parsed === "string") return { kind: "delta", text: parsed };
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;

    const eventType = typeof record.type === "string" ? record.type : "";
    if (eventType === "plain") {
      const text = stringFromData(record.data) || stringFromData(record);
      return text ? { kind: "delta", text } : null;
    }
    if (eventType === "complete") {
      const text = stringFromData(record.data) || stringFromData(record);
      return text ? { kind: "complete", text } : null;
    }
    if (eventType) return null;

    for (const key of ["delta", "text", "content", "message"]) {
      if (typeof record[key] === "string") return { kind: "delta", text: record[key] as string };
    }
    const text = stringFromData(record.data);
    return text ? { kind: "delta", text } : null;
  } catch {
    return { kind: "delta", text: data };
  }
}

export async function callAstrBotText(input: {
  username: string;
  sessionId?: string;
  message: AstrBotMessage;
  signal?: AbortSignal;
}) {
  const response = await callAstrBotStream(input);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let completeOutput = "";

  const collectLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const extracted = extractTextFromSseData(line.slice(5).trim());
    if (!extracted) return;
    if (extracted.kind === "complete") {
      completeOutput = extracted.text;
      return;
    }
    output += extracted.text;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split(/\r?\n/)) {
        collectLine(line);
      }
    }
  }

  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) {
      collectLine(line);
    }
  }

  return (output || completeOutput).trim();
}
