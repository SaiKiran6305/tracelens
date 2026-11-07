import { pool } from "@workspace/db";
import { maintainProject } from "./project-store";
import { logger } from "./logger";

let cursor = "";
let busy = false;
/** Reversible retention and expired-session closure; no recording is ever deleted. */
export async function runMaintenanceBatch() {
  if (busy) return;
  busy = true;
  const q = await pool.connect().catch(error => { busy = false; throw error; });
  let locked = false;
  try {
    locked = (await q.query("SELECT pg_try_advisory_lock(721084522) locked")).rows[0].locked;
    if (!locked) return; // Another replica owns this maintenance batch.
    const { rows } = await q.query("SELECT id FROM tl_projects WHERE id>$1 ORDER BY id LIMIT 100", [cursor]);
    for (const p of rows) await maintainProject(p.id);
    cursor = rows.length === 100 ? rows.at(-1)!.id : "";
    // Counter rows are ephemeral limits, not recordings/credentials. Keep two completed windows.
    await q.query(`DELETE FROM tl_rate_limits WHERE window_id <
      CASE WHEN bucket LIKE 'create-project:%' OR bucket LIKE 'sessions:%' OR bucket LIKE 'credentials:%'
      THEN floor(extract(epoch FROM now())/3600)-2 ELSE floor(extract(epoch FROM now())/60)-2 END`);
  } finally {
    if (locked) await q.query("SELECT pg_advisory_unlock(721084522)").catch(() => {});
    q.release();
    busy = false;
  }
}
export function startMaintenance() {
  const run = () => { void runMaintenanceBatch().catch(error => logger.error({ err: error }, "Recording maintenance failed; will retry")); };
  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
