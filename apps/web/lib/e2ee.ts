"use client";

const encryptedStringPrefix = "e2ee:v1:";
const keyCheckStorageKey = "mapofus:e2ee:key-check:v1";
export const privacyStateUpdatedEvent = "mapofus:e2ee-state-updated";
const verifierText = "map-of-us privacy key verifier v1";
const iterations = 150_000;

type EncryptedStringEnvelope = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
};

let activePassphraseKey: CryptoKey | null = null;

const textEncoder = () => new TextEncoder();
const textDecoder = () => new TextDecoder();

function assertBrowserCrypto() {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("当前环境不支持浏览器端加密。");
  }
}

function randomBytes(length: number) {
  assertBrowserCrypto();
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(length));
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(base64);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeEnvelope(envelope: EncryptedStringEnvelope) {
  return `${encryptedStringPrefix}${bytesToBase64Url(textEncoder().encode(JSON.stringify(envelope)))}`;
}

function decodeEnvelope(value: string): EncryptedStringEnvelope | null {
  if (!value.startsWith(encryptedStringPrefix)) return null;
  try {
    const parsed = JSON.parse(textDecoder().decode(base64UrlToBytes(value.slice(encryptedStringPrefix.length)))) as
      Partial<EncryptedStringEnvelope>;
    if (
      parsed.v !== 1 ||
      parsed.kdf !== "PBKDF2-SHA256" ||
      typeof parsed.iterations !== "number" ||
      typeof parsed.salt !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.data !== "string"
    ) {
      return null;
    }
    return parsed as EncryptedStringEnvelope;
  } catch {
    return null;
  }
}

async function importPassphrase(passphrase: string) {
  assertBrowserCrypto();
  return window.crypto.subtle.importKey(
    "raw",
    textEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}

async function deriveAesKey(passphraseKey: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterationCount = iterations) {
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: iterationCount,
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWithKey(passphraseKey: CryptoKey, plainText: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aesKey = await deriveAesKey(passphraseKey, salt);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    textEncoder().encode(plainText),
  );
  return encodeEnvelope({
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encrypted)),
  });
}

async function decryptWithKey(passphraseKey: CryptoKey, encryptedText: string) {
  const envelope = decodeEnvelope(encryptedText);
  if (!envelope) return encryptedText;
  const aesKey = await deriveAesKey(passphraseKey, base64UrlToBytes(envelope.salt), envelope.iterations);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    aesKey,
    base64UrlToBytes(envelope.data),
  );
  return textDecoder().decode(decrypted);
}

function emitPrivacyState() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(privacyStateUpdatedEvent));
}

export function isEncryptedString(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(encryptedStringPrefix);
}

export function hasPrivacyKey() {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(keyCheckStorageKey));
}

export function isPrivacyUnlocked() {
  return Boolean(activePassphraseKey);
}

export function readPrivacyState() {
  return {
    enabled: hasPrivacyKey(),
    unlocked: isPrivacyUnlocked(),
    supported: typeof window !== "undefined" && Boolean(window.crypto?.subtle),
  };
}

export async function enablePrivacyKey(passphrase: string) {
  const normalized = passphrase.trim();
  if (normalized.length < 8) throw new Error("隐私密钥至少需要 8 位。");
  const passphraseKey = await importPassphrase(normalized);
  const check = await encryptWithKey(passphraseKey, verifierText);
  window.localStorage.setItem(keyCheckStorageKey, check);
  activePassphraseKey = passphraseKey;
  emitPrivacyState();
}

export async function unlockPrivacyKey(passphrase: string) {
  const normalized = passphrase.trim();
  if (normalized.length < 8) throw new Error("隐私密钥至少需要 8 位。");
  const passphraseKey = await importPassphrase(normalized);
  const check = window.localStorage.getItem(keyCheckStorageKey);
  if (check) {
    const decrypted = await decryptWithKey(passphraseKey, check);
    if (decrypted !== verifierText) throw new Error("隐私密钥不正确。");
  } else {
    const createdCheck = await encryptWithKey(passphraseKey, verifierText);
    window.localStorage.setItem(keyCheckStorageKey, createdCheck);
  }
  activePassphraseKey = passphraseKey;
  emitPrivacyState();
}

export function lockPrivacyKey() {
  activePassphraseKey = null;
  emitPrivacyState();
}

export function resetPrivacyKeyForThisDevice() {
  activePassphraseKey = null;
  if (typeof window !== "undefined") window.localStorage.removeItem(keyCheckStorageKey);
  emitPrivacyState();
}

export async function encryptStringForStorage(value: string) {
  if (!hasPrivacyKey()) return value;
  if (!activePassphraseKey) throw new Error("请先在设置中解锁隐私密钥。");
  if (!value || isEncryptedString(value)) return value;
  return encryptWithKey(activePassphraseKey, value);
}

export async function decryptStringFromStorage(value: string) {
  if (!isEncryptedString(value)) return { value, locked: false, failed: false };
  if (!activePassphraseKey) return { value: "", locked: true, failed: false };
  try {
    return { value: await decryptWithKey(activePassphraseKey, value), locked: false, failed: false };
  } catch {
    return { value: "", locked: true, failed: true };
  }
}
