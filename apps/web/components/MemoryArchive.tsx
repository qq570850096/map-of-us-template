"use client";

import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Heart,
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { cities } from "@/data/cities";
import { provinces } from "@/data/provinces";
import { MemoryPageShell } from "@/components/MemoryNav";
import {
  recentTimelineMemories,
  sortMemoriesByTime,
  type Memory,
} from "@/data/memories";
import {
  memoryStoreUpdatedEvent,
  type LocalMemoryStore,
} from "@/data/progress";
import { loginStateUpdatedEvent } from "@/data/loginState";
import { LocalPrivacyImage, LocalPrivacyImg } from "@/components/LocalPrivacyImage";
import { apiFetch } from "@/lib/apiClient";
import { readSession } from "@/lib/authStore";
import { decryptMemoryStore, encryptMemoryForSave, fetchDecryptedMemoryStore } from "@/lib/privateData";

type ArchiveView = "city" | "timeline" | "tag";
type MemoryItem = {
  memory: Memory;
  city?: (typeof cities)[number];
};
type PhotoDraft = {
  previewUrl: string;
  dataUrl: string | null;
  name: string;
};

const memoryTextMaxLength = 80;
const maxTagsPerMemory = 12;
const maxTagLength = 12;
const maxPhotosPerMemory = 24;
const memoryPhotoMaxDimension = 900;
const memoryPhotoQuality = 0.52;
const presetMemoryTags = ["美食", "纪念日", "酒店", "拍照", "交通", "惊喜"];

const isBrowserImageUrl = (url: string) => url.startsWith("data:image/") || url.startsWith("https://");
const isObjectUrl = (url?: string | null): url is string => typeof url === "string" && url.startsWith("blob:");

const revokeObjectUrl = (url?: string | null) => {
  if (isObjectUrl(url)) URL.revokeObjectURL(url);
};

const revokePhotoDrafts = (photos: PhotoDraft[]) => {
  photos.forEach((photo) => revokeObjectUrl(photo.previewUrl));
};

const normalizeMemoryTags = (tags: string[]) =>
  [...new Set(tags.map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.slice(0, maxTagLength)))]
    .slice(0, maxTagsPerMemory);

const inputDateToDotDate = (value: string) => value ? value.replaceAll("-", ".") : "";

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Image read failed"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Image read failed")));
    reader.readAsDataURL(blob);
  });

const readFileAsDataUrl = (file: File) => readBlobAsDataUrl(file);

const loadImageFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new window.Image();

    image.addEventListener(
      "load",
      () => {
        URL.revokeObjectURL(imageUrl);
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("Image load failed"));
      },
      { once: true },
    );
    image.src = imageUrl;
  });

async function readCompressedImageDataUrl(file: File) {
  if (file.type === "image/svg+xml") return readFileAsDataUrl(file);

  const image = await loadImageFile(file);
  const scale = Math.min(1, memoryPhotoMaxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return readFileAsDataUrl(file);

  context.fillStyle = "#FAFBF7";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", memoryPhotoQuality);
  });

  if (!blob) return readFileAsDataUrl(file);

  return readBlobAsDataUrl(blob);
}

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

const memoryMonthLabel = (memory: Memory) => {
  const match = /^(\d{4})\.(\d{2})\.\d{2}$/.exec(memory.date);
  if (!match) return "未标日期";

  return `${match[1]}年 ${Number(match[2])}月`;
};

function MemoryImage({ memory }: Readonly<{ memory: Memory }>) {
  const className = "pixelated h-full w-full object-cover transition duration-300 group-hover:scale-105";

  if (!memory.image) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#D6E8F0]/56 text-[#5A6670]/52">
        <Heart className="h-7 w-7 fill-[#F5DCE0] text-[#E8B8C2]" />
        <span className="mt-2 text-[11px] font-semibold">无照片</span>
      </div>
    );
  }

  if (isBrowserImageUrl(memory.image)) {
    return (
      <LocalPrivacyImg className={className} src={memory.image} alt={`${memory.city} memory`} />
    );
  }

  return (
    <LocalPrivacyImage
      className="pixelated object-cover transition duration-300 group-hover:scale-105"
      src={memory.image}
      alt={`${memory.city} memory`}
      fill
      sizes="(min-width: 1024px) 180px, 40vw"
    />
  );
}

function NewMemoryDialog({
  open,
  isLoggedIn,
  tagSuggestions,
  onClose,
  onSaved,
}: Readonly<{
  open: boolean;
  isLoggedIn: boolean;
  tagSuggestions: string[];
  onClose: () => void;
  onSaved: (memories: LocalMemoryStore) => void;
}>) {
  const [provinceId, setProvinceId] = useState(provinces[0]?.id ?? "");
  const cityOptions = useMemo(
    () => cities.filter((city) => city.provinceId === provinceId),
    [provinceId],
  );
  const [cityId, setCityId] = useState(cityOptions[0]?.id ?? cities[0]?.id ?? "");
  const city = cities.find((item) => item.id === cityId) ?? cityOptions[0] ?? cities[0];
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [isReadingPhoto, setIsReadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [polishSuggestion, setPolishSuggestion] = useState("");
  const [polishError, setPolishError] = useState("");
  const [polishing, setPolishing] = useState(false);
  const photoDraftsRef = useRef<PhotoDraft[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const photoReadTokenRef = useRef(0);

  const readyPhotos = photoDrafts.map((photo) => photo.dataUrl).filter((photo): photo is string => Boolean(photo));
  const canSave = isLoggedIn && Boolean(city) && Boolean(date) && text.trim().length > 0 && !isReadingPhoto && !isSaving;

  const resetForm = (revokePhotos: boolean) => {
    photoReadTokenRef.current += 1;
    setDate("");
    setText("");
    setTags([]);
    setTagInput("");
    setPhotoError("");
    setSaveError("");
    setPolishSuggestion("");
    setPolishError("");
    setPolishing(false);
    setIsReadingPhoto(false);
    if (revokePhotos) revokePhotoDrafts(photoDraftsRef.current);
    photoDraftsRef.current = [];
    setPhotoDrafts([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeDialog = () => {
    if (isSaving) return;
    resetForm(true);
    onClose();
  };

  const addTag = (value: string) => {
    const normalized = normalizeMemoryTags([...tags, value]);
    setTags(normalized);
    setTagInput("");
  };

  const removeTag = (value: string) => {
    setTags((current) => current.filter((tag) => tag !== value));
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      photoReadTokenRef.current += 1;
      revokePhotoDrafts(photoDraftsRef.current);
    };
  }, []);

  if (!open) return null;

  const handlePickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!isLoggedIn) {
      event.target.value = "";
      setPhotoError("请先登录后再上传照片");
      return;
    }

    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, maxPhotosPerMemory);
    if (files.length === 0) return;

    const readToken = photoReadTokenRef.current + 1;
    photoReadTokenRef.current = readToken;
    revokePhotoDrafts(photoDraftsRef.current);
    const nextPhotoDrafts = files.map((file) => ({
      previewUrl: URL.createObjectURL(file),
      dataUrl: null,
      name: file.name,
    }));

    photoDraftsRef.current = nextPhotoDrafts;
    setPhotoDrafts(nextPhotoDrafts);
    setPhotoError("");
    setSaveError("");
    setIsReadingPhoto(true);

    try {
      const dataUrls = await Promise.all(files.map(readCompressedImageDataUrl));
      if (!mountedRef.current || photoReadTokenRef.current !== readToken) return;
      const nextReadyDrafts = nextPhotoDrafts.map((photo, index) => ({
        ...photo,
        dataUrl: dataUrls[index],
      }));
      photoDraftsRef.current = nextReadyDrafts;
      setPhotoDrafts(nextReadyDrafts);
    } catch {
      if (!mountedRef.current || photoReadTokenRef.current !== readToken) return;
      setPhotoError("图片读取失败，请重新选择");
    } finally {
      if (mountedRef.current && photoReadTokenRef.current === readToken) setIsReadingPhoto(false);
    }
  };

  const handlePolishMemory = async () => {
    if (!isLoggedIn) {
      setPolishError("请先登录后再润色");
      return;
    }
    if (!text.trim() || polishing) return;

    setPolishing(true);
    setPolishError("");

    try {
      const response = await apiFetch("/ai/memory-polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: text.trim(),
          cityId: city?.id,
          city: city?.name,
          date: inputDateToDotDate(date),
        }),
      });
      if (!response.ok) throw new Error("Polish failed");
      const data = (await response.json()) as { polishedText?: unknown };
      const nextText = typeof data.polishedText === "string" ? data.polishedText.trim().slice(0, memoryTextMaxLength) : "";
      if (!nextText) throw new Error("Empty polish result");
      setPolishSuggestion(nextText);
    } catch {
      setPolishError("润色失败，请稍后再试");
    } finally {
      if (mountedRef.current) setPolishing(false);
    }
  };

  const handleSave = async () => {
    if (!isLoggedIn) {
      setSaveError("请先登录后再保存");
      return;
    }
    if (!canSave || !city) return;

    setIsSaving(true);
    setSaveError("");

    try {
      const memory = await encryptMemoryForSave({
        cityId: city.id,
        city: city.name,
        cityEn: city.nameEn,
        date: inputDateToDotDate(date),
        text: text.trim(),
        tags: normalizeMemoryTags(tags),
        image: readyPhotos[0],
        photos: readyPhotos,
      } as Memory);
      const response = await apiFetch("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory }),
      });
      if (!response.ok) throw new Error("Failed to save memory");
      const data = (await response.json()) as { memories?: LocalMemoryStore };
      if (!data.memories) throw new Error("Missing memory store");
      onSaved(await decryptMemoryStore(data.memories));
      resetForm(true);
      onClose();
    } catch {
      setSaveError("保存失败，请检查登录状态或稍后再试");
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#273846]/28 px-3 pt-8 backdrop-blur-sm sm:items-center sm:px-6">
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[720px] overflow-hidden rounded-t-[22px] border border-[#D8DDD8]/80 bg-[#FAFBF7] text-[#5A6670] shadow-[0_24px_60px_rgba(39,56,70,0.22)] sm:rounded-[18px]"
        role="dialog"
        aria-modal="true"
        aria-label="新增回忆"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#D8DDD8]/70 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs font-semibold text-[#D86F82]/70">快速新增</p>
            <h2 className="mt-1 text-xl font-semibold text-[#5A6670]">写一条新的回忆</h2>
            {!isLoggedIn ? <p className="mt-2 text-xs font-semibold text-[#D86F82]">请先登录后再编辑。</p> : null}
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-[10px] border border-[#D8DDD8] text-[#5A6670]/62 transition hover:bg-white/68"
            type="button"
            onClick={closeDialog}
            aria-label="关闭新增回忆"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-11.5rem)] overflow-y-auto px-4 py-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-[#5A6670]/54">
              省份
              <select
                className="min-h-11 rounded-[9px] border border-[#D8DDD8] bg-white/68 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                value={provinceId}
                onChange={(event) => {
                  const nextProvinceId = event.target.value;
                  setProvinceId(nextProvinceId);
                  setCityId(cities.find((item) => item.provinceId === nextProvinceId)?.id ?? "");
                }}
                disabled={!isLoggedIn}
              >
                {provinces.map((province) => (
                  <option key={province.id} value={province.id}>
                    {province.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#5A6670]/54">
              城市
              <select
                className="min-h-11 rounded-[9px] border border-[#D8DDD8] bg-white/68 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                value={cityId}
                onChange={(event) => setCityId(event.target.value)}
                disabled={!isLoggedIn}
              >
                {cityOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#5A6670]/54 sm:col-span-2">
              日期
              <input
                className="min-h-11 rounded-[9px] border border-[#D8DDD8] bg-white/68 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={!isLoggedIn}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="flex items-center justify-between gap-3 text-xs font-semibold text-[#5A6670]/54">
              一句话回忆
              <span className="font-normal text-[#5A6670]/42">{text.length}/{memoryTextMaxLength}</span>
            </span>
            <textarea
              className="mt-1.5 min-h-28 w-full resize-none rounded-[10px] border border-[#D8DDD8] bg-white/68 px-3 py-2 text-sm leading-6 text-[#5A6670] outline-none transition placeholder:text-[#5A6670]/36 focus:border-[#A8C8DC]"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPolishSuggestion("");
                setPolishError("");
              }}
              maxLength={memoryTextMaxLength}
              placeholder="不用点地图，直接把今天这一刻写下来……"
              disabled={!isLoggedIn}
            />
          </label>

          <div className="mt-3 space-y-2">
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[#F5DCE0] bg-[#F5DCE0]/42 px-3 text-xs font-semibold text-[#D86F82] transition hover:bg-[#F5DCE0]/70 disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              onClick={handlePolishMemory}
              disabled={!isLoggedIn || !text.trim() || polishing}
            >
              {polishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {polishing ? "润色中" : "AI 润色"}
            </button>
            {polishSuggestion ? (
              <div className="rounded-[9px] border border-[#F5DCE0]/76 bg-white/60 p-3">
                <p className="text-xs leading-5 text-[#5A6670]/72">{polishSuggestion}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="rounded-[7px] bg-[#F5DCE0] px-3 py-1.5 text-xs font-semibold text-[#D86F82] transition hover:bg-[#E8B8C2] hover:text-[#FAFBF7]"
                    type="button"
                    onClick={() => {
                      setText(polishSuggestion.slice(0, memoryTextMaxLength));
                      setPolishSuggestion("");
                      setPolishError("");
                    }}
                  >
                    采用
                  </button>
                  <button
                    className="rounded-[7px] border border-[#D8DDD8] px-3 py-1.5 text-xs font-semibold text-[#5A6670]/66 transition hover:border-[#A8C8DC] hover:text-[#A8C8DC]"
                    type="button"
                    onClick={handlePolishMemory}
                    disabled={polishing}
                  >
                    重新润色
                  </button>
                  <button
                    className="rounded-[7px] px-3 py-1.5 text-xs font-semibold text-[#5A6670]/52 transition hover:bg-[#D8DDD8]/28"
                    type="button"
                    onClick={() => {
                      setPolishSuggestion("");
                      setPolishError("");
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            {polishError ? <p className="text-xs font-semibold text-[#D86F82]">{polishError}</p> : null}
          </div>

          <div className="mt-4">
            <span className="text-xs font-semibold text-[#5A6670]/54">回忆标签</span>
            <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-[#D8DDD8] bg-white/68 px-2 py-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className="rounded-full border border-[#F5DCE0] bg-[#F5DCE0]/48 px-2.5 py-1 text-xs font-semibold text-[#D86F82]"
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={!isLoggedIn}
                  aria-label={`移除标签 ${tag}`}
                >
                  #{tag} x
                </button>
              ))}
              <input
                className="min-h-8 min-w-[96px] flex-1 bg-transparent px-1 text-sm text-[#5A6670] outline-none placeholder:text-[#5A6670]/36"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value.slice(0, maxTagLength))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "，" || event.key === ",") {
                    event.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="输入后回车"
                disabled={!isLoggedIn || tags.length >= maxTagsPerMemory}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tagSuggestions
                .filter((tag) => !tags.includes(tag))
                .slice(0, 10)
                .map((tag) => (
                  <button
                    key={tag}
                    className="rounded-full border border-[#D8DDD8] bg-white/48 px-2.5 py-1 text-[11px] font-semibold text-[#5A6670]/58 transition hover:border-[#F5DCE0] hover:text-[#D86F82]"
                    type="button"
                    onClick={() => addTag(tag)}
                    disabled={!isLoggedIn || tags.length >= maxTagsPerMemory}
                  >
                    + {tag}
                  </button>
                ))}
            </div>
          </div>

          <div className="mt-4 rounded-[10px] border border-dashed border-[#D8DDD8] bg-white/38 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#5A6670]/62">照片</p>
                <p className="mt-1 text-[11px] text-[#5A6670]/42">可选，最多 {maxPhotosPerMemory} 张；不上传也能保存文字回忆。</p>
              </div>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                multiple
                onChange={handlePickFile}
                disabled={!isLoggedIn}
              />
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[#A8C8DC] px-3 text-xs font-semibold text-[#A8C8DC] transition hover:bg-[#D6E8F0]/34 disabled:opacity-45"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!isLoggedIn || isReadingPhoto}
              >
                {isReadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {isReadingPhoto ? "读取中" : "选择照片"}
              </button>
            </div>
            {photoDrafts.length ? (
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {photoDrafts.slice(0, 12).map((photo) => (
                  <span
                    key={photo.previewUrl}
                    className="relative aspect-square overflow-hidden rounded-[8px] border border-[#D8DDD8] bg-[#D6E8F0]"
                    title={photo.name}
                  >
                    <LocalPrivacyImg className="h-full w-full object-cover" src={photo.previewUrl} alt={photo.name} />
                  </span>
                ))}
              </div>
            ) : null}
            {photoError ? <p className="mt-2 text-xs font-semibold text-[#D86F82]">{photoError}</p> : null}
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#D8DDD8]/70 bg-[#FAFBF7]/95 px-4 py-3 backdrop-blur sm:px-5">
          <p className="text-xs font-semibold text-[#5A6670]/48">
            {city ? `${city.name} · ${date ? inputDateToDotDate(date) : "选择日期"}` : "选择城市"}
          </p>
          <div className="flex gap-2">
            <button
              className="min-h-11 rounded-[9px] border border-[#D8DDD8] px-4 text-sm font-semibold text-[#5A6670]/64 transition hover:bg-white/68"
              type="button"
              onClick={closeDialog}
              disabled={isSaving}
            >
              取消
            </button>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-[#273846] px-4 text-sm font-semibold text-white transition hover:bg-[#D86F82] disabled:opacity-45"
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isSaving ? "保存中" : "保存回忆"}
            </button>
          </div>
          {saveError ? <p className="w-full text-xs font-semibold text-[#D86F82]">{saveError}</p> : null}
        </div>
      </div>
    </div>
  );
}

function MemoryCard({ item, compact = false }: Readonly<{ item: MemoryItem; compact?: boolean }>) {
  const { memory, city } = item;

  return (
    <Link
      className="group block rounded-[8px] border border-[#D8DDD8]/74 bg-[#FAFBF7]/78 p-3 shadow-[0_12px_26px_rgba(90,102,112,0.055)] backdrop-blur transition hover:border-[#F5DCE0] hover:shadow-[0_16px_34px_rgba(90,102,112,0.10)]"
      href={city ? `/province/${city.provinceId}?city=${memory.cityId}` : "/"}
    >
      <article className={compact ? "grid grid-cols-[92px_1fr] gap-3" : "grid grid-cols-[112px_1fr] gap-4"}>
        <div className="relative aspect-square overflow-hidden rounded-[6px] border border-[#D8DDD8] bg-[#D6E8F0]">
          <MemoryImage memory={memory} />
        </div>
        <div className="min-w-0 py-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-lg font-semibold text-[#5A6670]">{memory.city}</h3>
            <span className="shrink-0 text-sm text-[#5A6670]/46">{memory.date}</span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#5A6670]/70">{memory.text}</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[#A8C8DC]">
            <MapPin className="h-3.5 w-3.5" />
            回到地图
          </p>
        </div>
      </article>
    </Link>
  );
}

export default function MemoryArchive() {
  const isLoggedIn = useLoginState();
  const [localMemories, setLocalMemories] = useState<LocalMemoryStore>({});
  const [view, setView] = useState<ArchiveView>("city");
  const [selectedCityId, setSelectedCityId] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [newMemoryOpen, setNewMemoryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handleMemoryUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LocalMemoryStore>).detail;
      if (detail) setLocalMemories(detail);
    };

    async function loadLocalMemories() {
      const memories = await fetchDecryptedMemoryStore();
      if (!cancelled && memories) setLocalMemories(memories);
    }

    window.addEventListener(memoryStoreUpdatedEvent, handleMemoryUpdate);
    loadLocalMemories();

    return () => {
      cancelled = true;
      window.removeEventListener(memoryStoreUpdatedEvent, handleMemoryUpdate);
    };
  }, []);

  const memoryItems = useMemo<MemoryItem[]>(() => {
    const localItems = Object.values(localMemories).flat();
    const byId = new Map<string, Memory>();

    [...recentTimelineMemories, ...localItems].forEach((memory) => {
      if (!memory.draft) byId.set(memory.id, memory);
    });

    return sortMemoriesByTime([...byId.values()]).map((memory) => ({
      memory,
      city: cities.find((city) => city.id === memory.cityId),
    }));
  }, [localMemories]);

  const allTags = useMemo(
    () => normalizeMemoryTags([...presetMemoryTags, ...memoryItems.flatMap((item) => item.memory.tags ?? [])]),
    [memoryItems],
  );
  const allCityOptions = useMemo(() => {
    const byId = new Map<string, string>();
    memoryItems.forEach((item) => byId.set(item.memory.cityId, item.memory.city));
    return [...byId.entries()].map(([cityId, cityName]) => ({ cityId, cityName }));
  }, [memoryItems]);

  const filteredMemoryItems = useMemo(
    () =>
      memoryItems.filter((item) => {
        const cityMatches = selectedCityId === "all" || item.memory.cityId === selectedCityId;
        const tagMatches = selectedTag === "all" || (item.memory.tags ?? []).includes(selectedTag);
        return cityMatches && tagMatches;
      }),
    [memoryItems, selectedCityId, selectedTag],
  );

  const cityGroups = useMemo(() => {
    const groups = new Map<string, MemoryItem[]>();

    filteredMemoryItems.forEach((item) => {
      const key = item.memory.cityId;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });

    return [...groups.entries()].map(([cityId, items]) => ({
      cityId,
      cityName: items[0]?.memory.city ?? cityId,
      memories: items,
    }));
  }, [filteredMemoryItems]);

  const timelineGroups = useMemo(() => {
    const groups = new Map<string, MemoryItem[]>();

    filteredMemoryItems.forEach((item) => {
      const label = memoryMonthLabel(item.memory);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    });

    return [...groups.entries()].map(([label, items]) => ({ label, memories: items }));
  }, [filteredMemoryItems]);

  const tagGroups = useMemo(
    () =>
      allTags.map((tag) => ({
        tag,
        memories: filteredMemoryItems.filter((item) => (item.memory.tags ?? []).includes(tag)),
      })).filter((group) => group.memories.length > 0),
    [allTags, filteredMemoryItems],
  );

  const cityCount = cityGroups.length;

  const toggleCity = (cityId: string) => {
    setExpandedCities((current) => {
      const next = new Set(current);
      if (next.has(cityId)) next.delete(cityId);
      else next.add(cityId);

      return next;
    });
  };

  const handleMemorySaved = (memories: LocalMemoryStore) => {
    setLocalMemories(memories);
    window.dispatchEvent(new CustomEvent(memoryStoreUpdatedEvent, { detail: memories }));
  };

  return (
    <MemoryPageShell active="memories">
          <header className="flex flex-wrap items-start justify-between gap-4 sm:gap-5">
            <div>
              <div className="flex items-center gap-3">
                <Star className="h-6 w-6 fill-[#F5DCE0] text-[#E8B8C2] sm:h-8 sm:w-8" />
                <h1 className="text-2xl font-semibold leading-tight text-[#5A6670] sm:text-[34px]">回忆记录</h1>
              </div>
              <p className="mt-2 hidden text-sm font-medium text-[#5A6670]/58 sm:block">
                {view === "city" ? "按城市整理我们的足迹" : view === "timeline" ? "按时间从新到旧排列" : "按标签整理每一种小主题"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[#273846] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(39,56,70,0.12)] transition hover:bg-[#D86F82] disabled:opacity-45"
                type="button"
                onClick={() => setNewMemoryOpen(true)}
                disabled={!isLoggedIn}
              >
                <Plus className="h-4 w-4" />
                新增回忆
              </button>
              <div className="rounded-[8px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/72 px-4 py-2 text-sm font-semibold text-[#5A6670]/62 shadow-[0_8px_24px_rgba(90,102,112,0.08)] backdrop-blur">
                {filteredMemoryItems.length} 条 · {cityCount} 城
              </div>
              <div className="flex rounded-[8px] border border-[#D8DDD8]/80 bg-[#FAFBF7]/72 p-1 shadow-[0_8px_24px_rgba(90,102,112,0.08)] backdrop-blur">
                {(["city", "timeline", "tag"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`rounded-[7px] px-4 py-2 text-sm font-semibold transition ${
                      view === mode
                        ? "bg-[#F5DCE0] text-[#E8B8C2]"
                        : "text-[#5A6670]/58 hover:bg-[#D6E8F0]/32"
                    }`}
                    type="button"
                    onClick={() => setView(mode)}
                  >
                    {mode === "city" ? "城市" : mode === "timeline" ? "时间线" : "标签"}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="mt-5 grid gap-3 rounded-[8px] border border-[#D8DDD8]/72 bg-[#FAFBF7]/66 p-3 shadow-[0_10px_24px_rgba(90,102,112,0.05)] backdrop-blur sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[#5A6670]/54">
              城市筛选
              <select
                className="min-h-11 rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                value={selectedCityId}
                onChange={(event) => setSelectedCityId(event.target.value)}
              >
                <option value="all">全部城市</option>
                {allCityOptions.map((city) => (
                  <option key={city.cityId} value={city.cityId}>
                    {city.cityName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[#5A6670]/54">
              标签筛选
              <select
                className="min-h-11 rounded-[7px] border border-[#D8DDD8] bg-white/70 px-3 text-sm text-[#5A6670] outline-none transition focus:border-[#A8C8DC]"
                value={selectedTag}
                onChange={(event) => setSelectedTag(event.target.value)}
              >
                <option value="all">全部标签</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {memoryItems.length === 0 ? (
            <div className="mt-12 grid min-h-[420px] place-items-center rounded-[8px] border border-dashed border-[#D8DDD8] bg-[#FAFBF7]/58 px-6 py-14 text-center shadow-[0_14px_34px_rgba(90,102,112,0.045)] backdrop-blur">
              <div className="max-w-[430px]">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-[8px] border border-[#F5DCE0] bg-[#F5DCE0]/42">
                  <Heart className="h-8 w-8 fill-[#F5DCE0] text-[#E8B8C2]" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-[#5A6670]">还没有回忆记录</h2>
                <p className="mt-3 text-sm leading-7 text-[#5A6670]/60">
                  不用先回地图，直接选择省份和城市，添加日期、照片和一句话回忆。保存后地图也会同步点亮。
                </p>
                <button
                  className="mt-6 inline-flex items-center gap-2 rounded-[8px] border border-[#A8C8DC] bg-[#FAFBF7]/78 px-5 py-3 text-sm font-semibold text-[#A8C8DC] transition hover:bg-[#D6E8F0]/34 disabled:opacity-45"
                  type="button"
                  onClick={() => setNewMemoryOpen(true)}
                  disabled={!isLoggedIn}
                >
                  <Plus className="h-4 w-4" />
                  新增第一条回忆
                </button>
                {!isLoggedIn ? <p className="mt-3 text-xs font-semibold text-[#D86F82]">请先登录后再编辑。</p> : null}
              </div>
            </div>
          ) : filteredMemoryItems.length === 0 ? (
            <div className="mt-8 rounded-[8px] border border-dashed border-[#D8DDD8] bg-[#FAFBF7]/58 px-6 py-12 text-center text-sm text-[#5A6670]/58">
              没有符合筛选条件的回忆。
            </div>
          ) : view === "city" ? (
            <div className="mt-6 space-y-6 sm:mt-10 sm:space-y-9">
              {cityGroups.map((group) => {
                const expanded = expandedCities.has(group.cityId);
                const visibleMemories = expanded ? group.memories : group.memories.slice(0, 3);

                return (
                  <section key={group.cityId}>
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div className="flex items-baseline gap-3">
                        <MapPin className="h-5 w-5 fill-[#E8B8C2] text-[#E8B8C2]" />
                        <h2 className="text-2xl font-semibold text-[#5A6670]">{group.cityName}</h2>
                        <span className="text-sm text-[#5A6670]/48">
                          共 {group.memories.length} 条回忆
                        </span>
                      </div>
                      {group.memories.length > 3 && (
                        <button
                          className="flex items-center gap-1 text-sm font-semibold text-[#5A6670]/58 transition hover:text-[#E8B8C2]"
                          type="button"
                          onClick={() => toggleCity(group.cityId)}
                        >
                          {expanded ? "收起" : "查看全部"}
                          <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-4 xl:grid-cols-3">
                      {visibleMemories.map((item) => (
                        <MemoryCard key={item.memory.id} item={item} compact />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : view === "timeline" ? (
            <div className="relative mt-6 space-y-6 pl-9 sm:mt-10 sm:space-y-8">
              <div className="absolute bottom-0 left-3 top-0 w-px bg-[#E8B8C2]/58" aria-hidden="true" />
              {timelineGroups.map((group) => (
                <section key={group.label} className="relative">
                  <span className="absolute -left-[34px] top-1 grid h-6 w-6 place-items-center rounded-full border border-[#F5DCE0] bg-[#FAFBF7]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#E8B8C2]" />
                  </span>
                  <h2 className="mb-4 text-2xl font-semibold text-[#5A6670]">{group.label}</h2>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {group.memories.map((item) => (
                      <MemoryCard key={item.memory.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-6 space-y-8 sm:mt-10">
              {tagGroups.map((group) => (
                <section key={group.tag}>
                  <div className="mb-4 flex items-baseline gap-3">
                    <h2 className="text-2xl font-semibold text-[#5A6670]">#{group.tag}</h2>
                    <span className="text-sm text-[#5A6670]/48">{group.memories.length} 条回忆</span>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {group.memories.map((item) => (
                      <MemoryCard key={item.memory.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          <NewMemoryDialog
            open={newMemoryOpen}
            isLoggedIn={isLoggedIn}
            tagSuggestions={allTags}
            onClose={() => setNewMemoryOpen(false)}
            onSaved={handleMemorySaved}
          />
    </MemoryPageShell>
  );
}
