import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT p.id,s.id,c.id,k.id,r.expected_steps,l.bucket FROM tl_projects p,tl_sessions s,tl_session_clients c,tl_credentials k,tl_runs r,tl_rate_limits l LIMIT 0");
    if (!process.env.CLERK_SECRET_KEY) { res.status(503).json({ status: "not_ready", reason: "authentication_not_configured" }); return; }
    res.json({ status: "ready", persistence: "postgresql", authentication: "configured" });
  } catch { res.status(503).json({ status: "not_ready", reason: "database_or_migration_unavailable" }); }
});

export default router;
