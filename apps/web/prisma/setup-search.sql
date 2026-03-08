-- =============================================================
-- LeadHarvest — Full-Text Search Setup
-- =============================================================
-- Run AFTER `prisma db push` or `prisma migrate dev`.
-- This adds the tsvector generated column and GIN indexes
-- that Prisma cannot create declaratively.
--
-- Usage:
--   psql $DATABASE_URL -f prisma/setup-search.sql
-- =============================================================

-- Add the generated tsvector column if it doesn't exist
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

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_opportunities_search
  ON opportunities USING GIN (search_vector);

-- GIN index for keywords_matched array queries
CREATE INDEX IF NOT EXISTS idx_opportunities_keywords
  ON opportunities USING GIN (keywords_matched);

-- GIN index for raw_data JSONB queries
CREATE INDEX IF NOT EXISTS idx_opportunities_raw_data
  ON opportunities USING GIN (raw_data);

-- Trigram extension for future fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
