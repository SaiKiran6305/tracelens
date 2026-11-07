# TraceLens integration and operations

TraceLens is published as a public example at https://trace-lens.replit.app/demo. The integrated core has automated and browser checks; this is not a production-readiness certification for arbitrary external applications.

## Start, build, migrate

Requirements: Node 24, pnpm 10 workspace, PostgreSQL (`DATABASE_URL` in workspace secrets), managed Clerk keys (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`). Clerk development and production user stores are separate. Do not copy secrets into source. The Clerk proxy is wired for managed production configuration.

```sh
pnpm install
node scripts/src/migrate-real-projects.mjs
pnpm run typecheck
pnpm --filter @workspace/tracelens run build
pnpm --filter @workspace/api-server run build
```

Use the managed `artifacts/api-server: API Server` and `artifacts/tracelens: web` workflows. Managed services supply `PORT`; the web root is `/`, API is `/api`. For a manual API process, the runtime must supply a port and database/authentication secrets. Frontend build defaults its base path to `/`; set `BASE_PATH` for a different artifact mount.

The migration is additive, repeatable, and transactional; it does not delete or rename existing recordings. Apply it before starting a new server or publishing a changed schema. Do not substitute a destructive schema reset or automatic force-push.

- `GET /api/healthz`: process liveness.
- `GET /api/readyz`: PostgreSQL/project-table availability and server authentication configuration. This does **not** certify the production Clerk domain, backups, capacity or all indexes.
- Authenticated owner APIs: `/api/projects`, `/api/projects/:id`, `/api/projects/:id/runs/:runId` and its `/export`, `/baseline`, `/finish`, `/archive` actions. Exports use the same authorization as reads.

## Real application integration

1. Sign in and choose **Connect application**. Enter an HTTPS project URL (HTTP accepted only for loopback), exact origins without wildcards/paths, a workflow name, and expected steps. Each expected step has a stable `id`, plain-language `label`, and an exact `outcome` key. One configured workflow per project in this version; multiple projects can connect to the same application.
2. Create a short-lived **verification session** for an allowed origin. Load `/api/sdk.js` from TraceLens in that application, then explicitly consent and call `TraceLens.connect`. The cross-origin bearer-authenticated handshake, not URL syntax or a server-side URL fetch, verifies the connection.
3. Create a **recording session** in the dashboard. Its token is displayed once and expires after 20 minutes. It grants ingestion into one run at one exact origin. Public project identifiers and origin allowlists do not authorize minting sessions. Treat recording tokens as sensitive, even though they are not admin credentials.
4. Configure the SDK with the explicit collector URL, public project identifier and session token:

```js
const recorder = await TraceLens.connect({
  collectorUrl: "https://YOUR_TRACELENS_HOST/api/collector",
  projectId: "PUBLIC_PROJECT_ID",
  session: "SHORT_LIVED_RECORDING_SESSION",
  consent: true,
  onWarning: message => showRecorderWarning(message),
});
await recorder.step("submit", async ctx => {
  // ctx.fetch preserves the action and parent across asynchronous/parallel calls.
  // No application API proxy, trace header injection, or response rewriting.
  const response = await ctx.fetch("/api/requests", { method: "POST" });
  const body = await response.json();
  // Example contract only: status="created" and a returned request id.
  // Replace with the real application's business-success condition.
  if (response.ok && body.status === "created" && typeof body.id === "string" && body.id) {
    ctx.outcome("created", "Request created");
  } // Do not assert success when the business outcome is not verified.
}, { label: "Submit request" });
const result = await recorder.stop(); // flush, conclude if complete, unpatch
```

Use the application's actual response/business conditions, not an arbitrary HTTP 2xx, to report an outcome. The predicate above assumes a specific request-creation contract, not a generic integration contract; replace it for each workflow. The outcome is an explicit **application assertion**, not independent proof of server work. If the application reports only successful HTTP responses, steps and concluded runs remain unknown/unverified. Missing expected steps are “Not reached” only after conclusion. No-event, dropped-event or interrupted recordings cannot be baselines. Dashboard Stop interrupts and marks incomplete; SDK Stop flushes first. `detach()` unpatches without claiming completion and preserves pending evidence for the same unexpired session.

Journey view and Developer view are synchronized projections of the same saved events. Selected step/run/baseline and a local presentation preference persist across switches. A failed attempt followed by the expected successful outcome is Recovered, not an erased error. Meaningful overlap uses recorded request start/end intervals with a small clock-resolution tolerance.

### SDK behavior and limits

- No arbitrary input/change listeners. Semantic `step()` or developer-authored `data-tracelens-step` attributes identify actions. Do not use both for the same click. Implicit click context covers synchronous work only; use `ctx.fetch` for asynchronous/parallel calls.
- Fetch captures method, safe path, status, duration and failed delivery, without header/body values. URL query/hash are stripped; UUID/numeric path segments are normalized. Navigation captures safe path only.
- A `step()` callback that throws or rejects records a generic `exception` outcome and rethrows the original error to the application. Exception messages and stacks are not collected; the dashboard marks the step failed without claiming a specific cause. A caught error that the application handles internally is not automatically called a failure.
- Payload values are **not supported** in this version. Optional `payloadSchema.request` / `.response` objects select field names for **presence/empty/type metadata only**; every field is marked redacted. Request JSON must be a string under 8 KiB; response JSON requires an explicit size under 8 KiB. Secret headers are never captured.
- At most 500 queued events, batches of 25, 4 delivery attempts with exponential backoff. Pending event IDs survive refresh in that tab's sessionStorage; acknowledgements remove only accepted IDs. Server deduplication prevents duplicate evidence when an acknowledgement is lost. Handshake and acknowledgements expose the last sequence for resume.
- Keep tokens out of query strings, URLs, source control and persistent localStorage. The SDK stores only redacted queued evidence/sequence in sessionStorage; the host application must re-supply the session after reload. The fixture clears its token input after connection.
- Page exit attempts bounded keepalive delivery. Browser shutdown, disabled storage, disk eviction or an expired session can still lose unsent events; warnings are visible through callback/event/state and such a recording must not be treated as complete. There is no service-worker/background sync guarantee.
- Only one active instrumentation instance per window. Stop/detach restores original functions only if they are still this SDK's wrappers. Fetch rejection and response objects belong to the application unchanged.
- Multiple tabs can append unique event IDs to a session. Conclusion is rejected while another live client heartbeat exists; detach other tabs first, or allow 30 seconds after abrupt tab closure. Owner Stop always produces an incomplete interruption.
- Collector requests use `credentials: "omit"` with scoped bearer credentials. CORS is not authentication. Rate limits and run limits also apply. Sessions do not automatically renew after 20 minutes.

## Trusted server evidence

Create a server credential in the signed-in project. It is shown once, hashed at rest, project-scoped, expires in 30 days, and can be revoked. Rotate by creating/installing a replacement, then revoking the old credential. No environment secret is embedded in the SDK. Never use these credentials in browser code.

```sh
curl -X POST "$COLLECTOR_URL/server" \
  -H "Authorization: Bearer $SERVER_ONLY_CREDENTIAL" \
  -H "Content-Type: application/json" \
  --data '{"projectId":"PUBLIC_ID","runId":"ACTIVE_RUN_ID","event":{"eventId":"UNIQUE_ID","actionId":"CORRELATED_ACTION","parentId":"OBSERVED_PARENT_EVENT","stepId":"submit","kind":"internal","label":"Request persisted","response":{"outcome":"created","message":"Request created"}}}'
```

Only `internal`/`outcome` events are accepted here. Supply actual observed correlation/parent identifiers, not invented dependencies. Browser collector submissions cannot claim trusted server source. A server credential does not grant dashboard reads, exports, project administration or writes into another project. Browser-origin use is rejected.

## Persistence, isolation, limits and recovery

- Real projects use Clerk user ownership. Every project/run/read/write/export checks ownership; there is no test-header or anonymous fallback for real data. Cross-site/non-JSON dashboard writes are rejected. Clerk manages its secure session cookies; owner data is not shared with the anonymous example cookie.
- Existing anonymous/demo/test recordings are kept in the explicitly separate Examples workspace. They are not counted in real project overview numbers and are not promoted to real recordings.
- Strict schemas, 64 KiB request bodies, 25 events/batch, 5,000 events/run, scoped session/key rate limits and PostgreSQL-backed owner/IP request limits. Project/run pagination has limit ≤100 and indexed owner/project/sequence lookups.
- PostgreSQL is authoritative for events, actions, sessions, expected-step snapshots, baselines and credentials. Workflow edits apply to new runs only; comparison shows changed expected-step definitions. Server evidence and duplicate event ingestion use transactions.
- Per-project retention is 1–90 days. It **reversibly archives** older concluded runs, excluding the active baseline, rather than deleting evidence. Archive does not impose a physical database-size limit or permanently erase personal data. This reconciles retention with the explicit requirement not to delete existing recordings. A permanent erasure policy requires a separate consented decision before production.
- The API also runs retention/expired-session maintenance every minute in bounded batches of 100 projects and 100 expired runs per project. PostgreSQL advisory locking prevents replicas from running the same batch concurrently; expired rate-counter windows are cleaned up, not user data. Opening a project performs its maintenance immediately as well. An expired recording becomes incomplete. Project and run archive actions are reversible; owner-authorized archived exports remain possible. Run archive/restore API: `POST /api/projects/:projectId/runs/:runId/archive` with `{ "archived": true|false }`; archived run list uses `?archived=true`.
- On database outage, ingestion returns failure rather than fabricated success; browser queue retries. Restore the database, reconnect the same unexpired recording session in the same tab, then flush. If delivery cannot be recovered, keep the run incomplete and record a new run.
- Keep PostgreSQL backups outside application Git. An isolated local restore drill succeeded: a custom-format pg_dump restored with pg_restore --exit-on-error to a separate PostgreSQL 16 instance, and project/run/event counts matched the source snapshot (9/113/785). The temporary copy was removed. Alert thresholds, unattended maintenance under sustained load, credential incident procedures, physical erasure policy, and full disaster recovery remain unproven.

## Independent runnable application fixture

```sh
node fixtures/external-app/server.mjs
# separate app: http://localhost:4321
```

This is a separate Node HTTP server, not a TraceLens route or an `/api` proxy. Allow exactly `http://localhost:4321` on a test project. Expected steps:

```json
[
  {"id":"prepare","label":"Review options","outcome":"ready"},
  {"id":"submit","label":"Submit request","outcome":"created"},
  {"id":"confirmation","label":"Confirmation","outcome":"shown"}
]
```

Its browser UI loads the actual distributed SDK. Working behavior calls parallel `/api/options` and `/api/availability`, then the fixture's real `/api/requests` endpoint; failure omits a required title (422), retry actually returns 503 then 201 with one idempotent write, and Unknown omits semantic assertions. The fixture keeps its own requests in memory solely for testing. TraceLens evidence is persisted in PostgreSQL. It has no hardcoded secret and is **not** a production example service.

## Verification commands and evidence

```sh
node --experimental-strip-types --test scripts/src/journey-projection.test.mjs
node --experimental-strip-types --test scripts/src/sdk-exception.test.mjs
node --experimental-strip-types --test scripts/src/real-integration.test.mjs
pnpm --filter @workspace/scripts exec tsx --test src/retention.test.mjs
node scripts/src/tracelens-smoke.mjs  # isolated legacy Examples regression
```

The real integration command requires the running API and fixture. It seeds uniquely owned test records (not the signed-in owner's projects), archives them afterward, and preserves all existing data. Eleven integration cases exercise real separate HTTP services and the actual distributed SDK inside a browser-like JS runtime: authentication-required endpoints; invalid/expired/revoked sessions and CORS; real writes/correlation; changed behavior; transient retries/lost acknowledgement deduplication; unknown/no-event state; interrupted queue and new-runtime resume; concurrent client stop protection; redaction/schema rejection; opt-in metadata/bounded queue overflow; hashed scoped revoked server credentials. Seven projection tests also pass, including changed expected outcomes and empty flows, plus the legacy Examples smoke test. This automated runtime is not a substitute for real-browser CORS, Clerk owner-isolation and UI tests; their blocker is documented below.

**Protected browser checks:** Managed sign-in succeeded for two test accounts. Account B received 404 on read, export, compare, and mutation attempts against A's known project/run IDs; A's data remained unchanged. Project creation, session issuance/revocation, incomplete-run refresh and JSON export, archive/restore, and Journey/Developer selection persistence passed. The separate fixture was not reachable in that signed-in test session, so connection verification, passed-baseline selection, changed-run comparison, and protected mobile screens remain unverified in a signed-in browser. No authentication bypass was added.

**Native-browser SDK evidence:** a separately seeded, isolated test project connected `http://localhost:4321` to the real separate collector origin with consent and the distributed SDK. Working: 201, passed, 11 stored events; missing title: 422, failed, 7 events; retry: 503 then 201 under the same action, passed, 12 events and exactly one write. Native browser connect/ingest/finish responses allowed the exact fixture origin with no credentialed CORS. No query/hash, title payload, secret headers, token or opt-in field metadata was stored. Diagnostic metrics fetches were accurately retained as extra unassigned events. Test sessions were revoked, the project archived, private temporary tokens removed, and all recordings preserved. This checks native browser SDK/CORS, not owner dashboard login. A redundant post-finish disconnect request discovered during this pass was removed and covered by automated concurrent-stop/cleanup assertions.

**Narrow-screen Examples check:** At a 375 px viewport, the public checkout run and aligned comparison had no document-level horizontal overflow. Journey/Developer switching kept the selected changed step, and the evidence drawer fit the viewport after dismissing Replit's temporary preview banner. This does not verify signed-in project pages.

Production builds pass with existing source-map and >500 KiB client-chunk warnings. No load/soak test, independent penetration test, full browser matrix, production-key authentication check, external developer-hosted installation outside this fixture, or production disaster-recovery drill has been completed. The conservative collector IP limit uses the actual connection address; reverse-proxy aggregation/trust configuration needs validation on the host before capacity claims. The public example is published; this statement does not imply production readiness for third-party integrations.
