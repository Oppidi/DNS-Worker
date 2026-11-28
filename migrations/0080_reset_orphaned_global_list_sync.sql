-- Migration 0080: Reset sync metadata for global lists missing compiled filter data
--
-- Forward-only remediation for deployments affected by earlier table-recreation migrations:
-- When `global_list_blooms` and `global_list_adguard_rules` rows are absent for a tracked URL
-- while stale `etag`, `last_modified`, `last_synced_at`, or `stats` values remain in
-- `global_list_metadata`, conditional HTTP 304 responses or sync-interval checks can leave the
-- list uncompiled. Clearing those cache/sync validators forces an immediate fresh re-sync on the
-- next cron cycle while leaving lists with existing compiled rules untouched.

UPDATE global_list_metadata
SET etag = NULL,
    last_modified = NULL,
    last_synced_at = NULL,
    stats = NULL
WHERE (
    last_synced_at IS NOT NULL
    OR etag IS NOT NULL
    OR last_modified IS NOT NULL
    OR stats IS NOT NULL
)
  AND NOT EXISTS (
    SELECT 1
    FROM global_list_blooms b
    WHERE b.url = global_list_metadata.url
  )
  AND NOT EXISTS (
    SELECT 1
    FROM global_list_adguard_rules r
    WHERE r.url = global_list_metadata.url
  );
