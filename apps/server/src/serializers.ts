import type { Memory, MemoryPhoto } from "@map-of-us/shared";

type MemoryWithPhotos = {
  id: string;
  cityId: string;
  city: string;
  cityEn: string;
  date: string;
  text: string;
  coverPhotoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  photos: Array<{
    id: string;
    key: string;
    url: string;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }>;
};

export function serializeMemory(memory: MemoryWithPhotos): Memory {
  const sortedPhotos = [...memory.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const cover = sortedPhotos.find((photo) => photo.id === memory.coverPhotoId) ?? sortedPhotos[0];

  return {
    id: memory.id,
    cityId: memory.cityId,
    city: memory.city,
    cityEn: memory.cityEn,
    date: memory.date,
    text: memory.text,
    image: cover?.url ?? "",
    photos: sortedPhotos.map((photo) => photo.url),
    photoItems: sortedPhotos.map(
      (photo): MemoryPhoto => ({
        id: photo.id,
        key: photo.key,
        url: photo.url,
        mimeType: photo.mimeType ?? undefined,
        width: photo.width ?? undefined,
        height: photo.height ?? undefined,
        sortOrder: photo.sortOrder,
      }),
    ),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export function memoryStore(memories: Memory[]) {
  return memories.reduce<Record<string, Memory[]>>((store, memory) => {
    store[memory.cityId] = store[memory.cityId] ?? [];
    store[memory.cityId].push(memory);
    return store;
  }, {});
}
