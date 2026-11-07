import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { pool } from "@workspace/db";
import type { Request, Response } from "express";

export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const expectedStep = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  label: z.string().trim().min(1).max(100),
  outcome: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
}).strict();
export const stepList = z.array(expectedStep).min(1).max(40).refine(s => new Set(s.map(x => x.id)).size === s.length, "Step identifiers must be unique.");
export function validOrigin(v: string) {
  try {
    const u = new URL(v);
    return u.origin === v && !u.username && !u.password &&
      (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
  } catch { return false; }
}
export const projectInput = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().url().max(2048).refine(v => { try { const u = new URL(v); return validOrigin(u.origin) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; } }, "Use an HTTPS URL without credentials, query, or hash (HTTP allowed only on loopback)."),
  origins: z.array(z.string().refine(validOrigin, "Use exact HTTPS origins, not paths or wildcards.")).min(1).max(10),
  workflowName: z.string().trim().min(1).max(100),
  steps: stepList,
  retentionDays: z.number().int().min(1).max(90).default(30),
}).strict().refine(p => p.origins.includes(new URL(p.url).origin), "Allow the project's own URL origin.");

export const eventInput = z.object({
  eventId: z.string().min(1).max(100), actionId: z.string().min(1).max(100),
  parentId: z.string().max(100).nullable().optional(), traceId: z.string().max(100).optional(),
  stepId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  kind: z.enum(["click", "navigation", "api", "outcome", "recorder", "internal"]),
  label: z.string().max(150), method: z.string().regex(/^[A-Z]{1,12}$/).optional(),
  recordedAt: z.string().datetime().refine(v => Math.abs(Date.now() - Date.parse(v)) <= 3600000, "Event time is outside the recording window.").optional(),
  path: z.string().max(2048).optional(), status: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().min(0).max(3600000).optional(), attempt: z.number().int().min(1).max(50).optional(),
  // No arbitrary request/response values enter the collector. Only declared field metadata.
  request: z.object({ fields: z.record(z.string().max(64), z.object({
    present: z.boolean(), empty: z.boolean(), type: z.enum(["string", "number", "boolean", "object", "array", "null", "undefined"]), redacted: z.literal(true),
  }).strict()).optional() }).strict().optional(),
  response: z.object({
    outcome: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
    message: z.string().max(150).optional(),
    fields: z.record(z.string().max(64), z.object({
      present: z.boolean(), empty: z.boolean(), type: z.enum(["string", "number", "boolean", "object", "array", "null", "undefined"]), redacted: z.literal(true),
    }).strict()).optional(),
  }).strict().optional(),
}).strict();
export function safeCollectorPath(v?: string) {
  if (!v) return undefined;
  try {
    return new URL(v, "https://redacted.invalid").pathname
      .replace(/[a-f0-9]{8}-[a-f0-9-]{27}/ig, ":id").replace(/\/\d+(?=\/|$)/g, "/:id").slice(0, 500);
  } catch { return "/"; }
}
export async function limited(bucket: string, max: number, seconds = 60) {
  const w = Math.floor(Date.now() / (seconds * 1000));
  const { rows } = await pool.query(`INSERT INTO tl_rate_limits(bucket,window_id) VALUES($1,$2)
   ON CONFLICT(bucket,window_id) DO UPDATE SET count=tl_rate_limits.count+1 RETURNING count`, [bucket, w]);
  return rows[0].count <= max;
}
export function dashboardWriteSafe(req: Request, res: Response) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.get("origin");
  const host = req.get("x-forwarded-host") || req.get("host");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host : ""; } catch { originHost = "invalid"; }
  if (req.get("sec-fetch-site") === "cross-site" || (origin && originHost !== host) ||
    !req.is("application/json")) {
    res.status(403).json({ error: "Use the signed-in dashboard with a same-origin JSON request." }); return false;
  }
  return true;
}
