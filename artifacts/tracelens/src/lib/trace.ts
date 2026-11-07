import { formatDistanceToNowStrict } from "date-fns";
import type { ComparisonRow, TraceEvent } from "@workspace/api-client-react";

/** Display only; the full observed path remains on the event and in its evidence. */
export function displayPath(path = ""): string {
  return path.split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function presentationName(name: string, mode: "journey" | "developer"): string {
  return mode === "journey" ? name.replace(/Transient 503/gi, "Temporary failure") : name;
}

export function divergenceSummary(row: ComparisonRow): string {
  if (row.change === "missing") return `${row.label} happened in the baseline but was not recorded in this run.`;
  if (row.change === "extra") return `${row.label} was recorded only in this run.`;
  const a = row.baseline, b = row.current;
  const status = a?.status !== b?.status
    ? `${row.label} returned HTTP ${b?.status ?? "no response"} instead of ${a?.status ?? "no response"}.`
    : `${row.label} has different request or response content.`;
  const address = b?.request?.address;
  if (address && typeof address === "object" && "empty" in address && address.empty === true) {
    return `${status} The shipping address was empty.`;
  }
  const message = b?.response?.message;
  return typeof message === "string" && a?.status !== b?.status ? `${status} ${message.slice(0, 120)}.` : status;
}

export function readableReason(reason: string): string {
  return reason
    .replace(/request\.address\.empty: false → true/g, "Shipping address changed from filled to empty.")
    .replace(/request\.address\.empty: true → false/g, "Shipping address changed from empty to filled.")
    .replace(/request\.address\.present: true → false/g, "Shipping address field is missing from this request.")
    .replace(/request\.address\.present: false → true/g, "Shipping address field was added to this request.")
    .replace(/request\.address\.type:/g, "Shipping address field type:");
}

export type Tone = "ok" | "fail" | "warn" | "neutral" | "live";

export function fmtMs(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function ago(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`;
  } catch {
    return "—";
  }
}

export function eventTone(e: Pick<TraceEvent, "kind" | "status">): Tone {
  if (e.kind === "recorder") return "warn";
  if (e.status != null && e.status >= 400) return "fail";
  if (e.status != null && e.status < 400) return "ok";
  return "neutral";
}

export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 14)
      : Math.random().toString(36).slice(2, 16);
  return `${prefix}_${rnd}`;
}

export function errStatus(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const VARIANT_LABEL: Record<string, string> = {
  working: "Working path",
  missing_address: "Missing address",
  transient: "Temporary failure",
  external: "External app",
};

export interface Lane {
  stepId: string;
  events: { event: TraceEvent; depth: number }[];
  start: number;
  end: number;
  timed: boolean;
}

/** Groups events into step lanes; lanes whose timed evidence overlaps are placed in the same column (parallel). */
export function buildColumns(events: TraceEvent[]): Lane[][] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const byEventId = new Map(sorted.map((e) => [e.eventId, e]));
  const lanes = new Map<string, { raw: TraceEvent[]; start: number; end: number; timed: boolean }>();
  for (const e of sorted) {
    let l = lanes.get(e.stepId);
    if (!l) {
      l = { raw: [], start: Infinity, end: -Infinity, timed: false };
      lanes.set(e.stepId, l);
    }
    l.raw.push(e);
    if (e.kind === "api" || e.kind === "internal") {
      const t = Date.parse(e.createdAt);
      if (!Number.isNaN(t)) {
        l.start = Math.min(l.start, t - (e.durationMs ?? 0));
        l.end = Math.max(l.end, t);
        l.timed = true;
      }
    }
  }
  const built: Lane[] = [];
  for (const [stepId, l] of lanes) {
    const inLane = new Set(l.raw.map((e) => e.eventId));
    const children = new Map<string, TraceEvent[]>();
    const roots: TraceEvent[] = [];
    for (const e of l.raw) {
      if (e.parentId && inLane.has(e.parentId) && byEventId.has(e.parentId)) {
        const arr = children.get(e.parentId) ?? [];
        arr.push(e);
        children.set(e.parentId, arr);
      } else roots.push(e);
    }
    const out: { event: TraceEvent; depth: number }[] = [];
    const walk = (e: TraceEvent, d: number) => {
      out.push({ event: e, depth: Math.min(d, 4) });
      for (const c of children.get(e.eventId) ?? []) walk(c, d + 1);
    };
    roots.forEach((r) => walk(r, 0));
    built.push({ stepId, events: out, start: l.start, end: l.end, timed: l.timed });
  }
  const cols: Lane[][] = [];
  for (const lane of built) {
    const prev = cols[cols.length - 1];
    if (
      prev &&
      lane.timed &&
      prev.some((p) => p.timed && Math.min(p.end, lane.end) - Math.max(p.start, lane.start) > 2)
    )
      prev.push(lane);
    else cols.push([lane]);
  }
  return cols;
}
