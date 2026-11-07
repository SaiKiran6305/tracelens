import { pool } from "@workspace/db";
import { getEvents, getRun } from "./store";
export function projectDto(p: any) {
  return { id: p.id, publicId: p.public_id, name: p.name, url: p.url, origins: p.origins,
    workflowName: p.workflow_name, steps: p.steps, retentionDays: p.retention_days, journeyId: p.journey_id,
    baselineId: p.baseline_id, runCount: Number(p.run_count || 0),
    archivedAt: p.archived_at, verifiedAt: p.verified_at, createdAt: p.created_at };
}
export const projectSelect = `SELECT p.*,j.baseline_id,(SELECT count(*) FROM tl_runs r WHERE r.project_id=p.id AND r.archived_at IS NULL) AS run_count
 FROM tl_projects p JOIN tl_journeys j ON j.id=p.journey_id`;
export async function findProject(id: string, owner: string) {
  return (await pool.query(`${projectSelect} WHERE p.id=$1 AND p.owner=$2`, [id, owner])).rows[0];
}
export async function realRun(id: string, projectId: string, owner: string) {
  const { rows } = await pool.query("SELECT * FROM tl_runs WHERE id=$1 AND project_id=$2 AND owner=$3", [id, projectId, owner]);
  if (!rows[0]) return null;
  return { run: await getRun(id, owner), events: await getEvents(id), steps: rows[0].expected_steps,
    lastSequence: Number((await pool.query("SELECT coalesce(max(sequence),0) AS s FROM tl_events WHERE run_id=$1", [id])).rows[0].s) };
}
/** Expected business outcomes, not HTTP success, decide completion. Never silently pass incomplete evidence. */
export async function finishReal(runId: string, complete: boolean, dropped = 0, client?: { sessionId: string; id: string }) {
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    const row = (await q.query("SELECT * FROM tl_runs WHERE id=$1 FOR UPDATE", [runId])).rows[0];
    if (!row || row.status !== "recording") { await q.query("COMMIT"); return; }
    if (complete && client) {
      const others = await q.query("SELECT id FROM tl_session_clients WHERE session_id=$1 AND id<>$2 AND closed=false AND last_seen>now()-interval '30 seconds'", [client.sessionId, client.id]);
      if (others.rows.length) {
        const error = Object.assign(new Error("Other tabs are still recording. Detach them before concluding this run."), { status: 409 });
        throw error;
      }
    }
    const es = (await q.query("SELECT payload,source FROM tl_events WHERE run_id=$1 ORDER BY sequence", [runId])).rows;
    const expected = row.expected_steps as { id: string; outcome: string }[];
    const missing = expected.some(s => !es.some(e => e.payload.stepId === s.id));
    const outcomes = expected.map(s => {
      const evidence = es.filter(e => e.payload.stepId === s.id && typeof e.payload.response?.outcome === "string" && (e.payload.kind === "outcome" || e.source === "server"));
      return evidence.at(-1)?.payload.response?.outcome === s.outcome;
    });
    const lastApis = new Map<string, any>();
    es.filter(e => e.payload.kind === "api").forEach(e => lastApis.set(`${e.payload.stepId}|${e.payload.method}|${e.payload.path}`, e.payload));
    const failed = [...lastApis.values()].some(e => e.status >= 400 || e.status === 0) || expected.some(s => {
      const last = es.filter(e => e.payload.stepId === s.id && typeof e.payload.response?.outcome === "string").at(-1);
      return last && last.payload.response.outcome !== s.outcome;
    });
    const status = !complete || !es.length || dropped || row.dropped ? "incomplete"
      : failed ? "failed" : missing ? "incomplete" : expected.length && outcomes.every(Boolean) ? "passed" : "unknown";
    await q.query(`UPDATE tl_runs SET status=$2,finished_at=clock_timestamp(),dropped=greatest(dropped,$3),
      recorder_error=CASE WHEN $3>0 THEN 'Recorder queue dropped events; evidence is incomplete.' ELSE recorder_error END WHERE id=$1`, [runId, status, dropped]);
    await q.query("UPDATE tl_sessions SET revoked_at=now() WHERE run_id=$1 AND revoked_at IS NULL", [runId]);
    await q.query("COMMIT");
  } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
}
/** Reversible retention: archive expired records, never delete evidence or baseline. */
export async function maintainProject(projectId: string) {
  await pool.query(`UPDATE tl_runs r SET archived_at=now() FROM tl_projects p,tl_journeys j
   WHERE r.project_id=p.id AND j.id=p.journey_id AND p.id=$1 AND r.archived_at IS NULL
   AND r.status<>'recording' AND r.id IS DISTINCT FROM j.baseline_id
   AND r.created_at < now()-make_interval(days=>p.retention_days)`, [projectId]);
  const expired = await pool.query(`SELECT DISTINCT r.id FROM tl_runs r JOIN tl_sessions s ON s.run_id=r.id
   WHERE r.project_id=$1 AND r.status='recording' AND s.expires_at<now() LIMIT 100`, [projectId]);
  for (const r of expired.rows) await finishReal(r.id, false);
}
