import assert from "node:assert/strict";

const origin = process.env.TRACELENS_TEST_ORIGIN || "http://localhost:80";
let cookie = "";
async function request(path, body, expected = 200, useCookie = true) {
  const response = await fetch(origin + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(useCookie && cookie ? { cookie } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (useCookie && response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const journey = (await request("/journeys"))[0];
async function event(id, step, kind = "click", extra = {}) {
  return request(`/runs/${id}/events`, {
    eventId: `${step}-${kind}`, actionId: step, stepId: step, kind, label: step, ...extra,
  }, 201);
}
async function execute(variant) {
  const run = await request("/runs", { journeyId: journey.id, variant }, 201);
  await event(run.id, "cart");
  await request(`/demo/${run.id}/cart`, { actionId: "cart" });
  await Promise.all(["shipping", "inventory"].map(async step => {
    await event(run.id, step);
    await request(`/demo/${run.id}/${step}`, { actionId: step });
  }));
  await event(run.id, "checkout");
  const result = await request(`/demo/${run.id}/checkout`, {
    actionId: "checkout", address: variant === "missing_address" ? "" : "Synthetic test address",
  }, variant === "missing_address" ? 422 : variant === "transient" ? 503 : 200);
  if (result.ok) await event(run.id, "confirmation", "navigation", { path: "/confirmation" });
  await request(`/runs/${run.id}/finish`, {});
  return run;
}
const baseline = await execute("working");
assert.equal((await request(`/runs/${baseline.id}`)).run.status, "passed");
await request(`/runs/${baseline.id}/baseline`, {});
const second = await execute("working");
assert.equal((await request(`/compare?baselineId=${baseline.id}&runId=${second.id}`)).changedCount, 0);
const failure = await execute("missing_address");
const comparison = await request(`/compare?baselineId=${baseline.id}&runId=${failure.id}`);
assert.ok(comparison.firstDivergence.includes("checkout"));
assert.ok(comparison.rows.some(r => r.reasons.some(s => s.includes("422"))));
const checkoutDiff = comparison.rows.find(r => r.current?.kind === "api" && r.current.stepId === "checkout");
assert.deepEqual(checkoutDiff.baseline.request.address, { redacted: true, present: true, empty: false, type: "string" });
assert.deepEqual(checkoutDiff.current.request.address, { redacted: true, present: true, empty: true, type: "string" });
assert.ok(checkoutDiff.reasons.includes("request.address.empty: false → true"));
assert.ok(!JSON.stringify(comparison).includes("Synthetic test address"));
assert.equal((await request(`/runs/${failure.id}`)).run.status, "failed");
await request(`/runs/${failure.id}/baseline`, {}, 409);
const transient = await execute("transient");
const before = await request(`/runs/${transient.id}`);
assert.equal(before.run.status, "failed");
const retried = await request(`/demo/${transient.id}/checkout`, { actionId: "checkout", address: "Synthetic test address" });
assert.equal(retried.attempt, 2);
const duplicate = await request(`/demo/${transient.id}/checkout`, { actionId: "checkout", address: "Synthetic test address" });
assert.deepEqual(duplicate, retried);
await event(transient.id, "confirmation", "navigation", { path: "/confirmation" });
assert.equal((await request(`/runs/${transient.id}/finish`, {})).status, "passed");
const after = await request(`/runs/${transient.id}`);
assert.equal(after.events.filter(e => e.kind === "api" && e.stepId === "cart").length, 1);
assert.equal(after.events.filter(e => e.kind === "api" && e.stepId === "checkout").length, 2);
assert.equal((await request(`/runs/${transient.id}`)).lastSequence, after.lastSequence);
const redacted = await event(second.id, "redaction", "api", {
  method: "POST", path: "/example?token=must-not-store",
  request: { password: "must-not-store", nested: { authorization: "must-not-store" } },
});
assert.equal(redacted.request.password, "[redacted]");
assert.equal(redacted.request.nested.authorization, "[redacted]");
assert.equal(redacted.path, "/example");
const duplicateEvent = await event(second.id, "redaction", "api");
assert.equal(duplicateEvent.sequence, redacted.sequence);
for (const [index, address, type, empty] of [[0, "", "string", true], [1, 42, "number", false], [2, null, "null", true]]) {
  const safe = await event(second.id, `address-meta-${index}`, "api", { request: { address } });
  assert.deepEqual(safe.request.address, { redacted: true, present: true, empty, type });
}
const omitted = await request("/runs", { journeyId: journey.id, variant: "working" }, 201);
for (const step of ["cart", "shipping", "inventory"]) await request(`/demo/${omitted.id}/${step}`, { actionId: step });
await request(`/demo/${omitted.id}/checkout`, { actionId: "checkout" }, 422);
const missingAddress = (await request(`/runs/${omitted.id}`)).events.find(e => e.kind === "api" && e.stepId === "checkout");
assert.deepEqual(missingAddress.request.address, { redacted: true, present: false, empty: true, type: "undefined" });
await request(`/runs/${omitted.id}/finish`, {});
await request(`/runs/${baseline.id}`, undefined, 404, false);
const repeated = await request(`/demo/${baseline.id}/checkout`, { actionId: "another-action", address: "changed" });
assert.equal(repeated.attempt, 1);
assert.ok(comparison.markdown.includes("no root cause"));
console.info("PASS: baseline, identical-run alignment, validation divergence, persistence, failed-step retry, write/event idempotency, redaction and workspace isolation.");
