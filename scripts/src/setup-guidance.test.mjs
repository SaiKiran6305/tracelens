import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("setup and project settings describe archival retention without deletion or blanket synthetic-data advice", async () => {
  const setup=await readFile("artifacts/tracelens/src/pages/setup.tsx","utf8");
  const form=await readFile("artifacts/tracelens/src/components/project-form.tsx","utf8");
  assert.match(setup,/automatically archived, not deleted/);
  assert.match(setup,/presence, empty state and type only/);
  assert.match(setup,/stored on the server/);
  assert.doesNotMatch(setup,/use synthetic data|runs[^<\n]*are deleted/i);
  assert.match(form,/archived, not deleted/);
});
test("integration guidance never asserts a business outcome from HTTP success alone", async () => {
  for (const path of ["artifacts/tracelens/src/pages/setup.tsx","artifacts/tracelens/src/pages/project-detail.tsx","docs/INTEGRATION-RUNBOOK.md"]) {
    const text=await readFile(path,"utf8");
    assert.doesNotMatch(text,/if\s*\(\s*(?:r|response)\.ok\s*\)\s*ctx\.outcome/);
    assert.match(text,/body\.status ===/);
    assert.match(text,/typeof body\.id === "string"/);
  }
});
