"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CalendarDays,
  Download,
  Heart,
  LogOut,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  ShieldOff,
  Lock,
  Unlock,
  Trash2,
  Upload,
} from "lucide-react";
import { cities } from "@/data/cities";
import { MemoryPageShell, type MemoryNavKey } from "@/components/MemoryNav";
import {
  memoryStoreUpdatedEvent,
  type LocalMemoryStore,
} from "@/data/progress";
import {
  readAppSettings,
  saveAppSettings,
  syncAppSettings,
  defaultAnniversaryDate,
  defaultAnniversaryLabel,
  defaultCoupleLogo,
  defaultWeatherCityIds,
  maxWeatherCities,
  type AppSettings,
  type LoginPhotoText,
} from "@/data/appSettings";
import {
  deleteLoginPhotoText,
  deleteLoginPhoto,
  loginPhotosUpdatedEvent,
  readLoginPhotoTexts,
  readLoginPhotos,
  writeLoginPhotoText,
  writeLoginPhoto,
} from "@/data/loginPhotoStore";
import {
  loginStateUpdatedEvent,
} from "@/data/loginState";
import { LocalPrivacyImage } from "@/components/LocalPrivacyImage";
import { apiFetch, logout } from "@/lib/apiClient";
import { readSession } from "@/lib/authStore";
import {
  decryptAuxiliaryItems,
  encryptAuxiliaryForSave,
  fetchDecryptedMemoryStore,
} from "@/lib/privateData";
import {
  enablePrivacyKey,
  lockPrivacyKey,
  privacyStateUpdatedEvent,
  readPrivacyState,
  resetPrivacyKeyForThisDevice,
  unlockPrivacyKey,
} from "@/lib/e2ee";

type StoredItem = {
  id: string;
  title: string;
  date?: string;
  note: string;
  cityId?: string;
  payload?: unknown;
};
type CityAssetStore = Record<string, string>;
type AnniversaryRepeat = "none" | "yearly";
type AnniversaryPayload = {
  category?: string;
  repeat?: AnniversaryRepeat;
};
type AuxiliaryItem = StoredItem & {
  kind?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ToolConfig = {
  active: MemoryNavKey;
  icon: typeof Heart;
  title: string;
  subtitle: string;
  kind: "favorite" | "anniversary" | "capsule";
};

const configs = {
  favorite: {
    active: "favorites",
    icon: Heart,
    title: "地点收藏",
    subtitle: "先收好想一起去的地方，不点亮地图。",
    kind: "favorite",
  },
  anniversary: {
    active: "anniversaries",
    icon: CalendarDays,
    title: "纪念日",
    subtitle: "把重要的日子放在这里，慢慢倒数。",
    kind: "anniversary",
  },
  capsule: {
    active: "capsule",
    icon: Archive,
    title: "时光宝盒",
    subtitle: "存放不一定属于某座城市的小秘密。",
    kind: "capsule",
  },
} satisfies Record<string, ToolConfig>;

const loginPhotoVersion = "placeholder-20260601";
const loginPhotoFallback = (fileName: string) => `/photos/login/${fileName}.jpg?v=${loginPhotoVersion}`;

const loginPhotoSlots = [
  { id: "hangzhou", city: "杭州", label: "春日湖畔", fallback: loginPhotoFallback("hangzhou") },
  { id: "shanghai", city: "上海", label: "外滩傍晚", fallback: loginPhotoFallback("shanghai") },
  { id: "macau", city: "澳门", label: "旧城花影", fallback: loginPhotoFallback("macau") },
  { id: "hongkong", city: "香港", label: "夜色亮起", fallback: loginPhotoFallback("hongkong") },
  { id: "qingdao", city: "青岛", label: "海风经过", fallback: loginPhotoFallback("qingdao") },
  { id: "zhengzhou", city: "郑州", label: "见面那天", fallback: loginPhotoFallback("zhengzhou") },
  { id: "zhuhai", city: "珠海", label: "海边散步", fallback: loginPhotoFallback("zhuhai") },
  { id: "guangzhou", city: "广州", label: "旧街热气", fallback: loginPhotoFallback("guangzhou") },
  { id: "jinan", city: "济南", label: "泉边小记", fallback: loginPhotoFallback("jinan") },
] as const;

const useLoginState = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const syncLoginState = () => setIsLoggedIn(Boolean(readSession()));
    const timer = window.setTimeout(syncLoginState, 0);
    const handleLoginState = (event: Event) => {
      setIsLoggedIn(Boolean((event as CustomEvent<boolean>).detail));
    };

    window.addEventListener(loginStateUpdatedEvent, handleLoginState);
    window.addEventListener("storage", syncLoginState);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(loginStateUpdatedEvent, handleLoginState);
      window.removeEventListener("storage", syncLoginState);
    };
  }, []);

  return isLoggedIn;
};

const imageFileToSettingImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Invalid image"));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new window.Image();

    image.addEventListener("load", () => {
      const maxSize = 1800;
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      URL.revokeObjectURL(url);

      if (!context) {
        reject(new Error("Canvas unavailable"));
        return;
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    });

    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image read failed"));
    });

    image.src = url;
  });

const normalizeAppSettings = (value: unknown): AppSettings => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const settings = value as AppSettings & { loginCoverImage?: string };
  const loginPhotos =
    settings.loginPhotos && typeof settings.loginPhotos === "object" && !Array.isArray(settings.loginPhotos)
      ? Object.fromEntries(
          Object.entries(settings.loginPhotos).filter(
            ([key, photo]) =>
              loginPhotoSlots.some((slot) => slot.id === key) &&
              typeof photo === "string" &&
              photo.startsWith("data:image/"),
          ),
        )
      : {};
  const loginPhotoTexts =
    settings.loginPhotoTexts && typeof settings.loginPhotoTexts === "object" && !Array.isArray(settings.loginPhotoTexts)
      ? Object.fromEntries(
          Object.entries(settings.loginPhotoTexts)
            .filter(([key]) => loginPhotoSlots.some((slot) => slot.id === key))
            .map(([key, value]) => {
              if (typeof value !== "object" || value === null || Array.isArray(value)) return [key, {}];
              const item = value as LoginPhotoText;

              return [
                key,
                {
                  city: typeof item.city === "string" ? item.city : undefined,
                  label: typeof item.label === "string" ? item.label : undefined,
                },
              ];
            }),
        )
      : {};

  if (
    Object.keys(loginPhotos).length === 0 &&
    typeof settings.loginCoverImage === "string" &&
    settings.loginCoverImage.startsWith("data:image/")
  ) {
    return { loginPhotos: { hangzhou: settings.loginCoverImage }, loginPhotoTexts };
  }

  return { loginPhotos, loginPhotoTexts };
};

const daysUntil = (value?: string) => {
  if (!value || !/^\d{4}\.\d{2}\.\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split(".").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
};

const dotDateToInputDate = (value?: string) => {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(value ?? "");
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};

const inputDateToDotDate = (value: string) => value ? value.replaceAll("-", ".") : "";

const parseDotDate = (value?: string) => {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysSince = (value?: string) => {
  const start = parseDotDate(value);
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / 86_400_000);
};

const daysBetweenDotDatesInclusive = (startValue?: string, endValue?: string) => {
  const start = parseDotDate(startValue);
  const end = parseDotDate(endValue);
  if (!start || !end) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

const anniversaryPayload = (value: unknown): AnniversaryPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { repeat: "yearly", category: "纪念日" };
  const record = value as AnniversaryPayload;
  return {
    category: typeof record.category === "string" ? record.category : "纪念日",
    repeat: record.repeat === "none" ? "none" : "yearly",
  };
};

function MemoryToolPage({ config }: Readonly<{ config: ToolConfig }>) {
  const Icon = config.icon;
  const isLoggedIn = useLoginState();
  const [items, setItems] = useState<StoredItem[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [cityId, setCityId] = useState(cities[0]?.id ?? "");
  const [editingId, setEditingId] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    const response = await apiFetch(`/${config.kind === "favorite" ? "favorites" : config.kind === "anniversary" ? "anniversaries" : "capsules"}`, { cache: "no-store" }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { items?: StoredItem[] } | null;
    if (data?.items) setItems(await decryptAuxiliaryItems(data.items));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void apiFetch(`/${config.kind === "favorite" ? "favorites" : config.kind === "anniversary" ? "anniversaries" : "capsules"}`, { cache: "no-store" })
        .then((response) => response.json())
        .then(async (data: { items?: StoredItem[] }) => {
          if (data.items) setItems(await decryptAuxiliaryItems(data.items));
        })
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [config.kind]);

  const cityOptions = useMemo(() => cities.slice().sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")), []);
  const canSave = title.trim().length > 0;

  const resetForm = () => {
    setTitle("");
    setDate("");
    setNote("");
    setEditingId("");
  };

  const save = async () => {
    if (!isLoggedIn) {
      setStatus("请先登录后再保存");
      return;
    }
    if (!canSave) return;

    setWorking(true);
    setStatus("");
    try {
      const response = await apiFetch("/auxiliary-items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await encryptAuxiliaryForSave({
          id: editingId || undefined,
          kind: config.kind,
          title: title.trim(),
          date: date.trim() || undefined,
          note: note.trim(),
          cityId: config.kind === "favorite" ? cityId : undefined,
        })),
      });
      if (!response.ok) throw new Error("Save failed");
      resetForm();
      setStatus("已保存到服务器");
      await load();
    } catch {
      setStatus("保存失败，请检查登录状态和网络后重试");
    } finally {
      setWorking(false);
    }
  };

  const startEdit = (item: StoredItem) => {
    if (!isLoggedIn) return;
    setEditingId(item.id);
    setTitle(item.title);
    setDate(item.date ?? "");
    setNote(item.note);
    if (item.cityId) setCityId(item.cityId);
  };

  const remove = async (id: string) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再删除");
      return;
    }
    setWorking(true);
    setStatus("");
    try {
      const response = await apiFetch(`/auxiliary-items/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      if (editingId === id) resetForm();
      setStatus("已从服务器删除");
      await load();
    } catch {
      setStatus("删除失败，请检查登录状态和网络后重试");
    } finally {
      setWorking(false);
    }
  };

  return (
    <MemoryPageShell active={config.active}>
      <header className="flex flex-wrap items-start justify-between gap-4 sm:gap-5">
        <div>
          <div className="flex items-center gap-3">
            <Icon className="h-6 w-6 fill-[#F5DCE0] text-[#E8B8C2] sm:h-8 sm:w-8" />
            <h1 className="text-2xl font-semibold leading-tight text-[#5A6670] sm:text-[34px]">{config.title}</h1>
          </div>
          <p className="mt-2 hidden text-sm font-medium text-[#5A6670]/58 sm:block">{config.subtitle}</p>
        </div>
        <div className="rounded-[8px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/72 px-4 py-2 text-sm font-semibold text-[#5A6670]/62 shadow-[0_8px_24px_rgba(90,102,112,0.08)] backdrop-blur">
          {items.length} 条
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:mt-10 sm:gap-5 lg:grid-cols-[340px_1fr]">
        <div className="h-fit rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] backdrop-blur sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[#5A6670]">{editingId ? "编辑" : "新增"}</p>
            {!isLoggedIn && <span className="text-xs font-semibold text-[#5A6670]/42">未登录</span>}
          </div>
          <input
            className="mt-4 w-full rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm outline-none transition focus:border-[#E8B8C2]"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={config.kind === "favorite" ? "想去的地方" : "标题"}
            disabled={!isLoggedIn}
          />
          {config.kind === "favorite" && (
            <select
              className="mt-3 w-full rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm outline-none transition focus:border-[#E8B8C2]"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              disabled={!isLoggedIn}
            >
              {cityOptions.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          )}
          {config.kind !== "favorite" && (
            <input
              className="mt-3 w-full rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm outline-none transition focus:border-[#E8B8C2]"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              placeholder="2026.05.20"
              maxLength={10}
              disabled={!isLoggedIn}
            />
          )}
          <textarea
            className="mt-3 w-full resize-none rounded-[7px] border border-[#D8DDD8] bg-[#FAFBF7] px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#E8B8C2]"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="写一点备注……"
            disabled={!isLoggedIn}
          />
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[7px] bg-[#F5DCE0] px-4 py-2.5 text-sm font-semibold text-[#E8B8C2] transition hover:bg-[#E8B8C2] hover:text-[#FAFBF7] disabled:opacity-45"
            type="button"
            onClick={save}
            disabled={!isLoggedIn || !canSave}
          >
            <Plus className="h-4 w-4" />
            {working ? "保存中" : editingId ? "保存修改" : "保存"}
          </button>
          {status ? <p className="mt-3 text-xs font-semibold text-[#D86F82]">{status}</p> : null}
          {editingId && (
            <button
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[7px] px-4 py-2 text-sm font-semibold text-[#5A6670]/56 transition hover:bg-[#D8DDD8]/28 hover:text-[#5A6670]"
              type="button"
              onClick={resetForm}
            >
              取消编辑
            </button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => {
            const city = cities.find((candidate) => candidate.id === item.cityId);
            const leftDays = daysUntil(item.date);

            return (
              <article
                key={item.id}
                className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] backdrop-blur sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[#5A6670]">{item.title}</h2>
                    {city && <p className="mt-1 text-sm text-[#A8C8DC]">{city.name}</p>}
                    {item.date && <p className="mt-1 text-sm text-[#5A6670]/54">{item.date}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="grid h-8 w-8 place-items-center rounded-[6px] text-[#5A6670]/42 transition hover:bg-[#D6E8F0]/34 hover:text-[#A8C8DC]"
                      type="button"
                      onClick={() => startEdit(item)}
                      aria-label="编辑"
                      disabled={!isLoggedIn}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-[6px] text-[#5A6670]/42 transition hover:bg-[#F5DCE0]/45 hover:text-[#E8B8C2]"
                      type="button"
                      onClick={() => void remove(item.id)}
                      aria-label="删除"
                      disabled={!isLoggedIn || working}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {leftDays !== null && (
                  <p className="mt-3 text-sm font-semibold text-[#E8B8C2]">
                    {leftDays >= 0 ? `还有 ${leftDays} 天` : `已经过去 ${Math.abs(leftDays)} 天`}
                  </p>
                )}
                {item.note && <p className="mt-3 text-sm leading-6 text-[#5A6670]/68">{item.note}</p>}
              </article>
            );
          })}
          {items.length === 0 && (
            <div className="rounded-[8px] border border-dashed border-[#D8DDD8] px-6 py-12 text-center text-sm text-[#5A6670]/54 md:col-span-2">
              这里还空着，先放下第一条吧。
            </div>
          )}
        </div>
      </section>
    </MemoryPageShell>
  );
}

export function FavoritesPage() {
  return <MemoryToolPage config={configs.favorite} />;
}

export function AnniversariesPage() {
  const isLoggedIn = useLoginState();
  const [items, setItems] = useState<AuxiliaryItem[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("纪念日");
  const [repeat, setRepeat] = useState<AnniversaryRepeat>("yearly");
  const [editingId, setEditingId] = useState("");
  const [status, setStatus] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings>({});
  const baselineDate = appSettings.anniversaryDate ?? defaultAnniversaryDate;
  const baselineDays = daysSince(appSettings.anniversaryDate ?? defaultAnniversaryDate);

  const load = async () => {
    const response = await apiFetch("/anniversaries", { cache: "no-store" }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { items?: AuxiliaryItem[] } | null;
    if (data?.items) setItems(await decryptAuxiliaryItems(data.items));
  };

  useEffect(() => {
    window.setTimeout(() => {
      void load();
      void syncAppSettings().then(setAppSettings).catch(() => setAppSettings(readAppSettings()));
    }, 0);
  }, []);

  const resetForm = () => {
    setTitle("");
    setDate("");
    setNote("");
    setCategory("纪念日");
    setRepeat("yearly");
    setEditingId("");
  };

  const save = async () => {
    if (!isLoggedIn || !title.trim()) {
      setStatus(isLoggedIn ? "" : "请先登录后再保存");
      return;
    }
    setStatus("");
    const response = await apiFetch("/auxiliary-items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await encryptAuxiliaryForSave({
        id: editingId || undefined,
        kind: "anniversary",
        title: title.trim(),
        date: inputDateToDotDate(date),
        note: note.trim(),
        payload: { category: category.trim() || "纪念日", repeat },
      })),
    }).catch(() => null);
    if (!response?.ok) {
      setStatus("保存失败，请稍后再试");
      return;
    }
    resetForm();
    setStatus("纪念日已保存");
    await load();
  };

  const startEdit = (item: AuxiliaryItem) => {
    if (!isLoggedIn) return;
    const payload = anniversaryPayload(item.payload);
    setEditingId(item.id);
    setTitle(item.title);
    setDate(dotDateToInputDate(item.date));
    setNote(item.note);
    setCategory(payload.category ?? "纪念日");
    setRepeat(payload.repeat ?? "yearly");
  };

  const remove = async (id: string) => {
    if (!isLoggedIn) return;
    await apiFetch(`/auxiliary-items/${id}`, { method: "DELETE" }).catch(() => null);
    if (editingId === id) resetForm();
    await load();
  };

  return (
    <MemoryPageShell active="anniversaries">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <CalendarDays className="h-6 w-6 text-[#E8B8C2] sm:h-8 sm:w-8" />
            <h1 className="text-2xl font-semibold leading-tight text-[#5A6670] sm:text-[34px]">纪念日墙</h1>
          </div>
          <p className="mt-2 text-sm font-medium text-[#5A6670]/58">把很多个重要日子放在同一面墙上。</p>
        </div>
        <div className="rounded-[14px] border border-[#F5DCE0] bg-[#F5DCE0]/42 px-5 py-3 text-right shadow-[0_12px_28px_rgba(232,184,194,0.12)]">
          <p className="text-xs font-semibold text-[#D86F82]/70">{appSettings.anniversaryLabel ?? defaultAnniversaryLabel}</p>
          <p className="mt-1 text-2xl font-semibold text-[#D86F82]">{baselineDays ?? 0} 天</p>
        </div>
      </header>

      <section className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="h-fit rounded-[14px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/78 p-4 shadow-[0_14px_34px_rgba(90,102,112,0.07)] backdrop-blur sm:p-5">
          <p className="text-sm font-semibold text-[#5A6670]">{editingId ? "编辑纪念日" : "新增纪念日"}</p>
          <input
            className="mt-4 min-h-11 w-full rounded-[9px] border border-[#D8DDD8] bg-white/62 px-3 text-sm outline-none transition focus:border-[#E8B8C2]"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="比如：第一次旅行"
            disabled={!isLoggedIn}
          />
          <input
            className="mt-3 min-h-11 w-full rounded-[9px] border border-[#D8DDD8] bg-white/62 px-3 text-sm outline-none transition focus:border-[#E8B8C2]"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={!isLoggedIn}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              className="min-h-11 rounded-[9px] border border-[#D8DDD8] bg-white/62 px-3 text-sm outline-none transition focus:border-[#E8B8C2]"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="分类"
              disabled={!isLoggedIn}
            />
            <select
              className="min-h-11 rounded-[9px] border border-[#D8DDD8] bg-white/62 px-3 text-sm outline-none transition focus:border-[#E8B8C2]"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as AnniversaryRepeat)}
              disabled={!isLoggedIn}
            >
              <option value="yearly">每年重复</option>
              <option value="none">只纪念一次</option>
            </select>
          </div>
          <textarea
            className="mt-3 min-h-24 w-full resize-none rounded-[9px] border border-[#D8DDD8] bg-white/62 px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#E8B8C2]"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="写一点备注……"
            disabled={!isLoggedIn}
          />
          <button
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-45"
            type="button"
            onClick={save}
            disabled={!isLoggedIn || !title.trim()}
          >
            <Plus className="h-4 w-4" />
            {editingId ? "保存修改" : "保存纪念日"}
          </button>
          {editingId ? (
            <button
              className="mt-2 min-h-10 w-full rounded-[9px] text-sm font-semibold text-[#5A6670]/56 transition hover:bg-[#D8DDD8]/28"
              type="button"
              onClick={resetForm}
            >
              取消编辑
            </button>
          ) : null}
          {status ? <p className="mt-3 text-xs font-semibold text-[#D86F82]">{status}</p> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => {
            const payload = anniversaryPayload(item.payload);
            const dayIndex = daysBetweenDotDatesInclusive(baselineDate, item.date);
            const leftDays = daysUntil(item.date);
            return (
              <article
                key={item.id}
                className="relative overflow-hidden rounded-[18px] border border-[#D8DDD8]/74 bg-[#FAFBF7]/82 p-5 shadow-[0_16px_36px_rgba(90,102,112,0.08)] backdrop-blur"
              >
                <span className="absolute right-4 top-4 h-10 w-10 rounded-full bg-[#F5DCE0]/58" aria-hidden="true" />
                <p className="text-xs font-semibold text-[#A8C8DC]">No. {String(index + 1).padStart(2, "0")}</p>
                <h2 className="mt-3 pr-10 text-xl font-semibold text-[#5A6670]">{item.title}</h2>
                <p className="mt-2 text-sm text-[#5A6670]/54">{item.date || "未设置日期"}</p>
                <div className="mt-5 rounded-[14px] border border-[#F5DCE0]/66 bg-[#F5DCE0]/28 p-4">
                  <p className="text-xs font-semibold text-[#D86F82]/62">距离第一次</p>
                  <p className="mt-1 text-2xl font-semibold text-[#D86F82]">
                    {dayIndex !== null ? `第 ${Math.max(1, dayIndex)} 天` : "待计算"}
                  </p>
                  {leftDays !== null ? (
                    <p className="mt-2 text-sm font-semibold text-[#5A6670]/66">
                      {leftDays >= 0 ? `还有 ${leftDays} 天` : `已经过去 ${Math.abs(leftDays)} 天`}
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-[#D8DDD8] bg-white/50 px-2.5 py-1 text-[11px] font-semibold text-[#5A6670]/58">
                    {payload.category}
                  </span>
                  <span className="rounded-full border border-[#D8DDD8] bg-white/50 px-2.5 py-1 text-[11px] font-semibold text-[#5A6670]/58">
                    {payload.repeat === "yearly" ? "每年重复" : "一次性"}
                  </span>
                </div>
                {item.note ? <p className="mt-4 text-sm leading-6 text-[#5A6670]/68">{item.note}</p> : null}
                <div className="mt-5 flex gap-2">
                  <button
                    className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-[#D8DDD8] text-sm font-semibold text-[#5A6670]/62 transition hover:border-[#A8C8DC] hover:text-[#A8C8DC]"
                    type="button"
                    onClick={() => startEdit(item)}
                    disabled={!isLoggedIn}
                  >
                    <Pencil className="h-4 w-4" />
                    编辑
                  </button>
                  <button
                    className="grid min-h-10 w-11 place-items-center rounded-[9px] border border-[#F5DCE0] text-[#D86F82] transition hover:bg-[#F5DCE0]/48"
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={!isLoggedIn}
                    aria-label="删除纪念日"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
          {items.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[#D8DDD8] bg-[#FAFBF7]/58 px-6 py-16 text-center text-sm text-[#5A6670]/54 md:col-span-2 xl:col-span-3">
              纪念日墙还空着，先保存第一个重要日子。
            </div>
          ) : null}
        </div>
      </section>
    </MemoryPageShell>
  );
}

export function TimeCapsulePage() {
  return <MemoryToolPage config={configs.capsule} />;
}

export function SettingsPage() {
  const isLoggedIn = useLoginState();
  const [memoryCount, setMemoryCount] = useState(0);
  const [appSettings, setAppSettings] = useState<AppSettings>({});
  const [basicSettingsDraft, setBasicSettingsDraft] = useState<AppSettings>({});
  const [loginPhotos, setLoginPhotos] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [basicSettingsStatus, setBasicSettingsStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [isSavingBasicSettings, setIsSavingBasicSettings] = useState(false);
  const [newEntryPassword, setNewEntryPassword] = useState("");
  const [privacyPassphrase, setPrivacyPassphrase] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("");
  const [privacyState, setPrivacyState] = useState(() => readPrivacyState());
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadMemoryCount = async () => {
    const memories = await fetchDecryptedMemoryStore() ?? {};
    setMemoryCount(Object.values(memories).flat().length);

    return memories;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemoryCount();
      const settings = readAppSettings();
      void syncAppSettings().then((next) => {
        setAppSettings(next);
        setBasicSettingsDraft(next);
      }).catch(() => {});
      const legacyPhotos = settings.loginPhotos ?? {};
      const nextSettings = { ...settings, loginPhotos: undefined };

      setAppSettings(nextSettings);
      setBasicSettingsDraft(nextSettings);
      void Promise.all(Object.entries(legacyPhotos).map(([slotId, image]) => writeLoginPhoto(slotId, image)))
        .then(async () => {
          if (Object.keys(legacyPhotos).length > 0 && readSession()) await saveAppSettings(nextSettings);
          setLoginPhotos(await readLoginPhotos());
          const loginPhotoTexts = await readLoginPhotoTexts();
          setAppSettings((current) => ({ ...current, loginPhotoTexts }));
        })
        .catch(() => {
          setLoginPhotos(legacyPhotos);
        });
    }, 0);

    const handleLoginPhotosUpdate = () => {
      void readLoginPhotos().then(setLoginPhotos).catch(() => setLoginPhotos({}));
      void readLoginPhotoTexts()
        .then((texts) => setAppSettings((current) => ({ ...current, loginPhotoTexts: texts })))
        .catch(() => {});
    };
    const handlePrivacyStateUpdate = () => setPrivacyState(readPrivacyState());

    window.addEventListener(loginPhotosUpdatedEvent, handleLoginPhotosUpdate);
    window.addEventListener(privacyStateUpdatedEvent, handlePrivacyStateUpdate);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(loginPhotosUpdatedEvent, handleLoginPhotosUpdate);
      window.removeEventListener(privacyStateUpdatedEvent, handlePrivacyStateUpdate);
    };
  }, []);

  const refreshPrivacyState = () => setPrivacyState(readPrivacyState());

  const enableOrUnlockPrivacy = async () => {
    if (!isLoggedIn) {
      setPrivacyStatus("请先登录后再启用或解锁隐私密钥。");
      return;
    }
    try {
      if (privacyState.enabled) {
        await unlockPrivacyKey(privacyPassphrase);
        setPrivacyStatus("隐私密钥已解锁，本设备会在本次会话中解密和加密私密文本。");
      } else {
        await enablePrivacyKey(privacyPassphrase);
        setPrivacyStatus("端到端加密已启用。之后保存的文字类私密内容会先在本机加密再上传。");
      }
      setPrivacyPassphrase("");
      const nextSettings = await syncAppSettings().catch(() => null);
      if (nextSettings) {
        setAppSettings(nextSettings);
        setBasicSettingsDraft(nextSettings);
      }
      await loadMemoryCount();
      refreshPrivacyState();
    } catch (error) {
      setPrivacyStatus(error instanceof Error ? error.message : "隐私密钥操作失败，请重试。");
    }
  };

  const lockPrivacy = () => {
    lockPrivacyKey();
    refreshPrivacyState();
    setPrivacyStatus("隐私密钥已从本次会话锁定。");
  };

  const resetPrivacy = () => {
    resetPrivacyKeyForThisDevice();
    refreshPrivacyState();
    setPrivacyPassphrase("");
    setPrivacyStatus("已清除此设备上的隐私密钥校验记录；服务器上的既有密文不会被解密或删除。");
  };

  const updateLoginPhoto = async (slotId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!isLoggedIn) {
      setStatus("请先登录后再保存");
      event.target.value = "";
      return;
    }
    if (!file || isWorking) return;

    setIsWorking(true);
    setStatus("");

    try {
      const image = await imageFileToSettingImage(file);
      await writeLoginPhoto(slotId, image);
      setLoginPhotos(await readLoginPhotos());
      setStatus("登录照片已更新");
    } catch {
      setStatus("登录照片更新失败，请选择一张图片");
    } finally {
      setIsWorking(false);
      event.target.value = "";
    }
  };

  const resetLoginPhoto = (slotId: string) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再删除");
      return;
    }

    void deleteLoginPhoto(slotId)
      .then(async () => {
        setLoginPhotos(await readLoginPhotos());
        setStatus("登录照片已恢复默认");
      })
      .catch(() => setStatus("登录照片恢复失败，请稍后再试"));
  };

  const updateLoginPhotoText = (slotId: string, field: keyof LoginPhotoText, value: string) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再编辑");
      return;
    }

    const nextText = {
      ...(appSettings.loginPhotoTexts?.[slotId] ?? {}),
      [field]: value,
    };
    const nextSettings = {
      ...appSettings,
      loginPhotoTexts: {
        ...(appSettings.loginPhotoTexts ?? {}),
        [slotId]: nextText,
      },
    };

    setAppSettings(nextSettings);
    void writeLoginPhotoText(slotId, nextText)
      .then(() => setStatus("登录文字已更新"))
      .catch(() => setStatus("登录文字更新失败，请稍后再试"));
  };

  const resetLoginPhotoText = (slotId: string) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再删除");
      return;
    }

    const nextTexts = { ...(appSettings.loginPhotoTexts ?? {}) };
    delete nextTexts[slotId];

    setAppSettings({ ...appSettings, loginPhotoTexts: nextTexts });
    void deleteLoginPhotoText(slotId)
      .then(() => setStatus("登录文字已恢复默认"))
      .catch(() => setStatus("登录文字恢复失败，请稍后再试"));
  };

  const anniversaryDate = basicSettingsDraft.anniversaryDate ?? "";
  const anniversaryLabel = basicSettingsDraft.anniversaryLabel ?? "";
  const weatherCityIds = basicSettingsDraft.weatherCityIds ?? defaultWeatherCityIds;

  const updateBasicSetting = (patch: Partial<AppSettings>) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再编辑");
      return;
    }

    setBasicSettingsDraft((current) => ({ ...current, ...patch }));
    setBasicSettingsStatus("有未保存的基础设置，点击保存后才会同步到首页和服务器。");
    setStatus("");
  };

  const saveBasicSettings = async () => {
    if (!isLoggedIn) {
      setStatus("请先登录后再保存");
      return;
    }
    if (isSavingBasicSettings) return;

    const next = { ...appSettings, ...basicSettingsDraft };

    setIsSavingBasicSettings(true);
    setBasicSettingsStatus("基础设置保存中……");
    setStatus("");

    try {
      const saved = await saveAppSettings(next);
      setAppSettings(saved);
      setBasicSettingsDraft(saved);
      setBasicSettingsStatus("基础设置已保存到服务器。");
      setStatus("基础设置已保存到服务器");
    } catch {
      setBasicSettingsStatus("基础设置保存失败：服务器没有确认保存，请检查登录状态和网络后重试。");
      setStatus("基础设置保存失败，请检查登录状态和网络后重试");
    } finally {
      setIsSavingBasicSettings(false);
    }
  };

  const updateWeatherCity = (index: number, cityId: string) => {
    const nextIds = Array.from({ length: maxWeatherCities }, (_, i) =>
      i === index ? cityId : weatherCityIds[i] ?? defaultWeatherCityIds[i],
    );
    updateBasicSetting({ weatherCityIds: nextIds });
  };

  const hasDraftCoupleLogo = Object.prototype.hasOwnProperty.call(basicSettingsDraft, "coupleLogo");
  const coupleLogo = hasDraftCoupleLogo
    ? basicSettingsDraft.coupleLogo ?? defaultCoupleLogo
    : appSettings.coupleLogo ?? defaultCoupleLogo;

  const updateCoupleLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!isLoggedIn) {
      setStatus("请先登录后再编辑");
      event.target.value = "";
      return;
    }
    if (!file || isWorking) return;

    setIsWorking(true);
    setStatus("");

    try {
      const image = await imageFileToSettingImage(file);
      updateBasicSetting({ coupleLogo: image });
      setBasicSettingsStatus("头像 logo 已加入草稿，点击保存基础设置后生效。");
    } catch {
      setStatus("头像 logo 更新失败，请选择一张图片");
    } finally {
      setIsWorking(false);
      event.target.value = "";
    }
  };

  const resetCoupleLogo = () => {
    if (!isLoggedIn) {
      setStatus("请先登录后再编辑");
      return;
    }
    updateBasicSetting({ coupleLogo: undefined });
    setBasicSettingsStatus("头像 logo 已恢复为默认草稿，点击保存基础设置后生效。");
  };

  const savePassword = async (value: string) => {
    if (!isLoggedIn) {
      setStatus("请先登录后再修改密码");
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setStatus("请输入新密码");
      return;
    }
    if (!/^\d{4,8}$/.test(trimmed)) {
      setStatus("进入密码请用 4-8 位数字（你们在一起的日期，如 1223）");
      return;
    }

    setIsWorking(true);
    const response = await apiFetch("/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: trimmed }),
    }).catch(() => null);
    setIsWorking(false);

    if (response?.ok) {
      setStatus("进入密码已修改");
      setNewEntryPassword("");
    } else {
      setStatus("密码修改失败，请重试");
    }
  };

  const exportLocalData = async () => {
    if (!isLoggedIn) {
      setStatus("请先登录后再导出");
      return;
    }

    setIsWorking(true);
    setStatus("");

    const memories = await loadMemoryCount();
    const assetResponse = await apiFetch("/city-assets", { cache: "no-store" }).catch(() => null);
    const assetData = (await assetResponse?.json().catch(() => null)) as { assets?: CityAssetStore } | null;
    const auxiliaryResponse = await apiFetch("/auxiliary-items", { cache: "no-store" }).catch(() => null);
    const auxiliaryData = (await auxiliaryResponse?.json().catch(() => null)) as { items?: AuxiliaryItem[] } | null;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      memories,
      cityAssets: assetData?.assets ?? {},
      auxiliary: await decryptAuxiliaryItems(auxiliaryData?.items ?? []),
      settings: {
        ...readAppSettings(),
        loginPhotos: await readLoginPhotos(),
        loginPhotoTexts: await readLoginPhotoTexts(),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `map-of-us-backup-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("已导出完整备份");
    setIsWorking(false);
  };

  const importLocalData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!isLoggedIn) {
      setStatus("请先登录后再导入");
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }
    if (!file || isWorking) return;

    setIsWorking(true);
    setStatus("");

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Invalid backup");
      }

      const payload = parsed as {
        memories?: unknown;
        cityAssets?: unknown;
        auxiliary?: Record<string, unknown>;
        settings?: unknown;
      };
      const importResponse = await apiFetch("/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!importResponse.ok) throw new Error("Import failed");

      const data = (await importResponse.json()) as { memories: LocalMemoryStore };
      if (payload.settings) {
        const nextSettings = normalizeAppSettings(payload.settings);
        await Promise.all(
          Object.entries(nextSettings.loginPhotos ?? {}).map(([slotId, image]) => writeLoginPhoto(slotId, image)),
        );
        await Promise.all(
          Object.entries(nextSettings.loginPhotoTexts ?? {}).map(([slotId, text]) => writeLoginPhotoText(slotId, text)),
        );
        const settingsWithoutPhotos = { ...nextSettings, loginPhotos: undefined };
        await saveAppSettings(settingsWithoutPhotos);
        setAppSettings(settingsWithoutPhotos);
        setLoginPhotos(await readLoginPhotos());
      }
      window.dispatchEvent(new CustomEvent(memoryStoreUpdatedEvent, { detail: data.memories }));
      setMemoryCount(Object.values(data.memories).flat().length);
      setStatus("导入完成，地图和回忆记录已刷新");
    } catch {
      setStatus("导入失败，请确认选择的是 Map of Us 备份文件");
    } finally {
      setIsWorking(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const signOut = async () => {
    if (isWorking) return;
    setIsWorking(true);
    await logout().catch(() => null);
    setIsWorking(false);
    setStatus("已退出登录");
  };

  return (
    <MemoryPageShell active="settings">
      <header>
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-[#A8C8DC] sm:h-8 sm:w-8" />
          <h1 className="text-2xl font-semibold leading-tight text-[#5A6670] sm:text-[34px]">设置</h1>
        </div>
        <p className="mt-2 hidden text-sm font-medium text-[#5A6670]/58 sm:block">管理本地数据和当前项目状态。</p>
      </header>

      <section className="mt-6 grid gap-4 sm:mt-10 md:grid-cols-2">
        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {isLoggedIn ? (
                <ShieldCheck className="h-6 w-6 text-[#A8C8DC]" />
              ) : (
                <ShieldOff className="h-6 w-6 text-[#E8B8C2]" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#5A6670]">登录状态</p>
                <p className="mt-1 text-xs text-[#5A6670]/52">
                  {isLoggedIn ? "已登录，可以保存、删除和导入数据。" : "未登录，设置改动和删除操作会被锁定。"}
                </p>
              </div>
            </div>

            {isLoggedIn ? (
              <button
                className="rounded-[7px] border border-[#D8DDD8] px-4 py-2 text-sm font-semibold text-[#5A6670]/64 transition hover:bg-white/60"
                type="button"
                onClick={() => void signOut()}
                disabled={isWorking}
              >
                <LogOut className="mr-2 inline h-4 w-4" />
                退出登录
              </button>
            ) : (
              <p className="text-sm font-semibold text-[#D86F82]">请从首页输入密码登录后再编辑。</p>
            )}
          </div>
        </div>

        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5 md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {privacyState.unlocked ? (
                <Unlock className="mt-0.5 h-6 w-6 text-[#A8C8DC]" />
              ) : (
                <Lock className="mt-0.5 h-6 w-6 text-[#E8B8C2]" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#5A6670]">端到端加密</p>
                <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
                  隐私密钥只保存在本设备会话中，服务器不会收到密钥。启用后，新保存的回忆文字、标签、设置文字、纪念日/收藏备注和手动保存的攻略文本会先加密再上传。
                </p>
                <p className="mt-2 text-xs leading-5 text-[#D86F82]/78">
                  照片文件和 AI 请求暂不做全量端到端加密：AI 润色/生成需要你主动把当前明文发送给后端和 AstrBot。
                </p>
              </div>
            </div>
            <span className="rounded-full border border-[#D8DDD8] bg-white/50 px-3 py-1 text-xs font-semibold text-[#5A6670]/62">
              {!privacyState.supported ? "当前环境不支持" : privacyState.unlocked ? "已解锁" : privacyState.enabled ? "已启用，未解锁" : "未启用"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              className="min-h-10 min-w-[220px] flex-1 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white disabled:opacity-50"
              value={privacyPassphrase}
              onChange={(event) => setPrivacyPassphrase(event.target.value)}
              type="password"
              placeholder={privacyState.enabled ? "输入隐私密钥解锁" : "设置至少 8 位隐私密钥"}
              disabled={!isLoggedIn || !privacyState.supported}
            />
            <button
              className="rounded-[7px] bg-[#273846] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-50"
              type="button"
              onClick={() => void enableOrUnlockPrivacy()}
              disabled={!isLoggedIn || !privacyState.supported || privacyPassphrase.trim().length < 8}
            >
              {privacyState.enabled ? "解锁" : "启用加密"}
            </button>
            <button
              className="rounded-[7px] border border-[#D8DDD8] px-4 py-2 text-sm font-semibold text-[#5A6670]/64 transition hover:bg-white/60 disabled:opacity-50"
              type="button"
              onClick={lockPrivacy}
              disabled={!privacyState.unlocked}
            >
              锁定
            </button>
            <button
              className="rounded-[7px] border border-[#F5DCE0] px-4 py-2 text-sm font-semibold text-[#D86F82] transition hover:bg-[#F5DCE0]/42 disabled:opacity-50"
              type="button"
              onClick={resetPrivacy}
              disabled={!privacyState.enabled}
            >
              清除此设备密钥
            </button>
          </div>
          {privacyStatus ? <p className="mt-3 text-xs font-semibold text-[#D86F82]">{privacyStatus}</p> : null}
        </div>

        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5 md:col-span-2">
          <div>
            <p className="text-sm font-semibold text-[#5A6670]">密码设置</p>
            <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
              修改打开应用的进入密码。修改后立即生效，下次打开也用新密码。需要先登录。
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5A6670]/48">进入密码（你们在一起的日期，如 1223）</span>
              <div className="flex gap-2">
                <input
                  className="min-h-10 w-full rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white disabled:opacity-50"
                  value={newEntryPassword}
                  onChange={(event) => setNewEntryPassword(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="如 1223"
                  disabled={!isLoggedIn}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-[7px] bg-[#F5DCE0] px-4 py-2 text-sm font-semibold text-[#E8B8C2] transition hover:bg-[#E8B8C2] hover:text-[#FAFBF7] disabled:opacity-50"
                  onClick={() => void savePassword(newEntryPassword)}
                  disabled={!isLoggedIn || isWorking}
                >
                  保存
                </button>
              </div>
            </div>

            <p className="rounded-[7px] border border-[#D8DDD8]/70 bg-white/38 px-3 py-3 text-sm leading-6 text-[#5A6670]/60">
              登录后即可保存和删除内容，这是你们两个人的私密空间。
            </p>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5 md:col-span-2">
          <div>
            <p className="text-sm font-semibold text-[#5A6670]">基础设置</p>
            <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
              标题、纪念日，以及首页“沿途天气”显示的城市，都可以在这里改成你自己的。
            </p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-[#5A6670]/48">纪念日名称</span>
              <input
                className="min-h-10 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white"
                value={anniversaryLabel}
                placeholder={defaultAnniversaryLabel}
                onChange={(event) => updateBasicSetting({ anniversaryLabel: event.target.value })}
                disabled={!isLoggedIn}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-[#5A6670]/48">纪念日开始日期（如 2025.12.23）</span>
              <input
                className="min-h-10 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white"
                value={dotDateToInputDate(anniversaryDate)}
                placeholder={defaultAnniversaryDate}
                type="date"
                onChange={(event) => updateBasicSetting({ anniversaryDate: inputDateToDotDate(event.target.value) })}
                disabled={!isLoggedIn}
              />
            </label>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold text-[#5A6670]/48">沿途天气城市（最多 {maxWeatherCities} 个）</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {Array.from({ length: maxWeatherCities }).map((_, index) => (
                <select
                  key={`weather-slot-${index}`}
                  className="min-h-10 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white"
                  value={weatherCityIds[index] ?? ""}
                  onChange={(event) => updateWeatherCity(index, event.target.value)}
                  disabled={!isLoggedIn}
                >
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#D8DDD8]/70 pt-4">
            <p className="text-xs leading-5 text-[#5A6670]/52">
              修改后点击保存才会同步到首页、App 和后端。
            </p>
            <button
              className="inline-flex min-h-11 items-center rounded-[8px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-50"
              type="button"
              onClick={() => void saveBasicSettings()}
              disabled={!isLoggedIn || isSavingBasicSettings}
            >
              {isSavingBasicSettings ? "保存中" : "保存基础设置"}
            </button>
          </div>
          {basicSettingsStatus ? (
            <p
              className={`mt-3 rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                basicSettingsStatus.includes("失败")
                  ? "border-[#F5DCE0] bg-[#F5DCE0]/30 text-[#D86F82]"
                  : basicSettingsStatus.includes("未保存")
                    ? "border-[#D8DDD8] bg-white/42 text-[#5A6670]/66"
                    : "border-[#D6E8F0] bg-[#D6E8F0]/30 text-[#5A6670]/70"
              }`}
            >
              {basicSettingsStatus}
            </p>
          ) : null}

          <div className="mt-5">
            <p className="text-xs font-semibold text-[#5A6670]/48">右下角头像 logo</p>
            <div className="mt-2 flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[7px] border border-[#D8DDD8]/70 bg-white/40">
                <LocalPrivacyImage
                  src={coupleLogo}
                  alt="头像 logo 预览"
                  fill
                  sizes="80px"
                  className="object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`cursor-pointer rounded-[7px] border border-[#D8DDD8] px-4 py-2 text-sm font-semibold text-[#5A6670]/72 transition hover:bg-white/60 ${
                    isLoggedIn ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  上传图片
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={updateCoupleLogo}
                    disabled={!isLoggedIn}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-[7px] border border-[#D8DDD8] px-4 py-2 text-sm font-semibold text-[#5A6670]/64 transition hover:bg-white/60 disabled:opacity-50"
                  onClick={resetCoupleLogo}
                  disabled={!isLoggedIn}
                >
                  恢复默认
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5 md:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#5A6670]">登录照片</p>
              <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
                对应登录界面底部的 9 张照片。替换某一格后，大背景、相框和缩略图都会同步使用这一张。
              </p>
            </div>
            <p className="text-xs font-semibold text-[#5A6670]/42">
              已自定义 {Object.keys(loginPhotos).length} / {loginPhotoSlots.length}
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loginPhotoSlots.map((slot) => {
              const customPhoto = loginPhotos[slot.id];
              const customText = appSettings.loginPhotoTexts?.[slot.id];
              const src = customPhoto ?? slot.fallback;
              const titleValue = customText?.city ?? slot.city;
              const labelValue = customText?.label ?? slot.label;

              return (
                <div
                  className="rounded-[8px] border border-[#D8DDD8]/70 bg-white/34 p-3"
                  key={slot.id}
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[7px] bg-[#D6E8F0]/24">
                    <LocalPrivacyImage
                      className="h-full w-full object-cover"
                      src={src}
                      alt={`${slot.city} 登录照片预览`}
                      fill
                      sizes="(max-width: 768px) 50vw, 260px"
                    />
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold text-[#5A6670]/48">标题</span>
                      <input
                        className="min-h-10 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm font-semibold text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white"
                        value={titleValue}
                        onChange={(event) => updateLoginPhotoText(slot.id, "city", event.target.value)}
                        disabled={!isLoggedIn}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold text-[#5A6670]/48">副标题</span>
                      <input
                        className="min-h-10 rounded-[7px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC] focus:bg-white"
                        value={labelValue}
                        onChange={(event) => updateLoginPhotoText(slot.id, "label", event.target.value)}
                        disabled={!isLoggedIn}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-[#5A6670]/44">
                      {customPhoto || customText ? "已自定义" : "默认内容"}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <label
                        className={`grid h-9 w-9 place-items-center rounded-[7px] border border-[#A8C8DC] text-[#A8C8DC] transition hover:bg-[#D6E8F0]/36 ${
                          isWorking || !isLoggedIn ? "pointer-events-none opacity-45" : ""
                        }`}
                        title={`更换${slot.city}登录照片`}
                      >
                        <Upload className="h-4 w-4" />
                        <input
                          className="hidden"
                          type="file"
                          accept="image/*"
                          onChange={(event) => updateLoginPhoto(slot.id, event)}
                          disabled={isWorking || !isLoggedIn}
                        />
                      </label>
                      <button
                        className="grid h-9 w-9 place-items-center rounded-[7px] border border-[#D8DDD8] text-[#5A6670]/58 transition hover:bg-white/68 disabled:opacity-35"
                        type="button"
                        onClick={() => resetLoginPhoto(slot.id)}
                        disabled={isWorking || !isLoggedIn || !customPhoto}
                        title={`恢复${slot.city}默认照片`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded-[7px] border border-[#D8DDD8] px-3 text-xs font-semibold text-[#5A6670]/58 transition hover:bg-white/68 disabled:opacity-35"
                        type="button"
                        onClick={() => resetLoginPhotoText(slot.id)}
                        disabled={isWorking || !isLoggedIn || !customText}
                      >
                        文字
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5">
          <p className="text-sm font-semibold text-[#5A6670]">本地回忆</p>
          <p className="mt-2 text-3xl font-semibold text-[#E8B8C2]">{memoryCount}</p>
          <p className="mt-2 text-sm text-[#5A6670]/58">网页里新增的城市回忆数量。</p>
        </div>
        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5">
          <p className="text-sm font-semibold text-[#5A6670]">完整备份</p>
          <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
            导出城市回忆、城市地标图、地点收藏、纪念日和时光宝盒。换电脑前先备份一下。
          </p>
          <button
            className="mt-4 flex items-center gap-2 rounded-[7px] border border-[#A8C8DC] px-4 py-2 text-sm font-semibold text-[#A8C8DC] transition hover:bg-[#D6E8F0]/36"
            type="button"
            onClick={exportLocalData}
            disabled={isWorking || !isLoggedIn}
          >
            <Download className="h-4 w-4" />
            导出备份
          </button>
        </div>
        <div className="rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/76 p-4 shadow-[0_12px_28px_rgba(90,102,112,0.06)] sm:p-5">
          <p className="text-sm font-semibold text-[#5A6670]">导入恢复</p>
          <p className="mt-2 text-sm leading-6 text-[#5A6670]/62">
            选择之前导出的备份文件，会覆盖当前城市回忆，并恢复辅助页面数据。
          </p>
          <input
            ref={importInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={importLocalData}
            disabled={!isLoggedIn}
          />
          <button
            className="mt-4 flex items-center gap-2 rounded-[7px] border border-[#E8B8C2] px-4 py-2 text-sm font-semibold text-[#E8B8C2] transition hover:bg-[#F5DCE0]/42 disabled:opacity-45"
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={isWorking || !isLoggedIn}
          >
            <Upload className="h-4 w-4" />
            导入备份
          </button>
        </div>
      </section>
      {status && (
        <p className="mt-5 rounded-[8px] border border-[#D8DDD8]/78 bg-[#FAFBF7]/72 px-4 py-3 text-sm text-[#5A6670]/66">
          {status}
        </p>
      )}
    </MemoryPageShell>
  );
}
