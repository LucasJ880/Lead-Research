-- Add source_attachment to DocCategory enum
ALTER TYPE "DocCategory" ADD VALUE IF NOT EXISTS 'source_attachment';
