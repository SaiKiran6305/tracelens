import { Link } from "wouter";
import { ArrowRight, CircleCheck, CircleDashed, CircleX, KeyRound, Plug, ShieldCheck } from "lucide-react";
import { Mark } from "@/components/layout";
import { btnGhost, btnPrimary } from "@/components/bits";

const STEPS = [
  { n: "01", t: "Describe the journey", d: "Name the workflow and list its expected steps, each with the outcome key that means it worked: request → created." },
  { n: "02", t: "Install the browser SDK", d: "Load sdk.js on an origin you listed, then connect with a 20-minute session token you start from this dashboard." },
  { n: "03", t: "Record, then compare", d: "Wrap real actions in recorder.step(). Mark a passing run as baseline. Every later run is aligned against it." },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-6 md:px-10">
        <div className="flex items-center gap-3"><Mark /><span className="font-display text-lg font-bold">TraceLens</span></div>
        <nav className="flex items-center gap-2">
          <Link href="/examples" className="hidden px-3 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline">Examples</Link>
          <Link href="/setup" className="hidden px-3 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline">Limits</Link>
          <Link href="/sign-in" className={btnGhost} data-testid="link-landing-sign-in">Sign in</Link>
          <Link href="/sign-up" className={btnPrimary} data-testid="link-landing-sign-up">Sign up</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-[1180px] gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.15fr_1fr] md:px-10 md:pt-20">
        <div className="rise">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ok">For teams that ship customer workflows</div>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[0.98] tracking-tight md:text-7xl">
            Know which step<br />stopped <span className="text-fail">matching.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            TraceLens records the steps your users take in your own application, checks each one against the outcome you expect, and lines a broken run up against one you trust.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className={btnPrimary + " px-5 py-3"}>Connect an application <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/examples" className={btnGhost + " px-5 py-3"}>Browse the sample checkout</Link>
          </div>
        </div>
        <div className="rise grid-paper rounded-3xl border border-border bg-card p-6" style={{ animationDelay: ".1s" }} aria-label="Illustration of a compared journey">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Comparison illustration · not recorded data</div>
          <ol className="mt-5 space-y-3">
            {[
              ["Open form", "Shown", "Shown", "same"],
              ["Create request", "created", "rejected", "first change"],
              ["Notify approver", "sent", "not reached", "changed"],
            ].map(([l, a, b, c]) => (
              <li key={l} className={"grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border p-3 " + (c === "same" ? "border-border bg-paper" : c === "first change" ? "border-fail/35 bg-fail/5" : "border-warn/40 bg-warn/5")}>
                <div><div className="text-sm font-semibold">{l}</div><div className="mt-0.5 flex items-center gap-1 text-xs text-ok"><CircleCheck className="h-3 w-3" />{a}</div></div>
                <span className={"rounded-full border border-current/20 px-2 py-0.5 font-mono text-[9px] uppercase " + (c === "same" ? "text-ok" : c === "first change" ? "text-fail" : "text-warn")}>{c}</span>
                <div className={"flex items-center gap-1 text-xs " + (b === "not reached" ? "text-muted-foreground" : b === "Shown" ? "text-ok" : "text-fail")}>
                  {b === "not reached" ? <CircleDashed className="h-3 w-3" /> : b === "Shown" ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}{b}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Illustration only. Your dashboard shows only what your application actually reports.</p>
        </div>
      </section>

      <section className="border-y border-border bg-card/60">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-16 md:grid-cols-3 md:px-10">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="font-mono text-sm text-ok">{s.n}</div>
              <h2 className="mt-2 font-display text-2xl font-bold">{s.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-6 px-5 py-16 md:grid-cols-2 md:px-10">
        <div className="rounded-3xl bg-navy p-8 text-paper">
          <ShieldCheck className="h-6 w-6 text-ok" />
          <h3 className="mt-4 font-display text-2xl font-bold">Metadata first, payloads off</h3>
          <p className="mt-2 text-sm leading-relaxed text-paper/70">Request and response bodies are not captured by default. Headers that look secret are never sent. Opt in to metadata-only schemas when you need more.</p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-8">
          <div className="flex gap-2 text-navy"><Plug className="h-6 w-6" /><KeyRound className="h-6 w-6" /></div>
          <h3 className="mt-4 font-display text-2xl font-bold">Exact origins, short sessions</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The collector only accepts browser events from origins you list. Each recording uses a one-time token scoped to one project for 20 minutes. TraceLens never proxies your application's APIs.</p>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 pb-10 text-xs text-muted-foreground md:px-10">
        <span>TraceLens journey recorder</span>
        <Link href="/setup" className="hover:text-foreground">Setup, SDK and honest limits</Link>
      </footer>
    </div>
  );
}
