import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "@workspace/db";
import { compareEvidence } from "../lib/evidence";
import { getEvents, getRun, mapRun, runSelect } from "../lib/store";
import { dashboardWriteSafe, hash, limited, projectInput, token, validOrigin, stepList } from "../lib/project-security";
import { findProject, finishReal, maintainProject, projectDto, projectSelect, realRun } from "../lib/project-store";

const router: IRouter = Router();
router.use(async (req, res, next) => {
  const owner = getAuth(req).userId;
  if (!owner) { res.status(401).json({ error: "Sign in to access your projects." }); return; }
  if (!dashboardWriteSafe(req, res)) return;
  res.locals.realOwner = owner;
  res.setHeader("Cache-Control", "no-store");
  if (!await limited(`owner:${owner}`, 240)) { res.status(429).json({ error: "Too many requests. Try again shortly." }); return; }
  next();
});
const paging = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(100000).default(0), archived: z.enum(["true", "false"]).default("false") });
router.get("/", async (req, res) => {
  const page = paging.parse(req.query);
  const owner = res.locals.realOwner;
  const archive = page.archived === "true";
  const count = await pool.query("SELECT count(*)::int n FROM tl_projects WHERE owner=$1 AND (archived_at IS NOT NULL)=$2", [owner, archive]);
  const result = await pool.query(`${projectSelect} WHERE p.owner=$1 AND (p.archived_at IS NOT NULL)=$2 ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`, [owner, archive, page.limit, page.offset]);
  res.json({ projects: result.rows.map(projectDto), total: count.rows[0].n });
});
router.post("/", async (req, res) => {
  const p = projectInput.parse(req.body);
  const owner = res.locals.realOwner;
  if (!await limited(`create-project:${owner}`, 20, 3600)) { res.status(429).json({ error: "Project creation limit reached." }); return; }
  const id = randomUUID(), journeyId = randomUUID();
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    await q.query("INSERT INTO tl_journeys(id,owner,name,description) VALUES($1,$2,$3,$4)", [journeyId, owner, p.workflowName, `Connected application: ${p.name}`]);
    await q.query(`INSERT INTO tl_projects(id,public_id,owner,name,url,origins,workflow_name,steps,retention_days,journey_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, `tl_${randomUUID().replaceAll("-", "")}`, owner, p.name, p.url,
      JSON.stringify([...new Set(p.origins)]), p.workflowName, JSON.stringify(p.steps), p.retentionDays, journeyId]);
    await q.query("COMMIT");
  } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
  res.status(201).json(projectDto(await findProject(id, owner)));
});
router.use("/:id", async (req, res, next) => {
  const p = await findProject(req.params.id as string, res.locals.realOwner);
  if (!p) { res.status(404).json({ error: "Project not found." }); return; }
  res.locals.project = p;
  next();
});
router.get("/:id", async (req, res) => {
  const p = res.locals.project;
  await maintainProject(p.id);
  const page = paging.parse(req.query);
  const archive = page.archived === "true";
  const rs = await pool.query(`${runSelect} WHERE r.project_id=$1 AND r.owner=$2 AND (r.archived_at IS NOT NULL)=$3 ORDER BY r.created_at DESC LIMIT $4 OFFSET $5`, [p.id, p.owner, archive, page.limit, page.offset]);
  const credentials = await pool.query(`SELECT id,name,created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM tl_credentials WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`, [p.id]);
  const count = await pool.query("SELECT count(*)::int n FROM tl_runs WHERE project_id=$1 AND (archived_at IS NOT NULL)=$2", [p.id, archive]);
  res.json({ project: projectDto(await findProject(p.id, p.owner)), runs: rs.rows.map(mapRun), total: count.rows[0].n, credentials: credentials.rows });
});
router.put("/:id", async (req, res) => {
  const update = z.object({ name: z.string().trim().min(1).max(100).optional(), workflowName: z.string().trim().min(1).max(100).optional(),
    origins: z.array(z.string().refine(validOrigin)).min(1).max(10).optional(), steps: stepList.optional(),
    retentionDays: z.number().int().min(1).max(90).optional() }).strict().parse(req.body);
  const p = res.locals.project;
  if (update.origins && !update.origins.includes(new URL(p.url).origin)) { res.status(400).json({ error: "Keep the project's URL origin in the allowlist." }); return; }
  // Schema changes affect new recordings only. Existing runs keep their expected-step snapshot.
  await pool.query(`UPDATE tl_projects SET name=$2,workflow_name=$3,origins=$4,steps=$5,retention_days=$6,
    verified_at=CASE WHEN origins<>$4::jsonb THEN NULL ELSE verified_at END WHERE id=$1`,
  [p.id, update.name ?? p.name, update.workflowName ?? p.workflow_name, JSON.stringify(update.origins ?? p.origins), JSON.stringify(update.steps ?? p.steps), update.retentionDays ?? p.retention_days]);
  if (update.origins) {
    const removed = await pool.query("SELECT DISTINCT run_id FROM tl_sessions WHERE project_id=$1 AND NOT (origin=ANY($2)) AND run_id IS NOT NULL AND revoked_at IS NULL", [p.id, update.origins]);
    for (const r of removed.rows) await finishReal(r.run_id, false);
    await pool.query("UPDATE tl_sessions SET revoked_at=now() WHERE project_id=$1 AND NOT (origin=ANY($2)) AND revoked_at IS NULL", [p.id, update.origins]);
  }
  res.json(projectDto(await findProject(p.id, p.owner)));
});
router.post("/:id/archive", async (req, res) => {
  const { archived } = z.object({ archived: z.boolean() }).strict().parse(req.body);
  const p = res.locals.project;
  await pool.query("UPDATE tl_projects SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1", [p.id, archived]);
  if (archived) {
    const recording = await pool.query("SELECT id FROM tl_runs WHERE project_id=$1 AND status='recording'", [p.id]);
    for (const r of recording.rows) await finishReal(r.id, false);
    await pool.query("UPDATE tl_sessions SET revoked_at=now() WHERE project_id=$1 AND revoked_at IS NULL", [p.id]);
  }
  res.json({ ok: true });
});
router.post("/:id/sessions", async (req, res) => {
  const input = z.object({ origin: z.string().refine(validOrigin), purpose: z.enum(["verify", "record"]), name: z.string().trim().max(100).optional() }).strict().parse(req.body);
  const p = res.locals.project;
  if (p.archived_at || !p.origins.includes(input.origin)) { res.status(403).json({ error: "This origin is not enabled on the active project." }); return; }
  if (!await limited(`sessions:${p.id}`, 40, 3600)) { res.status(429).json({ error: "Session creation limit reached." }); return; }
  const secret = token(), id = randomUUID(), runId = input.purpose === "record" ? randomUUID() : null;
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    if (runId) await q.query(`INSERT INTO tl_runs(id,journey_id,owner,name,variant,project_id,expected_steps) VALUES($1,$2,$3,$4,'external',$5,$6)`,
      [runId, p.journey_id, p.owner, input.name || `${p.workflow_name} recording`, p.id, JSON.stringify(p.steps)]);
    await q.query("INSERT INTO tl_sessions(id,project_id,run_id,token_hash,origin,purpose,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, p.id, runId, hash(secret), input.origin, input.purpose, expiresAt]);
    await q.query("COMMIT");
  } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
  res.status(201).json({ token: secret, expiresAt, runId, projectId: p.public_id });
});
router.post("/:id/sessions/revoke", async (req, res) => {
  const input = z.object({ runId: z.string().optional(), token: z.string().max(200).optional() }).strict().refine(v => Boolean(v.runId || v.token)).parse(req.body);
  const p = res.locals.project;
  const sessions = await pool.query("SELECT run_id FROM tl_sessions WHERE project_id=$1 AND (run_id=$2 OR token_hash=$3)", [p.id, input.runId || "", input.token ? hash(input.token) : ""]);
  for (const s of sessions.rows) if (s.run_id) await finishReal(s.run_id, false);
  await pool.query("UPDATE tl_sessions SET revoked_at=now() WHERE project_id=$1 AND (run_id=$2 OR token_hash=$3)", [p.id, input.runId || "", input.token ? hash(input.token) : ""]);
  res.json({ ok: true });
});
router.post("/:id/credentials", async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(req.body);
  const p = res.locals.project;
  if (p.archived_at) { res.status(409).json({ error: "Restore this project first." }); return; }
  if (!await limited(`credentials:${p.id}`, 10, 3600)) { res.status(429).json({ error: "Credential creation limit reached." }); return; }
  const id = randomUUID(), secret = token(), expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await pool.query("INSERT INTO tl_credentials(id,project_id,name,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [id, p.id, name, hash(secret), expiresAt]);
  res.status(201).json({ id, token: secret, expiresAt });
});
router.post("/:id/credentials/:keyId/revoke", async (req, res) => {
  await pool.query("UPDATE tl_credentials SET revoked_at=now() WHERE id=$1 AND project_id=$2", [req.params.keyId, res.locals.project.id]);
  res.json({ ok: true });
});
router.get("/:id/compare", async (req, res) => {
  const { baselineId, runId } = z.object({ baselineId: z.string().max(100), runId: z.string().max(100) }).strict().parse(req.query);
  const p = res.locals.project;
  const a = await realRun(baselineId, p.id, p.owner), b = await realRun(runId, p.id, p.owner);
  if (!a || !b) { res.status(404).json({ error: "Both runs must belong to this project." }); return; }
  if (a.run?.status !== "passed" || b.run?.status === "recording") { res.status(409).json({ error: "Choose a verified completed baseline and a concluded comparison run." }); return; }
  const rows = compareEvidence(a.events, b.events, true);
  const changed = rows.filter(r => r.change !== "unchanged");
  const markdown = `# TraceLens comparison\n\nWorkflow: ${p.workflow_name}\n\n${changed.length ? changed.map(r => `- ${r.label}: ${r.reasons.join("; ")}`).join("\n") : "No recorded event differences."}\n\nApplication-reported outcomes are explicit assertions, not proof of hidden server work. Expected-step snapshots are included in JSON exports.`;
  res.json({ baseline: a.run, current: b.run, rows, changedCount: changed.length, firstDivergence: changed[0]?.key || null, markdown,
    baselineSteps: a.steps, currentSteps: b.steps });
});
router.use("/:id/runs/:runId", async (req, res, next) => {
  const p = res.locals.project;
  const run = await realRun(req.params.runId as string, p.id, p.owner);
  if (!run) { res.status(404).json({ error: "Run not found in this project." }); return; }
  res.locals.realRun = run;
  next();
});
router.get("/:id/runs/:runId", (_req, res) => res.json(res.locals.realRun));
router.get("/:id/runs/:runId/export", (_req, res) => {
  res.attachment("tracelens-recording.json").json(res.locals.realRun);
});
router.post("/:id/runs/:runId/finish", async (req, res) => {
  const { complete } = z.object({ complete: z.boolean().default(false) }).strict().parse(req.body);
  await finishReal(res.locals.realRun.run.id, complete);
  res.json(await getRun(res.locals.realRun.run.id, res.locals.realOwner));
});
router.post("/:id/runs/:runId/baseline", async (_req, res) => {
  const d = res.locals.realRun;
  if (d.run.status !== "passed" || d.run.recorderError) { res.status(409).json({ error: "A baseline needs all expected outcomes and complete delivery." }); return; }
  await pool.query("UPDATE tl_journeys SET baseline_id=$2 WHERE id=$1 AND owner=$3", [res.locals.project.journey_id, d.run.id, res.locals.realOwner]);
  res.json(await getRun(d.run.id, res.locals.realOwner));
});
router.post("/:id/runs/:runId/archive", async (req, res) => {
  const { archived } = z.object({ archived: z.boolean() }).strict().parse(req.body);
  const d = res.locals.realRun;
  if (d.run.status === "recording" || d.run.isBaseline) { res.status(409).json({ error: "Conclude the run or choose another baseline before archiving it." }); return; }
  await pool.query("UPDATE tl_runs SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1", [d.run.id, archived]);
  res.json({ ok: true });
});
export default router;
