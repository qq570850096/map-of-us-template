import { z } from "zod";

export const spaceRoles = ["owner", "member"] as const;
export const draftStatuses = ["draft", "accepted", "rejected"] as const;
export const auxiliaryKinds = ["favorite", "anniversary", "capsule"] as const;

export type SpaceRole = (typeof spaceRoles)[number];
export type DraftStatus = (typeof draftStatuses)[number];
export type AuxiliaryKind = (typeof auxiliaryKinds)[number];

export const memoryPhotoSchema = z.object({
  id: z.string(),
  url: z.string(),
  key: z.string().optional(),
  mimeType: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sortOrder: z.number().int().default(0),
});

export const memorySchema = z.object({
  id: z.string(),
  cityId: z.string(),
  city: z.string(),
  cityEn: z.string(),
  date: z.string(),
  text: z.string(),
  image: z.string(),
  photos: z.array(z.string()).default([]),
  photoItems: z.array(memoryPhotoSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  draft: z.boolean().optional(),
});

export const appSettingsSchema = z.object({
  loginPhotos: z.record(z.string(), z.string()).optional(),
  loginPhotoTexts: z
    .record(
      z.string(),
      z.object({
        city: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  anniversaryDate: z.string().optional(),
  anniversaryLabel: z.string().optional(),
  weatherCityIds: z.array(z.string()).optional(),
  coupleLogo: z.string().optional(),
});

export const cityAssetSchema = z.object({
  cityId: z.string(),
  image: z.string(),
});

export const auxiliaryItemSchema = z.object({
  id: z.string(),
  kind: z.enum(auxiliaryKinds),
  title: z.string(),
  date: z.string().optional(),
  note: z.string().default(""),
  cityId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const loginPayloadSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

export const memoryUpsertPayloadSchema = z.object({
  memory: memorySchema
    .partial({
      id: true,
      city: true,
      cityEn: true,
      image: true,
      photos: true,
      photoItems: true,
      createdAt: true,
      updatedAt: true,
    })
    .extend({
      cityId: z.string().min(1),
      date: z.string().min(1),
      text: z.string().min(1).max(500),
      image: z.string().optional(),
      photos: z.array(z.string()).optional(),
    }),
});

export const memoryDraftSchema = z.object({
  id: z.string(),
  status: z.enum(draftStatuses),
  cityId: z.string().optional(),
  date: z.string().optional(),
  title: z.string().optional(),
  text: z.string(),
  tags: z.array(z.string()).default([]),
  sourceText: z.string().optional(),
  createdAt: z.string().optional(),
});

export const tripPlanDraftSchema = z.object({
  id: z.string(),
  status: z.enum(draftStatuses),
  title: z.string(),
  destinationCityIds: z.array(z.string()).default([]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  summary: z.string(),
  checkpoints: z.array(z.string()).default([]),
  transportNotes: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

export type MemoryPhoto = z.infer<typeof memoryPhotoSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type CityAsset = z.infer<typeof cityAssetSchema>;
export type AuxiliaryItem = z.infer<typeof auxiliaryItemSchema>;
export type LoginPayload = z.infer<typeof loginPayloadSchema>;
export type MemoryDraft = z.infer<typeof memoryDraftSchema>;
export type TripPlanDraft = z.infer<typeof tripPlanDraftSchema>;

export type LocalMemoryStore = Record<string, Memory[]>;
export type CityAssetStore = Record<string, string>;
export type LoginPhotoStore = {
  photos: Record<string, string>;
  texts: Record<string, { city?: string; label?: string }>;
};

export const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
};
