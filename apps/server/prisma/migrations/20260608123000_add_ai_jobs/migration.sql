-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('trip_plan');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'running', 'needs_confirmation', 'completed', 'failed');

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJob_spaceId_type_status_idx" ON "AiJob"("spaceId", "type", "status");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
