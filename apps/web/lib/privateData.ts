"use client";

import type { AppSettings } from "@/data/appSettings";
import type { Memory } from "@/data/memories";
import type { LocalMemoryStore } from "@/data/progress";
import { apiFetch } from "@/lib/apiClient";
import { decryptStringFromStorage, encryptStringForStorage, hasPrivacyKey, isEncryptedString } from "@/lib/e2ee";

type AuxiliaryLike = {
  title: string;
  note?: string;
  payload?: unknown;
};

type TripPayloadLike = Record<string, unknown>;

const lockedText = "内容已加密，请在设置中解锁隐私密钥。";
const lockedTag = "已加密";

async function encryptJson(value: unknown) {
  return {
    __mapOfUsEncryptedJson: await encryptStringForStorage(JSON.stringify(value ?? null)),
  };
}

async function decryptJson<T>(value: unknown, fallback: T) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { __mapOfUsEncryptedJson?: unknown }).__mapOfUsEncryptedJson === "string"
  ) {
    const decrypted = await decryptStringFromStorage((value as { __mapOfUsEncryptedJson: string }).__mapOfUsEncryptedJson);
    if (decrypted.locked) return { value: fallback, locked: true };
    try {
      return { value: JSON.parse(decrypted.value) as T, locked: false };
    } catch {
      return { value: fallback, locked: true };
    }
  }
  return { value: value as T, locked: false };
}

export function containsEncryptedValue(value: unknown): boolean {
  if (isEncryptedString(value)) return true;
  if (Array.isArray(value)) return value.some(containsEncryptedValue);
  if (typeof value === "object" && value !== null) return Object.values(value).some(containsEncryptedValue);
  return false;
}

export async function encryptMemoryForSave(memory: Memory): Promise<Memory> {
  if (!hasPrivacyKey()) return memory;
  return {
    ...memory,
    text: await encryptStringForStorage(memory.text),
    tags: await Promise.all((memory.tags ?? []).map((tag) => encryptStringForStorage(tag))),
  };
}

export async function decryptMemory(memory: Memory): Promise<Memory> {
  const [textResult, tagResults] = await Promise.all([
    decryptStringFromStorage(memory.text),
    Promise.all((memory.tags ?? []).map((tag) => decryptStringFromStorage(tag))),
  ]);
  const locked = textResult.locked || tagResults.some((result) => result.locked);
  return {
    ...memory,
    text: textResult.locked ? lockedText : textResult.value,
    tags: locked ? [lockedTag] : tagResults.map((result) => result.value).filter(Boolean),
  };
}

export async function decryptMemoryStore(store: LocalMemoryStore): Promise<LocalMemoryStore> {
  const entries = await Promise.all(
    Object.entries(store).map(async ([cityId, memories]) => [
      cityId,
      await Promise.all(memories.map(decryptMemory)),
    ] as const),
  );
  return Object.fromEntries(entries);
}

export async function fetchDecryptedMemoryStore() {
  const response = await apiFetch("/memories", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as { memories?: LocalMemoryStore } | null;
  return data?.memories ? decryptMemoryStore(data.memories) : null;
}

export async function encryptSettingsForSave(settings: AppSettings): Promise<AppSettings> {
  if (!hasPrivacyKey()) return settings;
  const loginPhotoTexts = settings.loginPhotoTexts
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(settings.loginPhotoTexts).map(async ([slotId, text]) => [
            slotId,
            {
              city: text.city ? await encryptStringForStorage(text.city) : undefined,
              label: text.label ? await encryptStringForStorage(text.label) : undefined,
            },
          ]),
        ),
      )
    : undefined;
  return {
    ...settings,
    anniversaryLabel: settings.anniversaryLabel ? await encryptStringForStorage(settings.anniversaryLabel) : undefined,
    loginPhotoTexts,
  };
}

export async function decryptSettings(settings: AppSettings): Promise<AppSettings> {
  const label = settings.anniversaryLabel
    ? await decryptStringFromStorage(settings.anniversaryLabel)
    : { value: undefined, locked: false };
  const loginPhotoTexts = settings.loginPhotoTexts
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(settings.loginPhotoTexts).map(async ([slotId, text]) => {
            const city = text.city ? await decryptStringFromStorage(text.city) : { value: undefined, locked: false };
            const subtitle = text.label ? await decryptStringFromStorage(text.label) : { value: undefined, locked: false };
            return [
              slotId,
              {
                city: city.locked ? "已加密" : city.value,
                label: subtitle.locked ? lockedText : subtitle.value,
              },
            ];
          }),
        ),
      )
    : undefined;
  return {
    ...settings,
    anniversaryLabel: label.locked ? "已加密" : label.value,
    loginPhotoTexts,
  };
}

export async function encryptAuxiliaryForSave<T extends AuxiliaryLike>(item: T): Promise<T> {
  if (!hasPrivacyKey()) return item;
  return {
    ...item,
    title: await encryptStringForStorage(item.title),
    note: item.note ? await encryptStringForStorage(item.note) : item.note,
    payload: item.payload === undefined ? undefined : await encryptJson(item.payload),
  };
}

export async function decryptAuxiliaryItem<T extends AuxiliaryLike>(item: T): Promise<T> {
  const [title, note, payload] = await Promise.all([
    decryptStringFromStorage(item.title),
    item.note ? decryptStringFromStorage(item.note) : Promise.resolve({ value: item.note ?? "", locked: false }),
    decryptJson(item.payload, item.payload),
  ]);
  return {
    ...item,
    title: title.locked ? "已加密内容" : title.value,
    note: note.locked ? lockedText : note.value,
    payload: payload.value,
  };
}

export async function decryptAuxiliaryItems<T extends AuxiliaryLike>(items: T[]): Promise<T[]> {
  return Promise.all(items.map(decryptAuxiliaryItem));
}

export async function encryptTripPayloadForSave<T extends TripPayloadLike>(payload: T): Promise<T> {
  if (!hasPrivacyKey()) return payload;
  return encryptTripValue(payload, new Set(["startDate", "endDate", "travelStyle"])) as Promise<T>;
}

export async function decryptTripPayload<T>(payload: unknown, fallback: T): Promise<T> {
  if (typeof payload !== "object" || payload === null) return fallback;
  return decryptTripValue(payload) as Promise<T>;
}

async function encryptTripValue(value: unknown, skipKeys: Set<string>, key = ""): Promise<unknown> {
  if (typeof value === "string") return key && skipKeys.has(key) ? value : encryptStringForStorage(value);
  if (Array.isArray(value)) return Promise.all(value.map((item) => encryptTripValue(item, skipKeys)));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([entryKey, entryValue]) => [
          entryKey,
          await encryptTripValue(entryValue, skipKeys, entryKey),
        ]),
      ),
    );
  }
  return value;
}

async function decryptTripValue(value: unknown): Promise<unknown> {
  if (typeof value === "string") return (await decryptStringFromStorage(value)).value || (isEncryptedString(value) ? lockedText : value);
  if (Array.isArray(value)) return Promise.all(value.map(decryptTripValue));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([entryKey, entryValue]) => [
          entryKey,
          await decryptTripValue(entryValue),
        ]),
      ),
    );
  }
  return value;
}
