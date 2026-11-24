-- SocialHub Akulaku — Safe rollback guard for Migration 007
-- This file intentionally performs NO destructive schema or data operation.
-- Migration 007 added production tables, foreign keys, policies, indexes and status values.
-- Automatically dropping those objects can delete live media metadata/tokens or invalidate
-- existing posts. It can also reintroduce broad anon/authenticated grants.
--
-- Recovery procedure:
-- 1. Stop deployment and take a fresh Supabase backup.
-- 2. Inspect database/08-verify-after-007.sql and current row counts.
-- 3. Prepare a project-specific forward migration that preserves rows and access policies.
-- 4. Have the owner approve and test it on a restored database copy.
--
-- This guard is safe to execute accidentally: it only emits a notice.
DO $$
BEGIN
  RAISE NOTICE 'Automatic rollback skipped: Migration 007 requires a reviewed, non-destructive forward migration.';
END $$;
