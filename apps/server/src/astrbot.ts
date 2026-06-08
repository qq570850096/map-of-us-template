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

function extractTextFromSseData(data: string) {
  if (!data || data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as unknown;
    if (typeof parsed === "string") return parsed;
    if (typeof parsed !== "object" || parsed === null) return "";
    const record = parsed as Record<string, unknown>;
    for (const key of ["text", "content", "message", "delta"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    if (typeof record.data === "string") return record.data;
    if (typeof record.data === "object" && record.data !== null) {
      const dataRecord = record.data as Record<string, unknown>;
      if (typeof dataRecord.text === "string") return dataRecord.text;
      if (typeof dataRecord.content === "string") return dataRecord.content;
    }
    return "";
  } catch {
    return data;
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith("data:")) output += extractTextFromSseData(line.slice(5).trim());
      }
    }
  }

  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith("data:")) output += extractTextFromSseData(line.slice(5).trim());
    }
  }

  return output.trim();
}
