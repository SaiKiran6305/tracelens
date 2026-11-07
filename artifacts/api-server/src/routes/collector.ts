import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { eventInput, hash, limited, safeCollectorPath } from "../lib/project-security";
import { finishReal } from "../lib/project-store";
import { saveEvent } from "../lib/evidence";

const router: IRouter = Router();
router.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!await limited(`collector-ip:${req.ip}`, 600)) { res.status(429).json({ error: "Collector request limit reached." }); return; }
  const origin = req.get("origin");
  if (req.path === "/server") { next(); return; }
  if (!origin) { res.status(403).json({ error: "A browser origin is required." }); return; }
  const allowed = await pool.query("SELECT id FROM tl_projects WHERE origins ? $1 AND archived_at IS NULL LIMIT 1", [origin]);
  if (!allowed.rows.length) { res.status(403).json({ error: "Origin is not allowed." }); return; }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "300");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  const secret = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const projectId = req.body?.projectId;
  if (!secret || typeof projectId !== "string") { res.status(401).json({ error: "A scoped recording session is required." }); return; }
  const result = await pool.query(`SELECT s.*,p.public_id,p.archived_at,p.origins FROM tl_sessions s JOIN tl_projects p ON p.id=s.project_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL`, [hash(secret)]);
  const s = result.rows[0];
  if (!s || s.public_id !== projectId || s.origin !== origin || !s.origins.includes(origin) || s.archived_at) {
    res.status(403).json({ error: "Session is invalid, expired, revoked, or belongs to another origin/project." }); return;
  }
  if (!await limited(`session:${s.id}`, 240)) { res.status(429).json({ error: "Session ingestion limit reached." }); return; }
  res.locals.recordingSession = s;
  next();
});
router.post("/connect", async (req, res) => {
  const body = z.object({ projectId: z.string().max(100), clientId: z.string().max(100).optional() }).strict().parse(req.body);
  const s = res.locals.recordingSession;
  if (body.clientId && s.run_id) {
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      const r = (await q.query("SELECT status FROM tl_runs WHERE id=$1 FOR UPDATE", [s.run_id])).rows[0];
      if (!r || r.status !== "recording") { await q.query("ROLLBACK"); res.status(409).json({ error: "This recording has concluded." }); return; }
      await q.query(`INSERT INTO tl_session_clients(id,session_id) VALUES($1,$2)
        ON CONFLICT(id,session_id) DO UPDATE SET last_seen=now(),closed=false`, [body.clientId, s.id]);
      await q.query("COMMIT");
    } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
  }
  await pool.query("UPDATE tl_projects SET verified_at=now() WHERE id=$1", [s.project_id]);
  const seq = s.run_id ? (await pool.query("SELECT coalesce(max(sequence),0) n FROM tl_events WHERE run_id=$1", [s.run_id])).rows[0].n : 0;
  res.json({ verified: true, runId: s.run_id, lastSequence: Number(seq), purpose: s.purpose, expiresAt: s.expires_at });
});
router.post("/heartbeat", async (req, res) => {
  const body = z.object({ projectId: z.string().max(100), clientId: z.string().min(1).max(100) }).strict().parse(req.body);
  await pool.query("UPDATE tl_session_clients SET last_seen=now() WHERE id=$1 AND session_id=$2 AND closed=false", [body.clientId, res.locals.recordingSession.id]);
  res.json({ ok: true });
});
router.post("/disconnect", async (req, res) => {
  const body = z.object({ projectId: z.string().max(100), clientId: z.string().min(1).max(100) }).strict().parse(req.body);
  await pool.query("UPDATE tl_session_clients SET closed=true WHERE id=$1 AND session_id=$2", [body.clientId, res.locals.recordingSession.id]);
  res.json({ ok: true });
});
router.post("/events", async (req, res) => {
  const body = z.object({ projectId: z.string().max(100), runId: z.string().max(100), events: z.array(eventInput).min(1).max(25), dropped: z.number().int().min(0).max(1000000).default(0) }).strict().parse(req.body);
  const s = res.locals.recordingSession;
  if (s.purpose !== "record" || s.run_id !== body.runId || body.events.some(e => e.kind === "internal")) {
    res.status(403).json({ error: "Session cannot write these events to this run." }); return;
  }
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    const r = (await q.query("SELECT status FROM tl_runs WHERE id=$1 AND project_id=$2 FOR UPDATE", [body.runId, s.project_id])).rows[0];
    const active = (await q.query("SELECT id FROM tl_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()", [s.id])).rows[0];
    if (!r || r.status !== "recording" || !active) {
      await q.query("ROLLBACK"); res.status(409).json({ error: "This recording session is closed." }); return;
    }
    const count = Number((await q.query("SELECT count(*) n FROM tl_events WHERE run_id=$1", [body.runId])).rows[0].n);
    const existing = (await q.query("SELECT id FROM tl_events WHERE run_id=$1 AND id=ANY($2)", [body.runId, body.events.map(e => e.eventId)])).rows.length;
    if (count + new Set(body.events.map(e => e.eventId)).size - existing > 5000) {
      await q.query("UPDATE tl_runs SET dropped=dropped+1,recorder_error='Event limit reached; evidence is incomplete.' WHERE id=$1", [body.runId]);
      await q.query("COMMIT"); res.status(413).json({ error: "The recording reached its event limit.", dropped: true }); return;
    }
    const accepted = [];
    for (const e of body.events) {
      const stored = await saveEvent(q, body.runId, "browser", { ...e, path: safeCollectorPath(e.path) });
      accepted.push(stored.eventId);
    }
    await q.query("UPDATE tl_runs SET dropped=greatest(dropped,$2) WHERE id=$1", [body.runId, body.dropped]);
    const seq = (await q.query("SELECT coalesce(max(sequence),0) n FROM tl_events WHERE run_id=$1", [body.runId])).rows[0].n;
    await q.query("COMMIT");
    res.json({ accepted, lastSequence: Number(seq) });
  } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
});
router.post("/finish", async (req, res) => {
  const body = z.object({ projectId: z.string().max(100), runId: z.string().max(100), clientId: z.string().max(100).optional(), complete: z.boolean(), dropped: z.number().int().min(0).max(1000000).default(0) }).strict().parse(req.body);
  const s = res.locals.recordingSession;
  if (s.purpose !== "record" || s.run_id !== body.runId) { res.status(403).json({ error: "Wrong recording scope." }); return; }
  const others = await pool.query("SELECT id FROM tl_session_clients WHERE session_id=$1 AND id<>$2 AND closed=false AND last_seen>now()-interval '30 seconds'", [s.id, body.clientId || ""]);
  if (others.rows.length) { res.status(409).json({ error: "Another tab is recording this run. Stop or detach it before concluding; after a closed tab, allow 30 seconds for its heartbeat to expire." }); return; }
  await finishReal(body.runId, body.complete, body.dropped, { sessionId: s.id, id: body.clientId || "" });
  const r = (await pool.query("SELECT status FROM tl_runs WHERE id=$1", [body.runId])).rows[0];
  res.json({ status: r.status, complete: body.complete });
});
router.post("/server", async (req, res) => {
  if (req.get("origin")) { res.status(403).json({ error: "Server credentials must never be used in a browser." }); return; }
  const body = z.object({ projectId: z.string().max(100), runId: z.string().max(100), event: eventInput }).strict().parse(req.body);
  const secret = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!secret) { res.status(401).json({ error: "Server credential required." }); return; }
  const result = await pool.query(`SELECT c.*,p.public_id FROM tl_credentials c JOIN tl_projects p ON p.id=c.project_id WHERE c.token_hash=$1
    AND c.revoked_at IS NULL AND c.expires_at>now() AND p.archived_at IS NULL`, [hash(secret)]);
  const c = result.rows[0];
  if (!c || c.public_id !== body.projectId || !["internal", "outcome"].includes(body.event.kind)) {
    res.status(403).json({ error: "Invalid server credential or project scope." }); return;
  }
  if (!await limited(`server-key:${c.id}`, 240)) { res.status(429).json({ error: "Server evidence limit reached." }); return; }
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    const r = (await q.query("SELECT id FROM tl_runs WHERE id=$1 AND project_id=$2 AND status='recording' FOR UPDATE", [body.runId, c.project_id])).rows[0];
    if (!r) { await q.query("ROLLBACK"); res.status(409).json({ error: "Run is not active in this project." }); return; }
    const active = (await q.query("SELECT id FROM tl_credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE", [c.id])).rows[0];
    if (!active) { await q.query("ROLLBACK"); res.status(403).json({ error: "Server credential is no longer active." }); return; }
    const count = Number((await q.query("SELECT count(*) n FROM tl_events WHERE run_id=$1", [body.runId])).rows[0].n);
    if (count >= 5000) { await q.query("ROLLBACK"); res.status(413).json({ error: "Recording limit reached." }); return; }
    const stored = await saveEvent(q, body.runId, "server", { ...body.event, path: safeCollectorPath(body.event.path) });
    await q.query("COMMIT");
    res.json({ accepted: stored.eventId, lastSequence: stored.sequence });
  } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
});
export default router;
