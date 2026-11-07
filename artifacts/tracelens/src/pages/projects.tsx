import { useState } from "react";
import { Link } from "wouter";
import { ArchiveRestore, ChevronLeft, ChevronRight, Plug, ShieldCheck, ShieldQuestion } from "lucide-react";
import { ErrorState, PageHeader, Skel, btnGhost, btnPrimary } from "@/components/bits";
import { useArchiveProject, useProjects } from "@/lib/project-api";
import { ago, errMessage } from "@/lib/trace";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const LIMIT = 25;

export default function Projects() {
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = useProjects(archived, offset, LIMIT);
  const archive = useArchiveProject();
  const { toast } = useToast();
  const projects = q.data?.projects ?? [];
  const total = q.data?.total ?? 0;
  const verified = projects.filter((p) => p.verifiedAt).length;
  const runs = projects.reduce((a, p) => a + p.runCount, 0);

  return (
    <div>
      <PageHeader eyebrow="Your applications" title="Projects">
        <Link href="/projects/new" className={btnPrimary} data-testid="button-connect"><Plug className="h-4 w-4" /> Connect application</Link>
      </PageHeader>

      {!archived && q.data && total > 0 && (
        <dl className="mb-8 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card" data-testid="metrics-projects">
          {[["Active projects", total], ["Verified on this page", `${verified}/${projects.length}`], ["Runs on this page", runs]].map(([k, v]) => (
            <div key={k} className="px-5 py-4"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-1 font-display text-2xl font-bold">{v}</dd></div>
          ))}
        </dl>
      )}

      <div className="mb-5 inline-flex rounded-full border border-border bg-card p-1" role="tablist">
        {[false, true].map((a) => (
          <button key={String(a)} role="tab" aria-selected={archived === a} onClick={() => { setArchived(a); setOffset(0); }}
            className={cn("rounded-full px-4 py-1.5 text-sm font-medium", archived === a ? "bg-navy text-paper" : "text-muted-foreground hover:text-foreground")}>
            {a ? "Archived" : "Active"}
          </button>
        ))}
      </div>

      {q.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-24" />)}</div>}
      {q.isError && <ErrorState message={errMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && projects.length === 0 && (
        <div className="grid-paper rounded-3xl border border-dashed border-navy/25 bg-card/70 p-12 text-center" data-testid="empty-projects">
          <Plug className="mx-auto h-8 w-8 text-navy/50" />
          <h2 className="mt-4 font-display text-2xl font-bold">{archived ? "Nothing archived" : "No applications connected yet"}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">{archived ? "Archived projects keep their runs and can be restored." : "Describe one workflow and its expected outcomes, then install the SDK on your own origin."}</p>
          {!archived && <Link href="/projects/new" className={btnPrimary + " mt-6"}>Connect application</Link>}
        </div>
      )}

      <ul className="space-y-3">
        {projects.map((p, i) => (
          <li key={p.id} className="rise" style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 transition hover:border-navy/30 md:flex-row md:items-center">
              <Link href={`/projects/${p.id}`} className="min-w-0 flex-1" data-testid={`link-project-${p.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-xl font-bold">{p.name}</span>
                  {p.verifiedAt
                    ? <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok"><ShieldCheck className="h-3 w-3" /> Verified</span>
                    : <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn"><ShieldQuestion className="h-3 w-3" /> Not verified</span>}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{p.url}</div>
                <div className="mt-2 text-sm text-muted-foreground">{p.workflowName} · {p.steps.length} expected {p.steps.length === 1 ? "step" : "steps"} · {p.runCount} {p.runCount === 1 ? "run" : "runs"} · created {ago(p.createdAt)}</div>
              </Link>
              {archived && (
                <button className={btnGhost} disabled={archive.isPending} onClick={() => archive.mutate({ id: p.id, archived: false }, { onSuccess: () => toast({ title: "Project restored" }), onError: (e) => toast({ title: "Restore failed", description: errMessage(e), variant: "destructive" }) })}>
                  <ArchiveRestore className="h-4 w-4" /> Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {total > LIMIT && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <div className="flex gap-2">
            <button className={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button className={btnGhost} disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
