import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import { useGetSummary } from "@workspace/api-client-react";
import { ErrorState, Eyebrow, Skel, btnGhost, btnPrimary } from "@/components/bits";
import { RunRow } from "@/components/run-row";
import { errMessage } from "@/lib/trace";

function HeroDiagram() {
  const nodes = [
    { x: 30, y: 90, label: "click", c: "var(--navy)" },
    { x: 150, y: 90, label: "POST /cart", c: "var(--ok)" },
    { x: 290, y: 40, label: "shipping", c: "var(--ok)" },
    { x: 290, y: 140, label: "inventory", c: "var(--ok)" },
    { x: 430, y: 90, label: "checkout 422", c: "var(--fail)" },
  ];
  const edges = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4]];
  return (
    <svg viewBox="0 0 520 180" className="w-full" aria-hidden>
      {edges.map(([a, b], i) => (
        <motion.path
          key={i}
          d={`M${nodes[a].x + 40} ${nodes[a].y} C ${nodes[a].x + 80} ${nodes[a].y}, ${nodes[b].x - 40} ${nodes[b].y}, ${nodes[b].x - 6} ${nodes[b].y}`}
          fill="none"
          stroke="hsl(var(--navy) / .35)"
          strokeWidth="1.5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.3 + i * 0.15, duration: 0.6 }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.g key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.15 }}>
          <rect x={n.x - 6} y={n.y - 15} width={92} height={30} rx={9} fill="hsl(var(--card))" stroke={`hsl(${n.c} / .5)`} />
          <circle cx={n.x + 6} cy={n.y} r={4} fill={`hsl(${n.c})`} />
          <text x={n.x + 15} y={n.y + 4} fontSize="11" fontFamily="JetBrains Mono" fill="hsl(var(--foreground))">{n.label}</text>
        </motion.g>
      ))}
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
        <line x1={424} y1={112} x2={424} y2={166} stroke="hsl(var(--fail))" strokeDasharray="3 3" />
        <text x={430} y={166} fontSize="10" fontFamily="JetBrains Mono" fill="hsl(var(--fail))">first divergence</text>
      </motion.g>
    </svg>
  );
}

export default function Dashboard() {
  const summary = useGetSummary();
  const s = summary.data;
  const empty = s && s.runs === 0;

  const stats = s
    ? [
        { k: "Journeys", v: s.journeys, c: "text-foreground" },
        { k: "Runs recorded", v: s.runs, c: "text-foreground" },
        { k: "Passed", v: s.passed, c: "text-ok" },
        { k: "Failed", v: s.failed, c: "text-fail" },
        { k: "Events observed", v: s.events, c: "text-foreground" },
      ]
    : [];

  return (
    <div>
      <section className="grid items-center gap-10 pb-14 lg:grid-cols-[1.1fr_1fr]">
        <div className="rise">
          <Eyebrow>TraceLens · journey recorder</Eyebrow>
          <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[0.98] md:text-[4rem]" data-testid="text-headline">
            See where your app's journey <span className="relative whitespace-nowrap text-fail">breaks.<svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 100 8" preserveAspectRatio="none"><path d="M0 5 Q 25 0 50 4 T 100 3" stroke="hsl(var(--fail) / .5)" strokeWidth="2" fill="none" /></svg></span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
            Follow one user action through every request it caused. Save a run you trust, record again, and get the first
            step that changed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className={btnPrimary + " px-5 py-3"} data-testid="button-try-demo">
              Try checkout demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/setup" className={btnGhost + " px-5 py-3"} data-testid="link-setup">
              <BookOpen className="h-4 w-4" /> Instrument your app
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_30px_60px_-40px_hsl(var(--navy)/.45)] rise" style={{ animationDelay: ".1s" }}>
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow>illustration · how a divergence reads</Eyebrow>
          </div>
          <HeroDiagram />
        </div>
      </section>

      {summary.isLoading && (
        <div className="grid gap-4 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skel key={i} className="h-24" />)}</div>
      )}
      {summary.isError && <ErrorState message={errMessage(summary.error)} onRetry={() => summary.refetch()} />}

      {s && (
        <>
          <section className="grid grid-cols-2 border-y border-border md:grid-cols-5" data-testid="section-stats">
            {stats.map((st, i) => (
              <div key={st.k} className={"py-6 " + (i > 0 ? "md:border-l md:border-border md:pl-6" : "")}>
                <div className="text-xs text-muted-foreground">{st.k}</div>
                <div className={"mt-1 font-display text-4xl font-bold tabular-nums " + st.c} data-testid={`text-stat-${st.k.toLowerCase().replace(/ /g, "-")}`}>{st.v}</div>
              </div>
            ))}
          </section>

          {empty ? (
            <section className="mt-14 grid gap-8 rounded-3xl border border-dashed border-navy/25 bg-card/70 p-8 md:grid-cols-[1fr_1.2fr] md:p-12" data-testid="empty-runs">
              <div>
                <Eyebrow>Nothing recorded yet</Eyebrow>
                <h2 className="mt-3 text-2xl font-bold md:text-3xl">Record your first journey</h2>
                <p className="mt-3 text-muted-foreground">
                  Try the checkout demo to record a journey, save a successful baseline, and see what changes when checkout fails.
                </p>
                <Link href="/demo" className={btnPrimary + " mt-6"} data-testid="button-empty-demo">
                  Try checkout demo <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <ol className="space-y-5">
                {[
                  ["Record a working checkout", "Click through it yourself or let replay press the same buttons."],
                  ["Mark it as the baseline", "Only a passed, finished run can become the trusted reference."],
                  ["Break it on purpose", "Record a missing-address or transient-failure run."],
                  ["Read the first divergence", "See the first changed step and expand its request and response differences."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-navy/20 font-mono text-xs font-semibold text-navy">{i + 1}</span>
                    <div>
                      <div className="font-semibold">{t}</div>
                      <div className="text-sm text-muted-foreground">{d}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section className="mt-14">
              <div className="mb-4 flex items-end justify-between">
                <h2 className="text-2xl font-bold">Recent runs</h2>
                <Link href="/journeys" className="text-sm font-medium text-navy underline-offset-4 hover:underline" data-testid="link-all-runs">All journeys</Link>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {s.recentRuns.map((r) => <RunRow key={r.id} run={r} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
