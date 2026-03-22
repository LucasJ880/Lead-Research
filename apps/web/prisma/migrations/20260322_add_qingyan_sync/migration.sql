-- CreateEnum
CREATE TYPE "QingyanSyncStatus" AS ENUM ('pending', 'pushing', 'synced', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "qingyan_sync" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "qingyan_project_id" VARCHAR(255),
    "qingyan_task_id" VARCHAR(255),
    "sync_status" "QingyanSyncStatus" NOT NULL DEFAULT 'pending',
    "sync_direction" VARCHAR(50) NOT NULL DEFAULT 'bidtogo_to_qingyan',
    "pushed_by" UUID,
    "pushed_at" TIMESTAMPTZ,
    "last_sync_at" TIMESTAMPTZ,
    "qingyan_status" VARCHAR(100),
    "qingyan_url" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "payload_snapshot" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "qingyan_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qingyan_sync_opportunity_id_key" ON "qingyan_sync"("opportunity_id");

-- CreateIndex
CREATE INDEX "idx_qingyan_sync_status" ON "qingyan_sync"("sync_status");

-- CreateIndex
CREATE INDEX "idx_qingyan_sync_project" ON "qingyan_sync"("qingyan_project_id");

-- AddForeignKey
ALTER TABLE "qingyan_sync" ADD CONSTRAINT "qingyan_sync_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
