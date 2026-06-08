-- CreateEnum
CREATE TYPE "SpacePlan" AS ENUM ('private', 'pro', 'team');

-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "SpaceRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('draft', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "AuxiliaryKind" AS ENUM ('favorite', 'anniversary', 'capsule');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('memory', 'trip_plan');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "SpacePlan" NOT NULL DEFAULT 'private',
    "status" "SpaceStatus" NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cityEn" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "coverPhotoId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryPhoto" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityAsset" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginPhoto" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "key" TEXT,
    "url" TEXT,
    "text" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuxiliaryItem" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" "AuxiliaryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "cityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuxiliaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" TEXT NOT NULL,
    "astrbotSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "DraftKind" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'draft',
    "payload" JSONB NOT NULL,
    "source" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPlan" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Space_slug_key" ON "Space"("slug");

-- CreateIndex
CREATE INDEX "Membership_spaceId_idx" ON "Membership"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_spaceId_key" ON "Membership"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "Memory_spaceId_cityId_idx" ON "Memory"("spaceId", "cityId");

-- CreateIndex
CREATE INDEX "Memory_spaceId_createdAt_idx" ON "Memory"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryPhoto_memoryId_idx" ON "MemoryPhoto"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_spaceId_key_key" ON "Setting"("spaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CityAsset_spaceId_cityId_key" ON "CityAsset"("spaceId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginPhoto_spaceId_slotId_key" ON "LoginPhoto"("spaceId", "slotId");

-- CreateIndex
CREATE INDEX "AuxiliaryItem_spaceId_kind_idx" ON "AuxiliaryItem"("spaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_spaceId_purpose_astrbotSessionId_key" ON "AiConversation"("spaceId", "purpose", "astrbotSessionId");

-- CreateIndex
CREATE INDEX "AiDraft_spaceId_kind_status_idx" ON "AiDraft"("spaceId", "kind", "status");

-- CreateIndex
CREATE INDEX "TripPlan_spaceId_createdAt_idx" ON "TripPlan"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryPhoto" ADD CONSTRAINT "MemoryPhoto_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityAsset" ADD CONSTRAINT "CityAsset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginPhoto" ADD CONSTRAINT "LoginPhoto_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuxiliaryItem" ADD CONSTRAINT "AuxiliaryItem_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlan" ADD CONSTRAINT "TripPlan_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
