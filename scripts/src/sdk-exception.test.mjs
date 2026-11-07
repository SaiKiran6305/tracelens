import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { sdkSource } from "../../artifacts/api-server/src/lib/sdk.ts";

test("application exceptions remain visible without recording private error messages", async () => {
  const stored = [];
  const originalFetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/connect")) return Response.json({ purpose: "record", runId: "run-1", lastSequence: 0 });
    if (path.endsWith("/events")) {
      const { events } = JSON.parse(options.body);
      stored.push(...events);
      return Response.json({ accepted: events.map((event) => event.eventId), lastSequence: stored.length });
    }
    if (path.endsWith("/finish")) return Response.json({ status: "failed" });
    return Response.json({ status: "created" });
  };
  const values = new Map();
  const sandbox = {
    URL, Response, AbortController, performance, crypto: webcrypto,
    location: { href: "https://app.example/" }, fetch: originalFetch,
    setTimeout, clearTimeout,
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timer.unref(); return timer; },
    clearInterval, queueMicrotask,
    CustomEvent: class {}, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    document: { addEventListener() {}, removeEventListener() {} },
    history: { pushState() {}, replaceState() {} },
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(sdkSource, sandbox);
  const recorder = await sandbox.TraceLens.connect({
    collectorUrl: "https://collector.example/api/collector", projectId: "tl_test",
    session: "temporary-session", consent: true,
  });

  await assert.rejects(recorder.step("submit", () => {
    throw new Error("private customer name: Ada");
  }), /private customer name: Ada/);
  await assert.rejects(recorder.step("confirm", async () => {
    await Promise.resolve();
    throw new Error("private order number: 123");
  }), /private order number: 123/);

  assert.equal((await recorder.stop()).status, "failed");
  assert.equal(sandbox.fetch, originalFetch, "the application fetch is restored");
  const exceptions = stored.filter((event) => event.response?.outcome === "exception");
  assert.deepEqual(exceptions.map((event) => event.stepId), ["submit", "confirm"]);
  assert.ok(exceptions.every((event) => event.parentId && event.actionId));
  assert.ok(!JSON.stringify(stored).includes("Ada"));
  assert.ok(!JSON.stringify(stored).includes("123"));
});
