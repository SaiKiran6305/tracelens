import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  CreateJourneyBody, CreateRunBody, IngestEventBody, CompareRunsQueryParams,
  GetRunParams, ListJourneysResponse, ListRunsResponse, GetRunResponse, GetSummaryResponse,
} from "@workspace/api-zod";
import { compareEvidence, saveEvent } from "../lib/evidence";
import { getEvents, getJourneys, getRun, mapRun, runSelect } from "../lib/store";
import demoRouter from "./demo";
import { sdkSource } from "../lib/sdk";

const router: IRouter = Router();
export function ownerOf(res: Response): string { return res.locals.owner; }
router.get("/sdk.js", (_req, res) => { res.type("application/javascript").send(sdkSource); });
router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.method !== "GET" && req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Cross-site writes are not supported. Use a same-origin SDK proxy." }); return;
  }
  const cookie = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("tl_workspace="))?.split("=")[1];
  const owner = cookie && /^[a-f0-9-]{36}$/.test(cookie) ? cookie : randomUUID();
  if (owner !== cookie) res.cookie("tl_workspace", owner, {
    httpOnly: true, sameSite: "lax", secure: req.get("x-forwarded-proto") === "https", maxAge: 365 * 86400000, path: "/",
  });
  res.locals.owner = owner;
  res.setHeader("Cache-Control", "no-store");
  await pool.query(`INSERT INTO tl_journeys(id,owner,name,description) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
    [`demo-${owner}`, owner, "Checkout journey", "A real sandbox journey from cart to confirmation. Synthetic data, no real payments."]);
  next();
});
router.get("/journeys", async (_req, res): Promise<void> => {
  res.json(ListJourneysResponse.parse(await getJourneys(ownerOf(res))));
});
router.post("/journeys", async (req, res): Promise<void> => {
  const parsed = CreateJourneyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) { res.status(400).json({ error: "Enter a journey name." }); return; }
  const id = randomUUID();
  await pool.query("INSERT INTO tl_journeys(id,owner,name,description) VALUES($1,$2,$3,$4)",
    [id, ownerOf(res), parsed.data.name.trim(), parsed.data.description || ""]);
  res.status(201).json((await getJourneys(ownerOf(res))).find(j => j.id === id));
});
router.get("/runs", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`${runSelect} WHERE r.owner=$1 ORDER BY r.created_at DESC LIMIT 200`, [ownerOf(res)]);
  res.json(ListRunsResponse.parse(rows.map(mapRun)));
});
router.post("/runs", async (req, res): Promise<void> => {
  const parsed = CreateRunBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid recording parameters." }); return; }
  const j = (await getJourneys(ownerOf(res))).find(j => j.id === parsed.data.journeyId);
  if (!j) { res.status(404).json({ error: "Journey not found." }); return; }
  const id = randomUUID();
  await pool.query("INSERT INTO tl_runs(id,journey_id,owner,name,variant) VALUES($1,$2,$3,$4,$5)",
    [id, j.id, ownerOf(res), parsed.data.name?.trim() || `${j.name} · ${parsed.data.variant.replace(/_/g, " ")}`, parsed.data.variant]);
  res.status(201).json(await getRun(id, ownerOf(res)));
});
router.get("/summary", async (_req, res): Promise<void> => {
  const owner = ownerOf(res);
  const { rows } = await pool.query(`SELECT count(*)::int AS runs,
    count(*) FILTER(WHERE status='passed')::int AS passed,
    count(*) FILTER(WHERE status='failed')::int AS failed FROM tl_runs WHERE owner=$1`, [owner]);
  const es = await pool.query("SELECT count(*)::int AS count FROM tl_events e JOIN tl_runs r ON r.id=e.run_id WHERE r.owner=$1", [owner]);
  const recent = await pool.query(`${runSelect} WHERE r.owner=$1 ORDER BY r.created_at DESC LIMIT 5`, [owner]);
  res.json(GetSummaryResponse.parse({ ...rows[0], journeys: (await getJourneys(owner)).length,
    events: es.rows[0].count, recentRuns: recent.rows.map(mapRun) }));
});
router.get("/runs/:id", async (req, res): Promise<void> => {
  const params = GetRunParams.safeParse(req.params);
  const run = params.success ? await getRun(params.data.id, ownerOf(res)) : null;
  if (!run) { res.status(404).json({ error: "Run not found in this browser workspace." }); return; }
  const events = await getEvents(run.id);
  res.json(GetRunResponse.parse({ run, events, lastSequence: events.at(-1)?.sequence || 0 }));
});
router.post("/runs/:id/events", async (req, res): Promise<void> => {
  const params = GetRunParams.safeParse(req.params), parsed = IngestEventBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid event." }); return; }
  const run = await getRun(params.data.id, ownerOf(res));
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  if (parsed.data.kind === "internal") { res.status(400).json({ error: "Internal evidence can only come from server instrumentation." }); return; }
  const count = await pool.query("SELECT count(*)::int AS count FROM tl_events WHERE run_id=$1", [run.id]);
  if (count.rows[0].count >= 5000) { res.status(429).json({ error: "Run event limit reached." }); return; }
  const event = await saveEvent(pool, run.id, "browser", parsed.data);
  if (parsed.data.kind === "recorder") await pool.query("UPDATE tl_runs SET recorder_error=$2 WHERE id=$1", [run.id, "Recorder reported an instrumentation failure. Evidence may be incomplete."]);
  res.status(201).json(event);
});
router.post("/runs/:id/finish", async (req, res): Promise<void> => {
  const id = String(req.params.id), run = await getRun(id, ownerOf(res));
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  const events = await getEvents(id);
  if (!events.length) { res.status(409).json({ error: "Cannot complete a run without observed evidence." }); return; }
  const latest = new Map<string, number>();
  events.filter(e => e.kind === "api").forEach(e => latest.set(`${e.stepId}|${e.method}|${e.path}`, e.status || 0));
  let passed = ![...latest.values()].some(s => s >= 400 || s === 0);
  if (run.variant !== "external") {
    const ops = await pool.query("SELECT step,status FROM tl_operations WHERE run_id=$1", [id]);
    passed = passed && ["cart", "shipping", "inventory", "checkout"].every(s => ops.rows.some(o => o.step === s && o.status === 200));
  }
  await pool.query("UPDATE tl_runs SET status=$2,finished_at=now() WHERE id=$1", [id, passed ? "passed" : "failed"]);
  res.json(await getRun(id, ownerOf(res)));
});
router.post("/runs/:id/baseline", async (req, res): Promise<void> => {
  const id = String(req.params.id), run = await getRun(id, ownerOf(res));
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  if (run.status !== "passed" || run.recorderError) { res.status(409).json({ error: "Only a complete successful run with intact recording can be a baseline." }); return; }
  await pool.query("UPDATE tl_journeys SET baseline_id=$2 WHERE id=$1 AND owner=$3", [run.journeyId, id, ownerOf(res)]);
  res.json((await getJourneys(ownerOf(res))).find(j => j.id === run.journeyId));
});
router.get("/compare", async (req, res): Promise<void> => {
  const parsed = CompareRunsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Choose a baseline and a later run." }); return; }
  const baseline = await getRun(parsed.data.baselineId, ownerOf(res)), current = await getRun(parsed.data.runId, ownerOf(res));
  if (!baseline || !current) { res.status(404).json({ error: "Run not found." }); return; }
  if (baseline.journeyId !== current.journeyId) { res.status(400).json({ error: "Compare runs from the same journey." }); return; }
  const rows = compareEvidence(await getEvents(baseline.id), await getEvents(current.id));
  const changed = rows.filter(r => r.change !== "unchanged"), firstDivergence = changed[0]?.key || null;
  const markdown = `# TraceLens bug report\n\nJourney: ${baseline.journeyName}\nBaseline: ${baseline.id}\nCompared run: ${current.id}\n\n## First meaningful divergence\n${changed[0] ? `${changed[0].label}: ${changed[0].reasons.join("; ")}` : "No meaningful divergence observed."}\n\n## Evidence\n${changed.map(r => `- **${r.label}** (${r.change}): ${r.reasons.join("; ")}${r.current ? ` [event ${r.current.id}, sequence ${r.current.sequence}]` : ""}`).join("\n")}\n\n## Reproduction\nBuilt-in demo variant: ${current.variant}. Execute cart, parallel shipping/inventory, then checkout.\n\n## Limits\nObserved evidence only; no root cause is inferred. IDs, timestamps and timing differences are ignored. Parallel dependencies are retained. Recorder: ${current.recorderError || "no reported error"}.\n`;
  res.json({ baseline, current, rows, changedCount: changed.length, firstDivergence, markdown });
});
router.use(demoRouter);
export default router;
