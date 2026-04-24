-- Add SAM.gov eligibility fields for fast filtering and reporting.
ALTER TABLE "opportunities"
ADD COLUMN IF NOT EXISTS "set_aside" TEXT,
ADD COLUMN IF NOT EXISTS "set_aside_restricted" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_opportunities_set_aside_restricted"
ON "opportunities"("set_aside_restricted");

CREATE INDEX IF NOT EXISTS "idx_opportunities_closing_date"
ON "opportunities"("closing_date");

-- Keep full-text search materialized for keyword search.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opportunities' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE opportunities
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description_summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description_full, '')), 'C')
      ) STORED;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "idx_opportunities_search"
ON "opportunities" USING GIN ("search_vector");
