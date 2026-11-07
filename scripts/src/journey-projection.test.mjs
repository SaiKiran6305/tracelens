import test from "node:test";
import assert from "node:assert/strict";
import { projectJourney, compareJourneySteps } from "../../artifacts/tracelens/src/lib/journey.ts";

let seq = 0;
function api(stepId, status = 200, extra = {}) {
  const id = `event-${++seq}`;
  return { id, eventId: id, runId: "same-run", sequence: seq,
    actionId: stepId, stepId, kind: "api", label: stepId, source: "server",
    method: "POST", path: `/api/demo/00000000-0000-4000-8000-000000000001/${stepId}`,
    status, durationMs: 100, createdAt: "2026-11-04T00:00:01.000Z", ...extra };
}
function nav() {
  return { ...api("confirmation"), kind: "navigation", path: "/demo/confirmation", status: undefined };
}
function successEvents() {
  return [api("cart", 200, { createdAt: "2026-11-04T00:00:00.200Z" }),
    api("shipping"), api("inventory"),
    api("checkout", 200, { createdAt: "2026-11-04T00:00:02.000Z" }), nav()];
}
test("successful recording projects to five business steps and actual parallel work", () => {
  const steps = projectJourney(successEvents(), { variant: "working", status: "passed" });
  assert.equal(steps.length, 5);
  assert.ok(steps.every(s => s.status === "passed"));
  assert.equal(steps.find(s => s.id === "checkout").outcome, "Order confirmed");
  assert.equal(steps[1].parallelGroup, steps[2].parallelGroup);
  assert.ok(steps[1].parallelGroup);
  assert.equal(steps[0].parallelGroup, null);
});
test("failed checkout has observed address explanation and unreached confirmation", () => {
  const source = successEvents().filter(e => !["checkout", "confirmation"].includes(e.stepId));
  source.push(api("checkout", 422, { createdAt: "2026-11-04T00:00:02.000Z", response: { message: "Shipping address is required", data: { field: "address" } } }));
  const steps = projectJourney(source, { variant: "missing_address", status: "failed" });
  assert.equal(steps[3].outcome, "Address required");
  assert.equal(steps[3].status, "failed");
  assert.equal(steps[4].status, "not_reached");
  const baseline = projectJourney(successEvents(), { variant: "working", status: "passed" });
  const rows = compareJourneySteps(baseline, steps);
  assert.deepEqual(rows.filter(r => r.changed).map(r => r.id), ["checkout", "confirmation"]);
});
test("retry recovery retains the failed attempt and the exact underlying events", () => {
  const source = successEvents().filter(e => !["checkout", "confirmation"].includes(e.stepId));
  source.push(api("checkout", 503, { attempt: 1, response: { message: "Order service temporarily unavailable" } }));
  source.push(api("checkout", 200, { attempt: 2 }), nav());
  const before = JSON.stringify(source);
  const checkout = projectJourney(source, { variant: "transient", status: "passed" })[3];
  assert.equal(checkout.status, "recovered");
  assert.equal(checkout.outcome, "Recovered");
  assert.deepEqual(checkout.attempts.map(a => a.status), ["failed", "passed"]);
  assert.equal(checkout.attempts[0].explanation, "Order service temporarily unavailable");
  assert.equal(checkout.events[0], source[3]);
  assert.equal(JSON.stringify(source), before, "Projection must never mutate or rerecord a run");
});
test("incidental request overlap does not become the first customer-visible change", () => {
  const baseline = projectJourney(successEvents(), { variant: "working", status: "passed" });
  const source = successEvents().filter(e => !["checkout", "confirmation"].includes(e.stepId));
  source[2] = { ...source[2], createdAt: "2026-11-04T00:00:01.300Z" };
  source.push(api("checkout", 503, { attempt: 1, createdAt: "2026-11-04T00:00:02.000Z" }));
  source.push(api("checkout", 200, { attempt: 2, createdAt: "2026-11-04T00:00:02.200Z" }), nav());
  const current = projectJourney(source, { variant: "transient", status: "passed" });
  assert.notEqual(baseline[1].parallelGroup, current[1].parallelGroup);
  assert.deepEqual(compareJourneySteps(baseline, current).filter(r => r.changed).map(r => r.id), ["checkout"]);
});
test("incomplete or external evidence never invents completion or backend reasons", () => {
  const click = { ...api("invite"), kind: "click", status: undefined, label: 'Click "Invite colleague"' };
  const external = projectJourney([click], { variant: "external", status: "failed" });
  assert.equal(external.length, 1);
  assert.equal(external[0].status, "observed");
  assert.equal(external[0].label, "Invite colleague");
  const pending = projectJourney([], { variant: "working", status: "recording" });
  assert.ok(pending.every(s => s.status === "pending"));
});
test("unknown application failure remains generic rather than guessing an address problem", () => {
  const step = projectJourney([api("checkout", 422)], { variant: "working", status: "failed" })[3];
  assert.equal(step.outcome, "Could not complete");
  assert.ok(!step.explanation.includes("address"));
});
test("real workflows require explicit matching expected outcomes, not a successful HTTP response", () => {
  const expected = [{ id: "submit", label: "Submit request", outcome: "created" }];
  const response = api("submit", 201);
  const httpOnly = projectJourney([response], { variant: "external", status: "unknown" }, expected);
  assert.equal(httpOnly[0].status, "unknown");
  const assertion = { ...api("submit"), kind: "outcome", response: { outcome: "created", message: "Request created" } };
  const passed = projectJourney([response, assertion], { variant: "external", status: "passed" }, expected);
  assert.equal(passed[0].status, "passed");
  const changedExpected = projectJourney([response, assertion], { variant: "external", status: "failed" }, [{ ...expected[0], outcome: "approved" }]);
  assert.equal(compareJourneySteps(passed, changedExpected)[0].changed, true);
});
test("untouched expected real steps stay pending until conclusion, including an empty flow", () => {
  const expected = [{ id: "submit", label: "Submit request", outcome: "created" }];
  assert.equal(projectJourney([], { variant: "external", status: "recording" }, expected)[0].status, "pending");
  assert.equal(projectJourney([], { variant: "external", status: "incomplete" }, expected)[0].status, "not_reached");
});
