-- Product enhancement phase 1:
-- - business status + history
-- - procurement/location normalized fields
-- - RBAC expansion
-- - tenant/company forward-compatibility

-- 1) Extend existing enum roles (safe additive)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'owner' AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'super_admin' AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'super_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'manager' AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'manager';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sales' AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'sales';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'client' AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'client';
  END IF;
END $$;

-- 2) New enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BusinessStatus') THEN
    CREATE TYPE "BusinessStatus" AS ENUM (
      'new_discovered',
      'candidate',
      'under_review',
      'fit',
      'not_fit',
      'archived',
      'bidding',
      'submitted',
      'won',
      'lost'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProcurementType') THEN
    CREATE TYPE "ProcurementType" AS ENUM (
      'RFQ', 'RFP', 'RFI', 'RFN', 'IFB', 'ITB', 'tender', 'notice', 'unknown'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NoteType') THEN
    CREATE TYPE "NoteType" AS ENUM ('general', 'status_reason', 'analysis_note', 'system');
  END IF;
END $$;

-- 3) New companies table (design-only forward compatibility)
CREATE TABLE IF NOT EXISTS "companies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "tenant_id" VARCHAR(100) NOT NULL DEFAULT 'default_tenant',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) users table forward-compat fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(100) NOT NULL DEFAULT 'default_tenant',
  ADD COLUMN IF NOT EXISTS "company_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_company_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) opportunities new business fields
ALTER TABLE "opportunities"
  ADD COLUMN IF NOT EXISTS "business_status" "BusinessStatus" NOT NULL DEFAULT 'new_discovered',
  ADD COLUMN IF NOT EXISTS "business_status_reason_latest" TEXT,
  ADD COLUMN IF NOT EXISTS "procurement_type" "ProcurementType" NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "procurement_type_source" VARCHAR(30) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "procurement_type_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "postal_code" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "delivery_location" TEXT,
  ADD COLUMN IF NOT EXISTS "location_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_north_america" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "state_province" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(100) NOT NULL DEFAULT 'default_tenant';

-- 6) notes enhancements
ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "note_type" "NoteType" NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(100) NOT NULL DEFAULT 'default_tenant';

-- 7) status history audit table
CREATE TABLE IF NOT EXISTS "opportunity_status_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "tenant_id" VARCHAR(100) NOT NULL DEFAULT 'default_tenant',
  "changed_by_user_id" UUID,
  "old_status" "BusinessStatus" NOT NULL,
  "new_status" "BusinessStatus" NOT NULL,
  "reason_note_id" UUID,
  "reason_text_snapshot" TEXT,
  "source" VARCHAR(20) NOT NULL DEFAULT 'ui',
  "changed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'opportunity_status_history'
      AND constraint_name = 'opportunity_status_history_opportunity_id_fkey'
  ) THEN
    ALTER TABLE "opportunity_status_history"
      ADD CONSTRAINT "opportunity_status_history_opportunity_id_fkey"
      FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'opportunity_status_history'
      AND constraint_name = 'opportunity_status_history_changed_by_user_id_fkey'
  ) THEN
    ALTER TABLE "opportunity_status_history"
      ADD CONSTRAINT "opportunity_status_history_changed_by_user_id_fkey"
      FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'opportunity_status_history'
      AND constraint_name = 'opportunity_status_history_reason_note_id_fkey'
  ) THEN
    ALTER TABLE "opportunity_status_history"
      ADD CONSTRAINT "opportunity_status_history_reason_note_id_fkey"
      FOREIGN KEY ("reason_note_id") REFERENCES "notes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 8) Backfill business_status from existing workflow_status
UPDATE "opportunities"
SET "business_status" = CASE "workflow_status"::TEXT
  WHEN 'new' THEN 'new_discovered'::"BusinessStatus"
  WHEN 'hot' THEN 'candidate'::"BusinessStatus"
  WHEN 'review' THEN 'under_review'::"BusinessStatus"
  WHEN 'shortlisted' THEN 'fit'::"BusinessStatus"
  WHEN 'pursuing' THEN 'bidding'::"BusinessStatus"
  WHEN 'bid_submitted' THEN 'submitted'::"BusinessStatus"
  WHEN 'won' THEN 'won'::"BusinessStatus"
  WHEN 'lost' THEN 'lost'::"BusinessStatus"
  WHEN 'passed' THEN 'archived'::"BusinessStatus"
  WHEN 'not_relevant' THEN 'not_fit'::"BusinessStatus"
  WHEN 'monitor' THEN 'candidate'::"BusinessStatus"
  WHEN 'rfq_sent' THEN 'under_review'::"BusinessStatus"
  WHEN 'bid_drafted' THEN 'bidding'::"BusinessStatus"
  ELSE 'new_discovered'::"BusinessStatus"
END;

-- 9) Backfill location helper fields
UPDATE "opportunities"
SET
  "state_province" = COALESCE("state_province", "region"),
  "is_north_america" = CASE
    WHEN "country" IN ('CA', 'US') THEN TRUE
    ELSE FALSE
  END
WHERE TRUE;

-- 10) Indexes
CREATE INDEX IF NOT EXISTS "idx_companies_tenant" ON "companies"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_users_tenant" ON "users"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_users_company" ON "users"("company_id");

CREATE INDEX IF NOT EXISTS "idx_opportunities_business_status" ON "opportunities"("business_status");
CREATE INDEX IF NOT EXISTS "idx_opportunities_procurement_type" ON "opportunities"("procurement_type");
CREATE INDEX IF NOT EXISTS "idx_opportunities_north_america" ON "opportunities"("is_north_america");
CREATE INDEX IF NOT EXISTS "idx_opportunities_state_province" ON "opportunities"("state_province");
CREATE INDEX IF NOT EXISTS "idx_opportunities_tenant" ON "opportunities"("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_notes_note_type" ON "notes"("note_type");
CREATE INDEX IF NOT EXISTS "idx_notes_tenant" ON "notes"("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_opp_status_history_opp_changed"
ON "opportunity_status_history"("opportunity_id", "changed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_opp_status_history_user"
ON "opportunity_status_history"("changed_by_user_id");
CREATE INDEX IF NOT EXISTS "idx_opp_status_history_tenant"
ON "opportunity_status_history"("tenant_id");
