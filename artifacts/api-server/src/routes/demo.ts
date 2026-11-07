import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { ExecuteDemoStepBody, ExecuteDemoStepParams } from "@workspace/api-zod";
import { getRun } from "../lib/store";
import { saveEvent } from "../lib/evidence";

const router: IRouter = Router();
router.post("/demo/:id/:step", async (req, res): Promise<void> => {
  const params = ExecuteDemoStepParams.safeParse(req.params), body = ExecuteDemoStepBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid sandbox operation." }); return; }
  const { id, step } = params.data, run = await getRun(id, res.locals.owner);
  if (!run || run.variant === "external") { res.status(404).json({ error: "Sandbox run not found." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Per-step lock prevents duplicate writes but permits shipping and inventory in parallel.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${id}:${step}`]);
    const existing = (await client.query("SELECT * FROM tl_operations WHERE run_id=$1 AND step=$2", [id, step])).rows[0];
    if (existing?.status === 200 || existing?.attempts >= 3) {
      await client.query("COMMIT"); res.status(existing.status).json(existing.result); return;
    }
    const required = step === "cart" ? [] : step === "checkout" ? ["cart", "shipping", "inventory"] : ["cart"];
    const prior = (await client.query("SELECT step,status,action_id FROM tl_operations WHERE run_id=$1", [id])).rows;
    if (!required.every(s => prior.some(p => p.step === s && p.status === 200))) {
      await client.query("ROLLBACK"); res.status(409).json({ error: "Complete prior successful steps first." }); return;
    }
    const actionId = existing?.action_id || body.data.actionId, traceId = actionId;
    const attempt = (existing?.attempts || 0) + 1, started = Date.now();
    const parentStep = step === "checkout" ? "shipping" : "cart";
    const parentRow = step === "cart" ? null : (await client.query(
      "SELECT id FROM tl_events WHERE run_id=$1 AND payload->>'stepId'=$2 AND payload->>'kind'='api' ORDER BY sequence DESC LIMIT 1",
      [id, parentStep],
    )).rows[0];
    const parent = parentRow?.id || null;
    // Simulated application latency; all outcomes come from executed server logic and SQL operations.
    await new Promise(resolve => setTimeout(resolve, step === "checkout" ? 180 : 100));
    let status = 200, message = "", data: Record<string, unknown> = {};
    if (step === "cart") { message = "Cart created"; data = { items: [{ sku: "TL-NOTEBOOK", quantity: 1, unitPrice: 24 }], subtotal: 24, currency: "USD" }; }
    if (step === "shipping") { message = "Shipping calculated"; data = { shipping: 5, service: "Standard", currency: "USD" }; }
    if (step === "inventory") { message = "Inventory checked"; data = { sku: "TL-NOTEBOOK", available: true, quantity: 1 }; }
    if (step === "checkout") {
      if (!body.data.address?.trim()) { status = 422; message = "Shipping address is required"; data = { error: "VALIDATION_ERROR", field: "address" }; }
      else if (run.variant === "transient" && attempt === 1) { status = 503; message = "Order service temporarily unavailable"; data = { error: "SERVICE_UNAVAILABLE", retryable: true }; }
      else {
        message = "Order confirmed"; data = { orderId: randomUUID(), total: 29, currency: "USD", confirmed: true };
      }
    }
    const result = { ok: status === 200, step, message, attempt, data };
    const apiId = randomUUID();
    const internal = step === "checkout" ? status === 422 ? "Validate shipping address" : status === 503 ? "Order service rejected attempt" : "Persist sandbox order"
      : step === "cart" ? "Persist sandbox cart" : step === "inventory" ? "Check synthetic inventory" : "Calculate standard shipping";
    await saveEvent(client, id, "server", {
      eventId: randomUUID(), actionId, traceId, parentId: apiId, stepId: step, kind: "internal", label: internal,
      durationMs: Date.now() - started, status, attempt,
      response: { ...data, instrumentation: "Explicit server instrumentation, not inferred from URL" },
    });
    await client.query(`INSERT INTO tl_operations(run_id,step,action_id,attempts,status,result)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,step) DO UPDATE SET attempts=$4,status=$5,result=$6`,
    [id, step, actionId, attempt, status, JSON.stringify(result)]);
    await saveEvent(client, id, "server", {
      eventId: apiId, actionId, traceId, parentId: parent, stepId: step, kind: "api",
      label: step === "cart" ? "Add to cart" : step === "shipping" ? "Calculate shipping" : step === "inventory" ? "Check inventory" : "Place order",
      method: "POST", path: `/api/demo/${id}/${step}`, status, durationMs: Date.now() - started, attempt,
      request: step === "checkout" ? { address: body.data.address } : { sku: "TL-NOTEBOOK", quantity: 1 },
      response: result,
    });
    await client.query("COMMIT");
    res.status(status).json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Sandbox or recorder transaction failed");
    // No app operation commits if its evidence could not persist.
    res.status(500).json({ error: "Recorder persistence failed. Operation was rolled back; retry safely.", recorderFailure: true });
  } finally { client.release(); }
});
export default router;
