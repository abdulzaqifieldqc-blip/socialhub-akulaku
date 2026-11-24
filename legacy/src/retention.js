import { Worker } from "bullmq";
import { redis } from "./queue.js";
import { pool } from "./db.js";
import { deleteObject } from "./storage.js";

// Scheduled retention worker. The database must track object_key and upload state.
// Files needed by active/queued publication jobs are deliberately excluded.
export async function cleanupExpiredMedia() {
  const days = Number(process.env.MEDIA_RETENTION_DAYS || 7);
  const q = await pool.query(
    `SELECT id, object_key FROM media_assets
     WHERE uploaded_at < NOW() - ($1::int * INTERVAL '1 day')
       AND deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM posts p
         WHERE p.media_asset_id = media_assets.id
           AND p.status IN ('queued','processing')
       )
     ORDER BY uploaded_at ASC
     LIMIT 500`,
    [days]
  );
  for (const row of q.rows) {
    await deleteObject(row.object_key);
    await pool.query(
      "UPDATE media_assets SET deleted_at=NOW() WHERE id=$1",
      [row.id]
    );
  }
  return q.rowCount;
}

export function startRetentionWorker() {
  return new Worker("media-retention", async job => {
    if (job.name !== "cleanup-expired-media") return;
    return cleanupExpiredMedia();
  }, { connection: redis });
}
