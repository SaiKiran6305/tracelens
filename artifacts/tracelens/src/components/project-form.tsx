import { useState } from "react";
import { inputCls, btnPrimary } from "@/components/bits";
import { Field } from "@/components/project-bits";
import type { ExpectedStep, ProjectInput } from "@/lib/project-api";

export const EXAMPLE_STEPS = `[
  { "id": "request", "label": "Create request", "outcome": "created" }
]`;

function parseOrigins(text: string): { origins: string[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { origins: [], error: "List at least one origin." };
  for (const l of lines) {
    try {
      const u = new URL(l);
      if (u.origin !== l) return { origins: [], error: `"${l}" is not an exact origin. Use scheme://host[:port] with no path or trailing slash (e.g. ${u.origin}).` };
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return { origins: [], error: `"${l}" must use https (http is only allowed for localhost).` };
    } catch { return { origins: [], error: `"${l}" is not a valid origin.` }; }
  }
  return { origins: [...new Set(lines)], error: null };
}

function parseSteps(text: string): { steps: ExpectedStep[]; error: string | null } {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { return { steps: [], error: `Invalid JSON: ${(e as Error).message}` }; }
  if (!Array.isArray(v) || !v.length) return { steps: [], error: "Steps must be a non-empty JSON array." };
  const ids = new Set<string>();
  for (const [i, s] of v.entries()) {
    if (!s || typeof s !== "object") return { steps: [], error: `Step ${i + 1} must be an object.` };
    const { id, label, outcome } = s as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return { steps: [], error: `Step ${i + 1}: "id" must be a short identifier like "request".` };
    if (ids.has(id)) return { steps: [], error: `Duplicate step id "${id}".` };
    ids.add(id);
    if (typeof label !== "string" || !label.trim()) return { steps: [], error: `Step ${i + 1}: "label" is required.` };
    if (typeof outcome !== "string" || !outcome.trim()) return { steps: [], error: `Step ${i + 1}: "outcome" key is required (e.g. "created").` };
  }
  return { steps: (v as ExpectedStep[]).map(({ id, label, outcome }) => ({ id, label: label.trim(), outcome: outcome.trim() })), error: null };
}

export function ProjectForm({
  initial, includeUrl = true, submitLabel, pending, onSubmit, serverError,
}: {
  initial?: Partial<ProjectInput>;
  includeUrl?: boolean;
  submitLabel: string;
  pending?: boolean;
  serverError?: string | null;
  onSubmit: (data: ProjectInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [origins, setOrigins] = useState((initial?.origins ?? []).join("\n"));
  const [workflowName, setWorkflowName] = useState(initial?.workflowName ?? "");
  const [steps, setSteps] = useState(initial?.steps ? JSON.stringify(initial.steps, null, 2) : EXAMPLE_STEPS);
  const [retention, setRetention] = useState(String(initial?.retentionDays ?? 30));
  const [touched, setTouched] = useState(false);

  const o = parseOrigins(origins);
  const s = parseSteps(steps);
  const ret = Number(retention);
  let urlErr: string | null = null;
  if (includeUrl) {
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) urlErr = "Use an http(s) URL."; } catch { urlErr = "Enter the full URL of your application, e.g. https://app.example.com."; }
  }
  const errs = {
    name: name.trim() ? null : "Name your project.",
    url: urlErr,
    origins: o.error,
    workflowName: workflowName.trim() ? null : "Name the workflow you will record.",
    steps: s.error,
    retention: Number.isInteger(ret) && ret >= 1 && ret <= 90 ? null : "Whole number of days between 1 and 90.",
  };
  const valid = Object.values(errs).every((e) => !e);
  const show = (e: string | null) => (touched ? e : null);

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        onSubmit({ name: name.trim(), url: url.trim(), origins: o.origins, workflowName: workflowName.trim(), steps: s.steps, retentionDays: ret });
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Project name" error={show(errs.name)}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Field service portal" data-testid="input-project-name" />
        </Field>
        {includeUrl && (
          <Field label="Application URL" hint="Where the real application lives. A valid URL is not proof of installation; verification happens through the SDK." error={show(errs.url)}>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://portal.example.com" inputMode="url" data-testid="input-project-url" />
          </Field>
        )}
      </div>
      <Field label="Allowed origins" hint="One exact origin per line. The collector rejects browser events from anything else. No wildcards." error={show(errs.origins)}>
        <textarea className={inputCls + " min-h-[96px] font-mono text-[13px]"} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder={"https://portal.example.com\nhttp://localhost:5173"} data-testid="input-project-origins" />
      </Field>
      <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
        <Field label="Workflow name" error={show(errs.workflowName)}>
          <input className={inputCls} value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} placeholder="Create service request" data-testid="input-project-workflow" />
        </Field>
        <Field label="Archive after (days)" hint="1 to 90. Older concluded runs are archived, not deleted. Baselines are preserved; archived runs can be restored." error={show(errs.retention)}>
          <input className={inputCls} type="number" min={1} max={90} value={retention} onChange={(e) => setRetention(e.target.value)} data-testid="input-project-retention" />
        </Field>
      </div>
      <Field label="Expected steps (JSON)" hint={'Array of { id, label, outcome }. The outcome key must match exactly what your app reports with ctx.outcome().'} error={show(errs.steps)}>
        <textarea className={inputCls + " min-h-[160px] font-mono text-[13px]"} spellCheck={false} value={steps} onChange={(e) => setSteps(e.target.value)} data-testid="input-project-steps" />
      </Field>
      {!s.error && (
        <ol className="flex flex-wrap gap-2" aria-label="Parsed steps">
          {s.steps.map((st, i) => (
            <li key={st.id} className="rounded-full border border-border bg-card px-3 py-1 text-xs"><span className="font-mono text-muted-foreground">{i + 1}.</span> {st.label} <span className="font-mono text-ok">→ {st.outcome}</span></li>
          ))}
        </ol>
      )}
      {serverError && <p className="rounded-xl border border-fail/30 bg-fail/5 p-3 text-sm text-fail" role="alert">{serverError}</p>}
      <button type="submit" className={btnPrimary} disabled={pending} data-testid="button-submit-project">{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
