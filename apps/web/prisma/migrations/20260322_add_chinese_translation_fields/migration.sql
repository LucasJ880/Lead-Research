-- AlterTable: Add Chinese translation fields to opportunities
ALTER TABLE "opportunities" ADD COLUMN "title_zh" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "description_summary_zh" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "description_full_zh" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "translated_at" TIMESTAMPTZ;
