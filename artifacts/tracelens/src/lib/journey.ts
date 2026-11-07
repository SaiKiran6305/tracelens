import type { Run, TraceEvent } from "@workspace/api-client-react";

export type StepStatus = "pending" | "passed" | "failed" | "recovered" | "not_reached" | "observed" | "unknown";
export interface ExpectedStep { id: string; label: string; outcome: string }
export interface JourneyAttempt {
  number: number;
  status: "passed" | "failed";
  explanation: string;
  events: TraceEvent[];
}
export interface JourneyStep {
  id: string;
  label: string;
  status: StepStatus;
  outcome: string;
  explanation: string;
  attempts: JourneyAttempt[];
  events: TraceEvent[];
  parallelGroup: string | null;
}
const demoSteps = [
  ["cart", "Add to cart"], ["shipping", "Choose delivery"], ["inventory", "Check availability"],
  ["checkout", "Submit order"], ["confirmation", "Confirmation"],
] as const;
const success: Record<string, string> = {
  cart: "Added to cart", shipping: "Delivery available", inventory: "In stock",
  checkout: "Order confirmed", confirmation: "Confirmation shown",
};
const ok = (e: TraceEvent) => e.status != null && e.status >= 200 && e.status < 400;
const failed = (e: TraceEvent) => e.status != null && (e.status >= 400 || e.status === 0);
function outcome(e: TraceEvent, step: string): string {
  if (ok(e)) return success[step] || "Completed";
  const data = e.response?.data;
  if (data && typeof data === "object" && "field" in data && data.field === "address") return "Address required";
  const message = e.response?.message;
  if (typeof message === "string" && !/\/api\/|https?:|[a-f0-9]{8}-[a-f0-9-]{27}/i.test(message)) {
    return message.slice(0, 150);
  }
  return failed(e) ? "Could not complete" : "Observed";
}
function interval(events: TraceEvent[]) {
  const timed = events.filter(e => e.kind === "api");
  return {
    start: Math.min(...timed.map(e => Date.parse(e.createdAt) - (e.durationMs || 0))),
    end: Math.max(...timed.map(e => Date.parse(e.createdAt))),
  };
}
/** Pure presentation projection: no network calls, state changes, or invented backend stages. */
export function projectJourney(events: TraceEvent[], run: Pick<Run, "variant" | "status">, expected: ExpectedStep[] = []): JourneyStep[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const demo = run.variant !== "external";
  const ids = demo ? [...demoSteps.map(([id]) => id), ...new Set(ordered.map(e => e.stepId).filter(id => !demoSteps.some(([s]) => s === id)))]
    : [...new Set([...expected.map(s => s.id), ...ordered.filter(e => e.kind !== "recorder").map(e => e.stepId)])];
  const steps: JourneyStep[] = ids.map(id => {
    const es = ordered.filter(e => e.stepId === id && e.kind !== "recorder");
    const observedLabel = es.find(e => e.kind === "click")?.label;
    const technical = /\/api\/|[a-f0-9]{8}-[a-f0-9-]{27}|HTTP\s*\d{3}|\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//i;
    const spec = expected.find(s => s.id === id);
    const label = spec?.label || demoSteps.find(([s]) => demo && s === id)?.[1] ||
      (observedLabel && !technical.test(observedLabel) ? observedLabel.replace(/^Click\s+["']?|["']$/g, "")
        : technical.test(id) ? "Journey step" : id.replace(/[-_]/g, " ").replace(/^\w/, c => c.toUpperCase()));
    const apis = es.filter(e => e.kind === "api");
    const latest = new Map<string, TraceEvent>();
    apis.forEach(e => latest.set(`${e.method}|${e.path}`, e));
    const last = apis.at(-1);
    const assertion = es.filter(e => typeof e.response?.outcome === "string" && (e.kind === "outcome" || e.source === "server")).at(-1);
    const explicit = assertion?.response?.outcome;
    const outcomeReported = !!spec && typeof explicit === "string";
    const verified = outcomeReported && explicit === spec!.outcome;
    const safeMessage = typeof assertion?.response?.message === "string" && !technical.test(assertion.response.message)
      ? assertion.response.message : undefined;
    let status: StepStatus;
    if (!es.length) status = run.status === "recording" ? "pending" : "not_reached";
    else if ([...latest.values()].some(failed)) status = "failed";
    else if (!demo && outcomeReported) status = verified ? apis.some(failed) ? "recovered" : "passed" : "failed";
    else if (!demo && apis.length) status = "unknown";
    else if (apis.length && [...latest.values()].every(ok)) status = apis.some(failed) ? "recovered" : "passed";
    else if (id === "confirmation" && es.some(e => e.kind === "navigation")) status = "passed";
    else status = "observed";
    const attempts = apis.map((e, index): JourneyAttempt => ({
      number: e.attempt || index + 1, status: ok(e) ? "passed" : "failed", explanation: demo ? outcome(e, id) : ok(e) ? "Request completed. This alone does not verify the business outcome." : "The request did not complete successfully.",
      events: es.filter(child => child.id === e.id || child.parentId === e.id),
    }));
    const result = status === "recovered" ? "Recovered" : !demo && status === "failed" ? safeMessage || "Could not complete"
      : status === "failed" && last ? outcome([...latest.values()].find(failed) || last, id)
      : status === "passed" ? demo ? success[id] || "Completed" : safeMessage || "Expected outcome reported"
      : status === "not_reached" ? "Not reached"
      : status === "pending" ? "Waiting" : status === "unknown" ? "Outcome unverified" : "Observed";
    const explanation = status === "recovered"
      ? `An earlier attempt failed; a later attempt completed successfully. ${demo && last ? outcome(last, id) : safeMessage || "The application reported the expected outcome"}.`
      : status === "failed" ? result
      : status === "not_reached" ? "This step was not recorded before the run ended."
      : status === "pending" ? "Waiting for this step."
      : status === "unknown" ? "A request was observed, but the application did not report the expected business outcome."
      : status === "observed" ? "An action was recorded; no completion outcome was captured."
      : demo ? result : `${result}. This outcome was explicitly reported by the application.`;
    return { id, label, status, outcome: result, explanation, attempts, events: es, parallelGroup: null };
  });
  // Retain actual overlap rather than treating neighbouring actions as serial.
  const roots = steps.map((_, i) => i);
  const root = (i: number): number => roots[i] === i ? i : (roots[i] = root(roots[i]));
  for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) {
    const a = interval(steps[i].events), b = interval(steps[j].events);
    if (Math.min(a.end, b.end) - Math.max(a.start, b.start) > 2) {
      roots[root(j)] = root(i);
    }
  }
  steps.forEach((s, i) => {
    const members = steps.filter((_, j) => root(j) === root(i));
    if (members.length > 1) s.parallelGroup = `parallel-${members.map(m => m.id).sort().join("-")}`;
  });
  return steps;
}

export function compareJourneySteps(baseline: JourneyStep[], current: JourneyStep[]) {
  const ids = [...new Set([...baseline.map(s => s.id), ...current.map(s => s.id)])];
  return ids.map(id => {
    const a = baseline.find(s => s.id === id) || null, b = current.find(s => s.id === id) || null;
    return { id, label: a?.label || b!.label, baseline: a, current: b,
      changed: !a || !b || a.status !== b.status || a.outcome !== b.outcome };
  });
}
