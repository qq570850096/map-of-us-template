"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Loader2,
  MapPinned,
  Plus,
  Route,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { MemoryPageShell } from "@/components/MemoryNav";
import { apiJson } from "@/lib/apiClient";

type TravelStyle = "relaxed" | "balanced" | "packed";
type JobStatus = "queued" | "running" | "needs_confirmation" | "completed" | "failed";

type TripCheckpoint = {
  name: string;
  city?: string;
  reason: string;
  suggestedDuration?: string;
  tips?: string;
};

type TripDay = {
  day: number;
  title: string;
  theme: string;
  morning: string[];
  afternoon: string[];
  evening: string[];
  checkpoints: TripCheckpoint[];
  food: string[];
  notes?: string;
};

type TripPayload = {
  title: string;
  origin: string;
  destination: string;
  days: number;
  startDate?: string;
  endDate?: string;
  travelStyle: TravelStyle;
  transport: {
    summary: string;
    outbound: string[];
    returnTrip: string[];
    local: string[];
    warnings: string[];
  };
  daysPlan: TripDay[];
  budgetNotes: string[];
  packingNotes: string[];
  risks: string[];
  markdown: string;
};

type TripGuide = {
  id: string;
  payload: TripPayload;
  createdAt?: string;
  updatedAt?: string;
};

type TripDraft = {
  id: string;
  status: string;
  payload: TripPayload;
  createdAt?: string;
  updatedAt?: string;
};

type SelectedItem =
  | { kind: "guide"; id: string; payload: TripPayload }
  | { kind: "draft"; id: string; payload: TripPayload }
  | { kind: "new"; id: string; payload: TripPayload };

type AiQuestion = {
  id: string;
  question: string;
  options: string[];
};

type AiJob = {
  id: string;
  status: JobStatus;
  result?: {
    normalizedInput?: unknown;
    questions?: AiQuestion[];
    draft?: TripDraft;
    draftId?: string;
  };
  error?: string;
};

const emptyPayload = (): TripPayload => ({
  title: "新的旅行攻略",
  origin: "",
  destination: "",
  days: 3,
  startDate: "",
  endDate: "",
  travelStyle: "balanced",
  transport: {
    summary: "",
    outbound: [""],
    returnTrip: [""],
    local: [""],
    warnings: [""],
  },
  daysPlan: Array.from({ length: 3 }, (_, index) => emptyDay(index + 1)),
  budgetNotes: [""],
  packingNotes: [""],
  risks: [""],
  markdown: "",
});

function emptyDay(day: number): TripDay {
  return {
    day,
    title: `第 ${day} 天`,
    theme: "",
    morning: [""],
    afternoon: [""],
    evening: [""],
    checkpoints: [{ name: "", reason: "", city: "", suggestedDuration: "", tips: "" }],
    food: [""],
    notes: "",
  };
}

function cleanLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function normalizePayload(payload: Partial<TripPayload> | undefined): TripPayload {
  const days = Math.max(1, Math.min(30, Number(payload?.days) || 3));
  const daysPlan = Array.from({ length: days }, (_, index) => {
    const raw = payload?.daysPlan?.[index];
    return {
      ...emptyDay(index + 1),
      ...raw,
      day: index + 1,
      morning: raw?.morning?.length ? raw.morning : [""],
      afternoon: raw?.afternoon?.length ? raw.afternoon : [""],
      evening: raw?.evening?.length ? raw.evening : [""],
      checkpoints: raw?.checkpoints?.length ? raw.checkpoints : [{ name: "", reason: "", city: "", suggestedDuration: "", tips: "" }],
      food: raw?.food?.length ? raw.food : [""],
    };
  });
  return {
    ...emptyPayload(),
    ...payload,
    days,
    travelStyle: payload?.travelStyle ?? "balanced",
    transport: {
      ...emptyPayload().transport,
      ...payload?.transport,
      outbound: payload?.transport?.outbound?.length ? payload.transport.outbound : [""],
      returnTrip: payload?.transport?.returnTrip?.length ? payload.transport.returnTrip : [""],
      local: payload?.transport?.local?.length ? payload.transport.local : [""],
      warnings: payload?.transport?.warnings?.length ? payload.transport.warnings : [""],
    },
    daysPlan,
    budgetNotes: payload?.budgetNotes?.length ? payload.budgetNotes : [""],
    packingNotes: payload?.packingNotes?.length ? payload.packingNotes : [""],
    risks: payload?.risks?.length ? payload.risks : [""],
  };
}

function payloadForSave(payload: TripPayload): TripPayload {
  return {
    ...payload,
    days: Math.max(1, Math.min(30, Number(payload.days) || 1)),
    transport: {
      summary: payload.transport.summary.trim(),
      outbound: cleanLines(payload.transport.outbound),
      returnTrip: cleanLines(payload.transport.returnTrip),
      local: cleanLines(payload.transport.local),
      warnings: cleanLines(payload.transport.warnings),
    },
    daysPlan: payload.daysPlan.slice(0, payload.days).map((day, index) => ({
      ...day,
      day: index + 1,
      morning: cleanLines(day.morning),
      afternoon: cleanLines(day.afternoon),
      evening: cleanLines(day.evening),
      checkpoints: day.checkpoints
        .map((checkpoint) => ({
          ...checkpoint,
          name: checkpoint.name.trim(),
          city: checkpoint.city?.trim() || undefined,
          reason: checkpoint.reason.trim(),
          suggestedDuration: checkpoint.suggestedDuration?.trim() || undefined,
          tips: checkpoint.tips?.trim() || undefined,
        }))
        .filter((checkpoint) => checkpoint.name),
      food: cleanLines(day.food),
      notes: day.notes?.trim() || undefined,
    })),
    budgetNotes: cleanLines(payload.budgetNotes),
    packingNotes: cleanLines(payload.packingNotes),
    risks: cleanLines(payload.risks),
    markdown: payload.markdown.trim(),
  };
}

function updateArray<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

export default function TripGuidesPage() {
  const [guides, setGuides] = useState<TripGuide[]>([]);
  const [drafts, setDrafts] = useState<TripDraft[]>([]);
  const [selected, setSelected] = useState<SelectedItem>({ kind: "new", id: "new", payload: emptyPayload() });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const applyTripGuideResponse = (data: { guides: TripGuide[]; drafts: TripDraft[] }) => {
    const nextGuides = data.guides.map((guide) => ({ ...guide, payload: normalizePayload(guide.payload) }));
    const nextDrafts = data.drafts.map((draft) => ({ ...draft, payload: normalizePayload(draft.payload) }));
    setGuides(nextGuides);
    setDrafts(nextDrafts);
    setSelected((current) => {
      if (current.kind === "new") return current;
      const source = current.kind === "guide" ? nextGuides.find((item) => item.id === current.id) : nextDrafts.find((item) => item.id === current.id);
      return source ? { kind: current.kind, id: source.id, payload: source.payload } : { kind: "new", id: "new", payload: emptyPayload() };
    });
  };

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await apiJson<{ guides: TripGuide[]; drafts: TripDraft[] }>("/trip-guides");
      applyTripGuideResponse(data);
    } catch {
      setStatus("旅行攻略加载失败，请确认后端服务可用。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiJson<{ guides: TripGuide[]; drafts: TripDraft[] }>("/trip-guides")
      .then((data) => {
        if (!cancelled) applyTripGuideResponse(data);
      })
      .catch(() => {
        if (!cancelled) setStatus("旅行攻略加载失败，请确认后端服务可用。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const listItems = useMemo(
    () => [
      ...drafts.map((draft) => ({ kind: "draft" as const, id: draft.id, payload: draft.payload })),
      ...guides.map((guide) => ({ kind: "guide" as const, id: guide.id, payload: guide.payload })),
    ],
    [drafts, guides],
  );

  const setPayload = (payload: TripPayload) => setSelected((current) => ({ ...current, payload: normalizePayload(payload) }));

  const save = async () => {
    const payload = payloadForSave(selected.payload);
    if (!payload.title.trim()) {
      setStatus("标题不能为空。");
      return;
    }
    setWorking("save");
    setStatus("");
    try {
      if (selected.kind === "guide") {
        const data = await apiJson<{ guide: TripGuide }>(`/trip-guides/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({ payload }),
        });
        setSelected({ kind: "guide", id: data.guide.id, payload: normalizePayload(data.guide.payload) });
      } else if (selected.kind === "draft") {
        const data = await apiJson<{ draft: TripDraft }>(`/trip-guide-drafts/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({ payload }),
        });
        setSelected({ kind: "draft", id: data.draft.id, payload: normalizePayload(data.draft.payload) });
      } else {
        const data = await apiJson<{ guide: TripGuide }>("/trip-guides", {
          method: "POST",
          body: JSON.stringify({ payload }),
        });
        setSelected({ kind: "guide", id: data.guide.id, payload: normalizePayload(data.guide.payload) });
      }
      setStatus("旅行攻略已保存。");
      await load();
    } catch {
      setStatus("保存失败，请检查内容后重试。");
    } finally {
      setWorking(null);
    }
  };

  const acceptDraft = async () => {
    if (selected.kind !== "draft") return;
    setWorking("accept");
    setStatus("");
    try {
      await apiJson<{ ok: true; guide: TripGuide }>(`/trip-guide-drafts/${selected.id}/accept`, { method: "POST" });
      setStatus("草稿已保存为正式攻略。");
      setSelected({ kind: "new", id: "new", payload: emptyPayload() });
      await load();
    } catch {
      setStatus("草稿保存失败，请稍后再试。");
    } finally {
      setWorking(null);
    }
  };

  const remove = async () => {
    if (selected.kind === "new") {
      setSelected({ kind: "new", id: "new", payload: emptyPayload() });
      return;
    }
    setWorking("delete");
    setStatus("");
    try {
      await apiJson<{ ok: true }>(
        selected.kind === "guide" ? `/trip-guides/${selected.id}` : `/trip-guide-drafts/${selected.id}`,
        { method: "DELETE" },
      );
      setSelected({ kind: "new", id: "new", payload: emptyPayload() });
      setStatus("旅行攻略已删除。");
      await load();
    } catch {
      setStatus("删除失败，请稍后再试。");
    } finally {
      setWorking(null);
    }
  };

  return (
    <MemoryPageShell active="trips">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Route className="h-7 w-7 text-[#A8C8DC]" />
            <h1 className="text-2xl font-semibold leading-tight text-[#5A6670] sm:text-[34px]">旅行攻略</h1>
          </div>
          <p className="mt-2 hidden text-sm font-medium text-[#5A6670]/58 sm:block">
            把 AI 规划和手动整理的路线，保存成可编辑的旅行草稿。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[#A8C8DC] bg-white/54 px-4 text-sm font-semibold text-[#5A6670] transition hover:bg-[#D6E8F0]"
            type="button"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            AI 生成攻略
          </button>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82]"
            type="button"
            onClick={() => setSelected({ kind: "new", id: "new", payload: emptyPayload() })}
          >
            <Plus className="h-4 w-4" />
            新增
          </button>
        </div>
      </header>

      <section className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/78 p-3 shadow-[0_12px_28px_rgba(90,102,112,0.06)]">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm font-semibold text-[#5A6670]">攻略列表</p>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-[#A8C8DC]" /> : null}
          </div>
          <div className="mt-3 space-y-2">
            {listItems.length ? (
              listItems.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  className={`flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-3 text-left transition ${
                    selected.kind === item.kind && selected.id === item.id
                      ? "border-[#F5DCE0] bg-[#F5DCE0]/46"
                      : "border-[#D8DDD8]/64 bg-white/42 hover:bg-white/70"
                  }`}
                  type="button"
                  onClick={() => setSelected({ kind: item.kind, id: item.id, payload: normalizePayload(item.payload) })}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#5A6670]">{item.payload.title}</span>
                    <span className="mt-1 block truncate text-xs text-[#5A6670]/52">
                      {item.kind === "draft" ? "草稿" : "已保存"} · {item.payload.origin || "出发地"} → {item.payload.destination || "目的地"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#A8C8DC]" />
                </button>
              ))
            ) : (
              <div className="rounded-[8px] border border-dashed border-[#D8DDD8] px-3 py-8 text-center text-sm leading-6 text-[#5A6670]/58">
                还没有旅行攻略。可以手动新增，或让 AI 先生成一份草稿。
              </div>
            )}
          </div>
        </aside>

        <TripEditor
          selected={selected}
          working={working}
          onChange={setPayload}
          onSave={save}
          onAcceptDraft={acceptDraft}
          onDelete={remove}
        />
      </section>

      {status ? (
        <p className="mt-5 rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/72 px-4 py-3 text-sm text-[#5A6670]/66">{status}</p>
      ) : null}

      {aiOpen ? (
        <TripAiDialog
          onClose={() => setAiOpen(false)}
          onCreated={async (draft) => {
            setAiOpen(false);
            await load();
            setSelected({ kind: "draft", id: draft.id, payload: normalizePayload(draft.payload) });
            setStatus("AI 草稿已生成，可以继续编辑后保存。");
          }}
        />
      ) : null}
    </MemoryPageShell>
  );
}

function TripEditor({
  selected,
  working,
  onChange,
  onSave,
  onAcceptDraft,
  onDelete,
}: Readonly<{
  selected: SelectedItem;
  working: string | null;
  onChange: (payload: TripPayload) => void;
  onSave: () => void;
  onAcceptDraft: () => void;
  onDelete: () => void;
}>) {
  const payload = selected.payload;
  const change = (patch: Partial<TripPayload>) => onChange({ ...payload, ...patch });
  const changeTransport = (patch: Partial<TripPayload["transport"]>) => change({ transport: { ...payload.transport, ...patch } });
  const changeDay = (index: number, day: TripDay) => change({ daysPlan: updateArray(payload.daysPlan, index, day) });

  const setDays = (daysValue: number) => {
    const days = Math.max(1, Math.min(30, daysValue || 1));
    change({
      days,
      daysPlan: Array.from({ length: days }, (_, index) => payload.daysPlan[index] ?? emptyDay(index + 1)),
    });
  };

  return (
    <article className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/78 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A8C8DC]">
            {selected.kind === "draft" ? "AI 草稿" : selected.kind === "guide" ? "已保存攻略" : "新攻略"}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#5A6670]">{payload.title || "旅行攻略"}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.kind === "draft" ? (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[#A8C8DC] px-3 text-sm font-semibold text-[#5A6670] transition hover:bg-[#D6E8F0]"
              type="button"
              onClick={onAcceptDraft}
              disabled={working !== null}
            >
              {working === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存为攻略
            </button>
          ) : null}
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[#273846] px-3 text-sm font-semibold text-white transition hover:bg-[#D86F82]"
            type="button"
            onClick={onSave}
            disabled={working !== null}
          >
            {working === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[#D8DDD8] px-3 text-sm font-semibold text-[#5A6670]/70 transition hover:border-[#E8B8C2] hover:text-[#D86F82]"
            type="button"
            onClick={onDelete}
            disabled={working !== null}
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label="标题" value={payload.title} onChange={(value) => change({ title: value })} />
        <Field label="天数" type="number" value={String(payload.days)} onChange={(value) => setDays(Number(value))} />
        <Field label="出发地" value={payload.origin} onChange={(value) => change({ origin: value })} />
        <Field label="目的地" value={payload.destination} onChange={(value) => change({ destination: value })} />
        <Field label="开始日期" value={payload.startDate ?? ""} onChange={(value) => change({ startDate: value })} />
        <Field label="结束日期" value={payload.endDate ?? ""} onChange={(value) => change({ endDate: value })} />
      </div>

      <label className="mt-3 block text-xs font-semibold text-[#5A6670]/56">
        行程节奏
        <select
          className="mt-1 min-h-10 w-full rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
          value={payload.travelStyle}
          onChange={(event) => change({ travelStyle: event.target.value as TravelStyle })}
        >
          <option value="relaxed">轻松慢游</option>
          <option value="balanced">均衡安排</option>
          <option value="packed">尽量多打卡</option>
        </select>
      </label>

      <SectionTitle icon={Route} title="交通方案" />
      <Textarea label="交通摘要" value={payload.transport.summary} onChange={(value) => changeTransport({ summary: value })} />
      <LineEditor title="去程" lines={payload.transport.outbound} onChange={(lines) => changeTransport({ outbound: lines })} />
      <LineEditor title="返程" lines={payload.transport.returnTrip} onChange={(lines) => changeTransport({ returnTrip: lines })} />
      <LineEditor title="当地交通" lines={payload.transport.local} onChange={(lines) => changeTransport({ local: lines })} />
      <LineEditor title="交通提醒" lines={payload.transport.warnings} onChange={(lines) => changeTransport({ warnings: lines })} />

      <SectionTitle icon={MapPinned} title="每日安排" />
      <div className="space-y-4">
        {payload.daysPlan.map((day, index) => (
          <DayEditor
            key={day.day}
            day={day}
            onChange={(nextDay) => changeDay(index, nextDay)}
          />
        ))}
      </div>

      <SectionTitle icon={Sparkles} title="预算与提醒" />
      <LineEditor title="预算备注" lines={payload.budgetNotes} onChange={(lines) => change({ budgetNotes: lines })} />
      <LineEditor title="行李准备" lines={payload.packingNotes} onChange={(lines) => change({ packingNotes: lines })} />
      <LineEditor title="风险提醒" lines={payload.risks} onChange={(lines) => change({ risks: lines })} />
      <Textarea label="完整攻略 Markdown" value={payload.markdown} onChange={(value) => change({ markdown: value })} minHeight="min-h-40" />
    </article>
  );
}

function DayEditor({ day, onChange }: Readonly<{ day: TripDay; onChange: (day: TripDay) => void }>) {
  const change = (patch: Partial<TripDay>) => onChange({ ...day, ...patch });
  return (
    <section className="rounded-[8px] border border-[#D8DDD8]/72 bg-white/44 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Day ${day.day} 标题`} value={day.title} onChange={(value) => change({ title: value })} />
        <Field label="主题" value={day.theme} onChange={(value) => change({ theme: value })} />
      </div>
      <LineEditor title="上午" lines={day.morning} onChange={(lines) => change({ morning: lines })} />
      <LineEditor title="下午" lines={day.afternoon} onChange={(lines) => change({ afternoon: lines })} />
      <LineEditor title="晚上" lines={day.evening} onChange={(lines) => change({ evening: lines })} />
      <LineEditor title="美食" lines={day.food} onChange={(lines) => change({ food: lines })} />
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[#5A6670]/56">打卡点</p>
          <button
            className="rounded-[7px] border border-[#D8DDD8] px-2 py-1 text-xs font-semibold text-[#5A6670]/66"
            type="button"
            onClick={() => change({ checkpoints: [...day.checkpoints, { name: "", reason: "", city: "", suggestedDuration: "", tips: "" }] })}
          >
            添加打卡点
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {day.checkpoints.map((checkpoint, index) => (
            <div key={`${day.day}-${index}`} className="grid gap-2 rounded-[7px] border border-[#D8DDD8]/64 bg-[#FAFBF7]/76 p-2 sm:grid-cols-2">
              <Field label="名称" value={checkpoint.name} onChange={(value) => change({ checkpoints: updateArray(day.checkpoints, index, { ...checkpoint, name: value }) })} />
              <Field label="城市" value={checkpoint.city ?? ""} onChange={(value) => change({ checkpoints: updateArray(day.checkpoints, index, { ...checkpoint, city: value }) })} />
              <Field label="推荐理由" value={checkpoint.reason} onChange={(value) => change({ checkpoints: updateArray(day.checkpoints, index, { ...checkpoint, reason: value }) })} />
              <Field label="建议时长" value={checkpoint.suggestedDuration ?? ""} onChange={(value) => change({ checkpoints: updateArray(day.checkpoints, index, { ...checkpoint, suggestedDuration: value }) })} />
              <div className="sm:col-span-2">
                <Field label="提示" value={checkpoint.tips ?? ""} onChange={(value) => change({ checkpoints: updateArray(day.checkpoints, index, { ...checkpoint, tips: value }) })} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <Textarea label="当天备注" value={day.notes ?? ""} onChange={(value) => change({ notes: value })} />
    </section>
  );
}

function TripAiDialog({ onClose, onCreated }: Readonly<{ onClose: () => void; onCreated: (draft: TripDraft) => void }>) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState("3");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preferences, setPreferences] = useState("");
  const [job, setJob] = useState<AiJob | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(async () => {
      const data = await apiJson<{ job: AiJob }>(`/ai/trip-guide/jobs/${job.id}`).catch(() => null);
      if (!data?.job) return;
      setJob(data.job);
      if (data.job.status === "completed") {
        window.clearInterval(timer);
        const draft = data.job.result?.draft;
        if (draft) onCreated({ ...draft, payload: normalizePayload(draft.payload) });
      }
      if (data.job.status === "failed") {
        window.clearInterval(timer);
        setError(data.job.error || "AI 生成失败，可以调整需求后重试。");
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [job, onCreated]);

  const createJob = async () => {
    if (!origin.trim() || !destination.trim()) return;
    setWorking(true);
    setError("");
    try {
      const data = await apiJson<{ job: AiJob }>("/ai/trip-guide/jobs", {
        method: "POST",
        body: JSON.stringify({ origin, destination, days: Number(days) || 3, startDate, endDate, preferences }),
      });
      setJob(data.job);
      const questions = data.job.result?.questions ?? [];
      setAnswers(Object.fromEntries(questions.map((question) => [question.id, question.options[0] ?? ""])));
    } catch {
      setError("AI 任务创建失败，请检查 AstrBot 配置或稍后再试。");
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    if (!job) return;
    setWorking(true);
    setError("");
    try {
      const data = await apiJson<{ job: AiJob }>(`/ai/trip-guide/jobs/${job.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setJob(data.job);
    } catch {
      setError("确认失败，请重新生成。");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#273846]/32 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-[8px] border border-[#D8DDD8] bg-[#FAFBF7] p-5 shadow-[0_28px_90px_rgba(39,56,70,0.24)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-[#A8C8DC]" />
              <h2 className="text-xl font-semibold text-[#5A6670]">AI 生成旅行攻略</h2>
            </div>
            <p className="mt-1 text-sm text-[#5A6670]/58">先确认关键偏好，生成结果会进入草稿。</p>
          </div>
          <button className="rounded-[7px] px-3 py-2 text-sm font-semibold text-[#5A6670]/60 hover:bg-white/70" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        {!job ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="出发地" value={origin} onChange={setOrigin} />
            <Field label="目的地" value={destination} onChange={setDestination} />
            <Field label="天数" type="number" value={days} onChange={setDays} />
            <Field label="开始日期" value={startDate} onChange={setStartDate} />
            <Field label="结束日期" value={endDate} onChange={setEndDate} />
            <label className="block text-xs font-semibold text-[#5A6670]/56 sm:col-span-2">
              偏好
              <textarea
                className="mt-1 min-h-24 w-full resize-none rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 py-2 text-sm leading-6 text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="比如：飞过去之后玩三天、情侣慢游、想拍照、少走回头路。"
              />
            </label>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-50 sm:col-span-2"
              type="button"
              onClick={createJob}
              disabled={working || !origin.trim() || !destination.trim()}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成确认问题
            </button>
          </div>
        ) : null}

        {job?.status === "needs_confirmation" ? (
          <div className="mt-5 space-y-4">
            {(job.result?.questions ?? []).map((question) => (
              <label key={question.id} className="block text-sm font-semibold text-[#5A6670]">
                {question.question}
                <select
                  className="mt-2 min-h-10 w-full rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm outline-none transition focus:border-[#A8C8DC]"
                  value={answers[question.id] ?? question.options[0] ?? ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                >
                  {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            ))}
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-50"
              type="button"
              onClick={confirm}
              disabled={working}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              确认并生成草稿
            </button>
          </div>
        ) : null}

        {job?.status === "running" || job?.status === "queued" ? (
          <div className="mt-5 rounded-[8px] border border-[#D8DDD8]/72 bg-white/54 p-4 text-sm text-[#5A6670]/70">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-[#A8C8DC]" />
            AI 正在生成旅行攻略草稿，完成后会自动进入编辑器。
          </div>
        ) : null}

        {job?.status === "failed" || error ? (
          <div className="mt-5 rounded-[8px] border border-[#E8B8C2]/70 bg-[#F5DCE0]/34 p-4 text-sm leading-6 text-[#D86F82]">
            {error || job?.error || "AI 生成失败，可以稍后重试或手动新增攻略。"}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: Readonly<{ icon: typeof Route; title: string }>) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-2 border-t border-[#D8DDD8]/70 pt-5">
      <Icon className="h-4 w-4 text-[#A8C8DC]" />
      <h3 className="text-base font-semibold text-[#5A6670]">{title}</h3>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
}>) {
  return (
    <label className="block text-xs font-semibold text-[#5A6670]/56">
      {label}
      <input
        className="mt-1 min-h-10 w-full rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  minHeight = "min-h-24",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: string;
}>) {
  return (
    <label className="mt-3 block text-xs font-semibold text-[#5A6670]/56">
      {label}
      <textarea
        className={`mt-1 w-full resize-y rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 py-2 text-sm leading-6 text-[#5A6670] outline-none transition focus:border-[#A8C8DC] ${minHeight}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function LineEditor({ title, lines, onChange }: Readonly<{ title: string; lines: string[]; onChange: (lines: string[]) => void }>) {
  const visibleLines = lines.length ? lines : [""];
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[#5A6670]/56">{title}</p>
        <button
          className="rounded-[7px] border border-[#D8DDD8] px-2 py-1 text-xs font-semibold text-[#5A6670]/66"
          type="button"
          onClick={() => onChange([...visibleLines, ""])}
        >
          添加
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {visibleLines.map((line, index) => (
          <div key={`${title}-${index}`} className="flex gap-2">
            <input
              className="min-h-10 min-w-0 flex-1 rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
              value={line}
              onChange={(event) => onChange(updateArray(visibleLines, index, event.target.value))}
            />
            <button
              className="w-10 shrink-0 rounded-[7px] border border-[#D8DDD8] text-[#5A6670]/52 transition hover:border-[#E8B8C2] hover:text-[#D86F82]"
              type="button"
              onClick={() => onChange(visibleLines.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`删除${title}`}
            >
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
