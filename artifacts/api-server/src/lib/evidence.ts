import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export type Evidence = {
  eventId: string; actionId: string; stepId: string; kind: string; label: string;
  traceId?: string; parentId?: string | null; method?: string; path?: string;
  status?: number; durationMs?: number; request?: unknown; response?: unknown; attempt?: number;
  recordedAt?: string;
};
export type StoredEvent = Evidence & {
  id: string; runId: string; sequence: number; createdAt: string; source: string;
};
export type Queryable = Pick<typeof pool, "query">;

const secretKey = /password|passwd|secret|token|authorization|cookie|api.?key|credential|card|cvv|email|address/i;
function sensitiveMetadata(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (v.redacted === true && typeof v.present === "boolean" && typeof v.empty === "boolean" &&
      typeof v.type === "string" && ["string", "number", "boolean", "object", "array", "null", "undefined"].includes(v.type) &&
      Object.keys(v).every(k => ["redacted", "present", "empty", "type"].includes(k))) return v;
  }
  return {
    redacted: true,
    present: value !== undefined,
    empty: typeof value === "string" ? value.trim().length === 0 : value == null ? true : false,
    type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
  };
}
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 30).map(v => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, val]) =>
      [key, /address/i.test(key) ? sensitiveMetadata(val) : secretKey.test(key) ? "[redacted]" : redact(val, depth + 1)]));
  }
  if (typeof value === "string") {
    return value.slice(0, 1000)
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
      .replace(/(?:sk-|ghp_|eyJ)[A-Za-z0-9_.-]{12,}/g, "[redacted]");
  }
  return value;
}
export function safePath(path: string) {
  try { return new URL(path, "https://local.invalid").pathname.slice(0, 300); }
  catch { return "/invalid-path"; }
}
export function normalizePath(path = "") {
  return safePath(path).replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:id");
}
export function mapEvent(row: any): StoredEvent {
  return { ...row.payload, id: row.id, runId: row.run_id, sequence: Number(row.sequence),
    createdAt: new Date(row.created_at).toISOString(), source: row.source };
}
export async function saveEvent(q: Queryable, runId: string, source: "server" | "browser", input: Evidence) {
  const payload = {
    ...input, traceId: input.traceId || input.actionId,
    label: redact(input.label), path: input.path ? safePath(input.path) : undefined,
    request: redact(input.request), response: redact(input.response),
  };
  const result = await q.query(
    `INSERT INTO tl_events(id,run_id,source,payload,created_at) VALUES($1,$2,$3,$4,coalesce($5::timestamptz,clock_timestamp()))
     ON CONFLICT(run_id,id) DO UPDATE SET id=excluded.id RETURNING *`,
    [input.eventId || randomUUID(), runId, source, JSON.stringify(payload), source === "browser" ? input.recordedAt || null : null],
  );
  return mapEvent(result.rows[0]);
}

const volatile = /^(id|.*Id|.*_id|timestamp|createdAt|updatedAt|durationMs|trace|sequence|orderNumber)$/i;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).filter(([k]) => !volatile.test(k)).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stable(v)]));
  return value;
}
function diffs(a: unknown, b: unknown, prefix: string): string[] {
  if (JSON.stringify(stable(a)) === JSON.stringify(stable(b))) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const aa = stable(a) as Record<string, unknown>, bb = stable(b) as Record<string, unknown>;
    return [...new Set([...Object.keys(aa), ...Object.keys(bb)])].flatMap(k => diffs(aa[k], bb[k], `${prefix}.${k}`));
  }
  return [`${prefix}: ${a === undefined ? "missing" : JSON.stringify(a)} → ${b === undefined ? "missing" : JSON.stringify(b)}`];
}
export function compareEvidence(a: StoredEvent[], b: StoredEvent[], includeInternal = false) {
  // Server internal evidence stays attached in drawers; compare observable browser steps and API attempts.
  const filter = (es: StoredEvent[]) => es.filter(e => ["click", "navigation", "api", "outcome"].includes(e.kind) || (includeInternal && e.kind === "internal"));
  const keyed = (es: StoredEvent[]) => {
    const counts = new Map<string, number>();
    return filter(es).map(e => {
      const key = `${e.stepId}|${e.kind}|${e.method || ""}|${e.kind === "api" ? normalizePath(e.path) : ""}`;
      const n = (counts.get(key) || 0) + 1; counts.set(key, n);
      return [`${key}|${n}`, e] as const;
    });
  };
  const aa = new Map(keyed(a)), bb = new Map(keyed(b));
  const keys = [...aa.keys()];
  for (const key of bb.keys()) if (!aa.has(key)) {
    const previous = [...bb.keys()].slice(0, [...bb.keys()].indexOf(key)).reverse().find(k => keys.includes(k));
    keys.splice(previous ? keys.indexOf(previous) + 1 : 0, 0, key);
  }
  return keys.map(key => {
    const baseline = aa.get(key) || null, current = bb.get(key) || null;
    const reasons: string[] = [];
    if (!baseline) reasons.push("Extra observed step");
    else if (!current) reasons.push("Expected step was not observed");
    else {
      if (baseline.status !== current.status) reasons.push(`HTTP status: ${baseline.status ?? "none"} → ${current.status ?? "none"}`);
      if (baseline.kind === "navigation" && baseline.path !== current.path) reasons.push(`Navigation: ${baseline.path} → ${current.path}`);
      reasons.push(...diffs(baseline.request, current.request, "request"), ...diffs(baseline.response, current.response, "response"));
      // IDs differ across runs: compare dependency step identity rather than volatile parent IDs.
      const parentStep = (e: StoredEvent, all: StoredEvent[]) => all.find(p => p.id === e.parentId || p.actionId === e.parentId)?.stepId || null;
      if (parentStep(baseline, a) !== parentStep(current, b)) reasons.push("Observed dependency changed");
    }
    return { key, label: (baseline || current)!.label,
      change: !baseline ? "extra" : !current ? "missing" : reasons.length ? "changed" : "unchanged",
      reasons, baseline, current };
  });
}
