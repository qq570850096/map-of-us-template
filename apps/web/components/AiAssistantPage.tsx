"use client";

import { useState } from "react";
import { Bot, Check, Loader2, MapPinned, Sparkles } from "lucide-react";
import { MemoryPageShell } from "@/components/MemoryNav";
import { apiJson } from "@/lib/apiClient";

type MemoryDraft = {
  id: string;
  status: string;
  cityId?: string;
  date?: string;
  title?: string;
  text?: string;
  tags?: string[];
};

type TripDraft = {
  id: string;
  status: string;
  title?: string;
  summary?: string;
  checkpoints?: string[];
  transportNotes?: string[];
};

export default function AiAssistantPage() {
  const [memoryText, setMemoryText] = useState("");
  const [destination, setDestination] = useState("");
  const [preferences, setPreferences] = useState("");
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft | null>(null);
  const [tripDraft, setTripDraft] = useState<TripDraft | null>(null);
  const [working, setWorking] = useState<"memory" | "trip" | "accept" | null>(null);
  const [status, setStatus] = useState("");

  const createMemoryDraft = async () => {
    if (!memoryText.trim() || working) return;
    setWorking("memory");
    setStatus("");
    try {
      const data = await apiJson<{ draft: MemoryDraft }>("/ai/memory-drafts", {
        method: "POST",
        body: JSON.stringify({ sourceText: memoryText }),
      });
      setMemoryDraft(data.draft);
    } catch {
      setStatus("AI 回忆草稿生成失败，请检查 AstrBot 服务和 API Key。");
    } finally {
      setWorking(null);
    }
  };

  const createTripDraft = async () => {
    if (!destination.trim() || working) return;
    setWorking("trip");
    setStatus("");
    try {
      const data = await apiJson<{ draft: TripDraft }>("/ai/trip-plans", {
        method: "POST",
        body: JSON.stringify({ destination, preferences }),
      });
      setTripDraft(data.draft);
    } catch {
      setStatus("AI 旅行规划生成失败，请检查 AstrBot agent/MCP 配置。");
    } finally {
      setWorking(null);
    }
  };

  const acceptDraft = async (id: string) => {
    setWorking("accept");
    setStatus("");
    try {
      await apiJson<{ ok: true }>(`/ai/drafts/${id}/accept`, { method: "POST" });
      setStatus("草稿已确认保存。");
    } catch {
      setStatus("草稿确认失败，请稍后再试。");
    } finally {
      setWorking(null);
    }
  };

  return (
    <MemoryPageShell active="ai">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-3">
            <Bot className="h-8 w-8 text-[#A8C8DC]" />
            <h1 className="text-[34px] font-semibold leading-tight text-[#5A6670]">AI 旅行助手</h1>
          </div>
          <p className="mt-2 text-sm font-medium text-[#5A6670]/58">
            通过后端代理 AstrBot agent，生成回忆草稿、旅行规划和打卡点建议。
          </p>
        </div>
      </header>

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <article className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-5 shadow-[0_12px_28px_rgba(90,102,112,0.06)]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#E8B8C2]" />
            <h2 className="text-lg font-semibold text-[#5A6670]">旅行记录帮记</h2>
          </div>
          <textarea
            className="mt-4 min-h-36 w-full resize-none rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#E8B8C2]"
            value={memoryText}
            onChange={(event) => setMemoryText(event.target.value)}
            placeholder="把零散记忆写在这里，比如：昨天在杭州西湖边散步，傍晚风很舒服，拍了好多照片..."
          />
          <button
            className="mt-3 inline-flex items-center gap-2 rounded-[7px] bg-[#F5DCE0] px-4 py-2 text-sm font-semibold text-[#E8B8C2] transition hover:bg-[#E8B8C2] hover:text-[#FAFBF7] disabled:opacity-50"
            type="button"
            onClick={createMemoryDraft}
            disabled={working !== null || !memoryText.trim()}
          >
            {working === "memory" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            生成回忆草稿
          </button>

          {memoryDraft && (
            <div className="mt-5 rounded-[7px] border border-[#D8DDD8]/72 bg-white/46 p-4">
              <p className="text-xs font-semibold text-[#5A6670]/48">{memoryDraft.date || "待确认日期"}</p>
              <h3 className="mt-2 text-lg font-semibold text-[#5A6670]">{memoryDraft.title || "旅行回忆"}</h3>
              <p className="mt-2 text-sm leading-6 text-[#5A6670]/72">{memoryDraft.text}</p>
              {memoryDraft.tags?.length ? (
                <p className="mt-3 text-xs text-[#A8C8DC]">{memoryDraft.tags.join(" / ")}</p>
              ) : null}
              <button
                className="mt-4 inline-flex items-center gap-2 rounded-[7px] border border-[#A8C8DC] px-3 py-2 text-xs font-semibold text-[#A8C8DC]"
                type="button"
                onClick={() => acceptDraft(memoryDraft.id)}
                disabled={working !== null}
              >
                <Check className="h-4 w-4" />
                确认草稿
              </button>
            </div>
          )}
        </article>

        <article className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-5 shadow-[0_12px_28px_rgba(90,102,112,0.06)]">
          <div className="flex items-center gap-2">
            <MapPinned className="h-5 w-5 text-[#A8C8DC]" />
            <h2 className="text-lg font-semibold text-[#5A6670]">旅行规划和打卡点</h2>
          </div>
          <input
            className="mt-4 min-h-10 w-full rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 text-sm outline-none transition focus:border-[#E8B8C2]"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="目的地，比如 成都 / 杭州三日游 / 青岛周末"
          />
          <textarea
            className="mt-3 min-h-24 w-full resize-none rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#E8B8C2]"
            value={preferences}
            onChange={(event) => setPreferences(event.target.value)}
            placeholder="偏好，比如少走路、想坐高铁、需要查机票、喜欢拍照和咖啡店..."
          />
          <button
            className="mt-3 inline-flex items-center gap-2 rounded-[7px] bg-[#D6E8F0] px-4 py-2 text-sm font-semibold text-[#5A6670] transition hover:bg-[#A8C8DC] hover:text-white disabled:opacity-50"
            type="button"
            onClick={createTripDraft}
            disabled={working !== null || !destination.trim()}
          >
            {working === "trip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />}
            生成旅行规划
          </button>

          {tripDraft && (
            <div className="mt-5 rounded-[7px] border border-[#D8DDD8]/72 bg-white/46 p-4">
              <h3 className="text-lg font-semibold text-[#5A6670]">{tripDraft.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#5A6670]/72">{tripDraft.summary}</p>
              {tripDraft.checkpoints?.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#5A6670]/72">
                  {tripDraft.checkpoints.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {tripDraft.transportNotes?.length ? (
                <p className="mt-3 text-xs leading-5 text-[#A8C8DC]">{tripDraft.transportNotes.join(" / ")}</p>
              ) : null}
              <button
                className="mt-4 inline-flex items-center gap-2 rounded-[7px] border border-[#A8C8DC] px-3 py-2 text-xs font-semibold text-[#A8C8DC]"
                type="button"
                onClick={() => acceptDraft(tripDraft.id)}
                disabled={working !== null}
              >
                <Check className="h-4 w-4" />
                确认规划
              </button>
            </div>
          )}
        </article>
      </section>

      {status && <p className="mt-5 rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/72 px-4 py-3 text-sm text-[#5A6670]/66">{status}</p>}
    </MemoryPageShell>
  );
}
