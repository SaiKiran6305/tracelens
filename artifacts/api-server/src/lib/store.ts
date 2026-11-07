import { pool } from "@workspace/db";
import { mapEvent } from "./evidence";

export const runSelect = `
 SELECT r.*,j.name AS journey_name,(j.baseline_id=r.id) AS is_baseline,
 (SELECT count(*)::int FROM tl_events e WHERE e.run_id=r.id) AS event_count
 FROM tl_runs r JOIN tl_journeys j ON j.id=r.journey_id`;
export function mapRun(r: any) {
  return {
    id: r.id, journeyId: r.journey_id, journeyName: r.journey_name,
    name: r.name, variant: r.variant, status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    durationMs: Math.max(0, (r.finished_at ? new Date(r.finished_at).getTime() : Date.now()) - new Date(r.created_at).getTime()),
    eventCount: r.event_count, isBaseline: Boolean(r.is_baseline), recorderError: r.recorder_error,
  };
}
export async function getRun(id: string, owner: string) {
  const { rows } = await pool.query(`${runSelect} WHERE r.id=$1 AND r.owner=$2`, [id, owner]);
  return rows[0] ? mapRun(rows[0]) : null;
}
export async function getEvents(id: string) {
  const { rows } = await pool.query("SELECT * FROM tl_events WHERE run_id=$1 ORDER BY sequence", [id]);
  return rows.map(mapEvent);
}
export async function getJourneys(owner: string) {
  const { rows } = await pool.query(`SELECT j.*,
    (SELECT count(*)::int FROM tl_runs r WHERE r.journey_id=j.id) AS run_count
    FROM tl_journeys j WHERE j.owner=$1 ORDER BY j.created_at`, [owner]);
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description, baselineId: r.baseline_id,
    createdAt: new Date(r.created_at).toISOString(), runCount: r.run_count,
  }));
}
