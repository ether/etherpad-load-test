# Design: scaling dive for Etherpad pads (issue #7756)

**Status:** approved 2026-05-15
**Repos affected:** `ether/etherpad-load-test` (primary), `ether/etherpad` (small core counters PR + final dive document)
**Tracking issue:** [ether/etherpad#7756](https://github.com/ether/etherpad/issues/7756)

## Goal

Produce a numbers-backed answer to "how many editors can be on one pad, and what is the bottleneck when it falls over?" The deliverable is in two parts:

1. **Phase 1 — Harness upgrade (this repo).** Refactor `etherpad-load-test` so it can produce reproducible concurrency-vs-latency curves with both client-perceived and server-scraped metrics.
2. **Phase 2 — Research dive (separate doc in `ether/etherpad`).** Run the harness against a fixed reference machine, score each of the three threads raised in #7756 (transport, node env, message batching) plus two cheap neighbours, publish recommendations.

The harness ships first. The dive comes second and consumes the harness.

## Constraints

- **Harness work lives in `ether/etherpad-load-test`.** No new repo.
- **Core CI must not regress.** `ether/etherpad`'s `.github/workflows/load-test.yml` invokes `etherpad-loadtest -d "$1" -a "$2"` via `tests/frontend/travis/runnerLoadTest.sh` and consumes the **exit code only**. That contract is sacred.
- **Single reference box** — harness and SUT colocated; machine spec is recorded in `RunMeta`, noise is constant across compared runs.
- **Establish the curve**, no fixed target N.
- Server-side metrics scraping uses `/stats/prometheus` (already exposed by core).

## Out of scope (named explicitly)

- A continuous benchmark dashboard. Single dated dive; if recurring measurement is wanted, that's a future project.
- A `--compare` mode that diffs two runs. The CSV format is enough for `diff`/spreadsheets. Defer.
- Shipping the best-scoring lever as a PR within this work — each useful lever becomes its own PR with its own review, citing the dive doc.
- A raw `ws` (drop socket.io entirely) prototype. Only undertaken if the dive's verdict on levers 1–4 is "inconclusive"; it becomes its own brainstorm → spec → plan cycle.

---

## Phase 1 — Harness architecture

### Section 1 — Directory layout

```
src/
  sim/
    author.ts        — one simulated participant; owns its socket and timing
    harness.ts       — orchestrates N authors against M pads, drives the sweep
    scraper.ts       — periodically scrapes /stats/prometheus and snapshots gauges
    reporter.ts      — collects samples, computes percentiles, writes JSON+CSV+MD
    config.ts        — Config type + defaults + validation (no CLI knowledge here)
    types.ts         — shared shapes: Sample, Snapshot, RunMeta, ReportRow
    legacy.ts        — byte-for-byte port of today's run loop (see Section 5)
  cli.ts             — single CLI entry: parse argv → Config → dispatch
  bin/
    etherpad-loadtest      — thin shim to cli.ts (preserves existing CLI name)
    etherpad-loadtest-multi — thin shim to cli.ts with --multi preset
```

Rules of the split:

- `sim/` knows nothing about argv, `process.exit`, or stdout.
- `cli.ts` knows nothing about socket.io.
- Each unit has one purpose and is independently testable.

### Section 2 — Components and interfaces

**`Author`** — owns one socket and one identity.

```ts
class Author {
  constructor(opts: { url, padId, authorName, editIntervalMs })
  connect(): Promise<void>            // handshake + room join
  start(): void                       // begin emitting USER_CHANGES at editIntervalMs
  stop(): Promise<void>               // flush in-flight, close
  drainSamples(): Sample[]            // returns + clears latency samples since last call
  on(evt: 'drop'|'error'|'rateLimited', cb)
}
```

In-flight FIFO of `(sentAt: hrtime.bigint, baseRev)`. `ACCEPT_COMMIT` arrival pops the oldest, computes `latencyMs`, pushes a `Sample`. (Per `etherpad/src/node/handler/PadMessageHandler.ts:874`, `ACCEPT_COMMIT` is per-self-edit and ordered, so FIFO matching is correct.) `disconnect: badChangeset` / `rateLimited` recorded as error events, not missing acks.

**`Harness`** — the only unit that knows about sweeps.

```ts
class Harness {
  constructor(config: Config, scraper: Scraper, reporter: Reporter)
  run(): Promise<Report>
}
```

For each step S in `sweep`: spin up extra authors to reach S → wait `warmup` → drain warmup samples → wait `dwell` → collect samples + scraper snapshot labelled with step value → `reporter.addStep(...)` → advance. Lurkers spun up once at run start, constant across the sweep.

**`Scraper`** — periodic poller of `/stats/prometheus`.

```ts
class Scraper {
  constructor(opts: { url, intervalMs, keep: string[] })  // allowlist
  start(): void
  stop(): Promise<void>
  snapshot(label: string): Snapshot                       // freeze latest values
}
```

Parses Prom text format itself (no heavy client), keeps only allowlisted gauges. The allowlist matches by **base-name prefix** (the part before `{...}` labels), so `nodejs_eventloop_latency_gauge` keeps all of `{type=p50}`, `{type=p95}`, `{type=max}` in one entry. Absent metrics simply don't appear — the same harness binary works against SUTs with or without the new core counters from Section 6.

**`Reporter`** — accumulates per-step results, writes outputs.

```ts
class Reporter {
  constructor(opts: { outDir, runMeta: RunMeta })
  addStep(step: StepResult): void
  write(): Promise<{ json: string, csv: string, md: string }>
}
```

Uses HdrHistogram (or `hdr-histogram-js`) for accurate percentiles across millions of samples without storing them all.

**Shared types (`sim/types.ts`):**

```ts
Sample      = { authorId, sentAt: bigint, ackedAt: bigint, latencyMs: number }
Snapshot    = { label, scrapedAt, gauges: Record<string, number> }
StepResult  = { step, p50, p95, p99, throughput, samples: Sample[]|null,
                snapshot: Snapshot, droppedAuthors: number, errors: number,
                breakageFlags: string[] }
RunMeta     = { runId, startedAt, finishedAt, sutGitSha?, sutVersion?,
                machine: { cpus, totalMemMB, node, os }, partial?: boolean }
```

`samples` nullable so the Reporter can drop raw arrays before write when `--no-raw-samples` is set.

**`Config`** lives in `sim/config.ts`. Validator fails fast in `cli.ts`; no `process.exit` inside `sim/`.

### Section 3 — Data flow for a sweep run

```
cli.ts
  ├─ parse argv → Config (validate, exit 2 on bad input)
  ├─ if !config.sweep → return runLegacy(config)        // see Section 5
  ├─ collect RunMeta: read git SHA from SUT via GET /, snapshot os info
  ├─ new Scraper(config.scrape) ; new Reporter(config.report) ; new Harness(...)
  └─ await harness.run() → reporter.write() → log paths

Harness.run()
  ├─ scraper.start()
  ├─ spawn `lurkers` Author instances, connect, do NOT start()
  ├─ activeAuthors = []
  └─ for step in sweep:
       ├─ delta = step - activeAuthors.length
       ├─ spawn `delta` Authors, await Promise.allSettled(connect()); track failures
       ├─ activeAuthors.forEach(a => a.start())
       ├─ await sleep(warmupMs)
       ├─ activeAuthors.forEach(a => a.drainSamples())  // discard warmup samples
       ├─ await sleep(dwellMs)
       ├─ samples = activeAuthors.flatMap(a => a.drainSamples())
       ├─ snap   = scraper.snapshot(`step=${step}`)
       ├─ errors = sum of per-author error counters
       ├─ reporter.addStep({ step, samples, snapshot: snap, errors, droppedAuthors })
       └─ if breakage threshold tripped → record + (optionally) early-exit
  ├─ await Promise.all(activeAuthors.map(a => a.stop()))
  ├─ scraper.stop()
  └─ return reporter.build()
```

Specifics:

- **Edit content** — small text inserts at `editIntervalMs` (default 200 ms = 5 edits/sec/author, matches current load-test default), drawn from a fixed corpus.
- **Step boundaries sharp** — `drainSamples()` after warmup *then* dwell; step S's row is always "S authors writing for `dwell` seconds after `warmup` of stabilisation."
- **Lurkers constant** across the sweep. Sweeping lurkers is a separate run; axes never mixed.
- **Breakage thresholds configurable** in `Config`. Recorded even when not tripped, so curves are comparable across builds.
- **Scraper polls at fixed cadence** (1 Hz default), independent of step boundaries. `snapshot(label)` freezes latest buffered values; no racing.
- **All timing uses `hrtime.bigint()`**, never `Date.now()`.

### Section 4 — Output format

Three files per run in `--report` directory. Filenames stable: `report.json|csv|md`.

**`report.json`** (canonical):

```json
{
  "runId": "2026-05-15T14-22-08-7e3a",
  "startedAt": "2026-05-15T14:22:08.123Z",
  "finishedAt": "2026-05-15T14:38:51.004Z",
  "sut": { "url": "http://127.0.0.1:9001", "gitSha": "a1b2c3d", "version": "2.7.1" },
  "machine": { "cpus": "AMD Ryzen 9 7900X (12c/24t)", "totalMemMB": 64427,
               "node": "v22.14.0", "os": "Linux 6.17.0-23-generic" },
  "config": { "sweep": { "min": 10, "max": 200, "step": 10, "warmupMs": 5000, "dwellMs": 30000 },
              "lurkers": 50, "editIntervalMs": 200, "scrape": { "intervalMs": 1000 },
              "breakOn": { "p95Ms": 2000, "eventLoopP95Ms": 500, "errorRate": 0.05 } },
  "steps": [
    {
      "step": 10,
      "latencyMs": { "p50": 18, "p95": 41, "p99": 73, "max": 188, "count": 14982 },
      "throughputCsps": 49.7,
      "snapshot": {
        "scrapedAt": "2026-05-15T14:22:43.000Z",
        "gauges": {
          "nodejs_cpu_gauge{type=user}": 22.4,
          "nodejs_eventloop_latency_gauge{type=p50}": 0.8,
          "nodejs_eventloop_latency_gauge{type=p95}": 3.1,
          "nodejs_memory_process_gauge{type=rss}": 412304896,
          "etherpad_total_users": 60,
          "etherpad_active_pads": 1
        }
      },
      "droppedAuthors": 0,
      "errors": 0,
      "breakageFlags": []
    }
  ]
}
```

**`report.csv`** (plot-ready, one row per step):

```
step,p50,p95,p99,max,throughput_csps,cpu_user,evloop_p95_ms,rss_mb,users,errors,break
10,18,41,73,188,49.7,22.4,3.1,393,60,0,
20,21,58,110,240,98.2,38.1,5.0,431,70,0,
```

**`report.md`** (paste-into-issue summary):

```markdown
# Etherpad scaling sweep — 2026-05-15T14:22:08
SUT: a1b2c3d (v2.7.1) on AMD Ryzen 9 7900X · 64 GB · node v22.14.0

| Step | p50 | p95 | p99 | EL p95 | CPU% | Errors | Break |
|---:|---:|---:|---:|---:|---:|---:|:---|
| 10  | 18 | 41 | 73 | 3.1 | 22.4 | 0 | |
| 20  | 21 | 58 | 110 | 5.0 | 38.1 | 0 | |

p95 latency (ms) vs concurrency:
  10 ▏▏▏▏▏ 41
  20 ▏▏▏▏▏▏▏▏ 58
```

Rules:

- Raw samples are **off by default** in JSON (histogram percentiles only). At 200 authors × 5 edits/sec × 30 s × 20 steps = 600k samples per run. Add `--keep-raw-samples` for one-off deep dives.
- Metric label flattening: prom-text `metric{type=p95}` becomes JSON key `metric{type=p95}` verbatim.
- **CSV columns are a curated subset**, defined by a fixed table inside `Reporter` (step, p50, p95, p99, max, throughput_csps, cpu_user, evloop_p95_ms, rss_mb, users, errors, break). Adding new gauges to `--scrape-keep` does *not* widen the CSV — they remain queryable from JSON only. This keeps the CSV schema stable across runs.
- No comparison tool; CSV + `diff` is enough.

### Section 5 — CLI surface and legacy-mode preservation

**Preserved (today's flags, unchanged):**

```
etherpad-loadtest [<url>] [-l <lurkers>] [-a <authors>] [-d <duration_s>]
etherpad-loadtest-multi [<numPads>]
```

**New, additive flags:**

```
--sweep <axis>=<min>..<max>[:step][:dwell=<dur>][:warmup=<dur>]
--report <dir>          # default ./loadtest-out/<runId>
--scrape-url <url>      # default <SUT base>/stats/prometheus
--scrape-interval <dur> # default 1s
--scrape-keep <names>   # comma list of metric prefixes
--edit-interval <dur>   # default 200ms
--break-p95 <ms>        # default 2000
--break-evloop-p95 <ms> # default 500
--break-error-rate <r>  # default 0.05
--break-action stop|continue   # default continue
--keep-raw-samples      # off by default
--run-id <s>            # default ISO-ish slug
--json-only             # skip md/csv (CI use)
--config <path>         # JSON config file
--connect-timeout <dur> # default 10s
--force                 # allow non-empty --report dir
--respawn-drops         # off; on means each step holds exactly N authors
```

**Mode dispatch:**

- **No `--sweep`** → `runLegacy(config)`. Behaves exactly like today.
- **`--sweep` present** → `harness.run(config)`. New measurement model with reports.

**Legacy mode is byte-for-byte preserved (resolved 2026-05-15).**

- `src/sim/legacy.ts` is a near-verbatim port of today's `app.ts` run loop: same ramp-authors-every-5s logic, same "changesets stopped processing in a timely fashion" breakage rule, same exit-code semantics.
- The new measurement plumbing (Scraper, Reporter, HdrHistogram) is **not executed** on the legacy path. Bugs in those modules cannot affect the exit code core CI sees.
- Core CI's `etherpad-loadtest -d 25 -a 50` invocation routes through `runLegacy`, unaffected by anything in `harness.ts` / `reporter.ts` / `scraper.ts`.

**Config precedence:** CLI flag > env var (`LOADTEST_*`) > config file > defaults.

**Duration parsing:** `200ms`, `30s`, `5m`. Reject unitless numbers in duration flags.

**Server probe on startup:** the new code (sweep mode only) does a `GET /stats/prometheus` and a probe socket connection; if `loadTest:false`, exits 2 with a clear error pointing at `settings.json`. Legacy mode keeps today's failure behaviour.

**Publish strategy:**

- **Minor version bump** (e.g., `1.x → 1.(x+1).0`), not major. Public CLI surface is a strict superset.
- Pre-publish: run `runnerLoadTest.sh 25 50` locally against the new harness build at current `develop` SHA of core; confirm exit 0.
- Post-publish: watch core's next `load-test.yml` run on `develop`.

### Section 6 — Server-side metrics

**Already exposed via `/stats/prometheus` (harness v1 uses these only):**

- `nodejs_cpu_gauge{type=user|system}`
- `nodejs_eventloop_latency_gauge{type=p50|p95|max}`
- `nodejs_memory_process_gauge{type=rss|heapUsed|heapTotal|external}`
- `nodejs_gc_gauge{type=count}`, `nodejs_gc_duration{quantile}`
- `etherpad_total_users`, `etherpad_active_pads`
- prom-client default metrics

**Decision rules from those alone:**

- p95 latency up **without** event-loop p95 up ⇒ network IO bound.
- p95 up **with** event-loop p95 up ⇒ server CPU / event-loop bound.
- p95 up **with** RSS climbing across steps ⇒ leak / backpressure.

That alone settles the central question this issue poses. v1 of the harness ships against existing metrics. **No core PR blocks the harness.**

**Small core PR sequenced after (separate PR in `ether/etherpad`):**

1. `etherpad_pad_users{padId}` — gauge derived once per scrape from `sessioninfos`. No hot-loop cost.
2. `etherpad_changeset_apply_duration_seconds` — histogram observed inside `handleUserChanges` in `src/node/handler/PadMessageHandler.ts`.
3. `etherpad_socket_emits_total{type}` — counter at every `socketio.sockets.in(padId).emit('message', msg)`, bucketed by `msg.data.type`.

~40 lines + tests. Independent of the harness. Unlocks message-type attribution for Phase 2.

### Section 7 — Error handling

**Hard errors → abort run, non-zero exit, no report written.**

- Config validation fails.
- Probe `GET /stats/prometheus` returns non-200.
- First Author can't complete handshake within `--connect-timeout`.
- `--report` directory exists and non-empty without `--force`.

**Soft errors → recorded into report, run continues.**

All three of these end with the socket disconnected (per `PadMessageHandler.ts`: `disconnect: badChangeset` and `disconnect: rateLimited` both call `socket.disconnect`, and a network drop is already a closed socket). The respawn policy therefore unifies: **any disconnect-class event respawns iff `--respawn-drops` is set** (default off; respawning during dwell skews the curve). The three differ only in *which counter* they bump and whether they auto-flag the step:

- USER_CHANGES rejected (`disconnect: badChangeset`) — `errors++`. Step auto-flagged if `errors/total > --break-error-rate`.
- Network drop mid-dwell — `droppedAuthors++`. No auto-flag (drops are normal data).
- Rate-limited (`disconnect: rateLimited`) — `errors++` **and** step auto-flagged regardless of `--break-error-rate` (rate-limiting *is* the signal we wanted to find).

**Threshold-tripped events → `breakageFlags`, not errors.**

- Run keeps going by default — the curve continues past the breaking point and shows the shape of the cliff.
- `--break-action stop` aborts on first flag.

**Author-side resilience:**

- Socket failures caught inside Author, re-emitted as `'drop'`.
- Harness uses `Promise.allSettled` for batch spawn.
- `SIGINT` → graceful shutdown, scraper stop, authors stop, flush completed steps to a **partial report** with `partial: true` in `RunMeta`.

**No retries with backoff.** Measurement tool, not production client.

### Section 8 — Testing strategy

**Unit tests (sim/ in isolation):**

- `Author` — stub socket that auto-emits `ACCEPT_COMMIT` after configurable delay; assert FIFO `latencyMs` math, out-of-order resilience, `disconnect: badChangeset` counted as error not sample, clean `stop()` flush.
- `Scraper` — fixed Prom text fixtures from a real `/stats/prometheus`; assert allowlist filter, label round-trip, `snapshot(label)` returns latest not stale, `stop()` halts polling.
- `Reporter` — synthetic `StepResult[]`; percentiles match reference HdrHistogram, CSV byte-exact against Section 4 schema, partial-run JSON marked `partial: true`, breakage flags in correct rows.
- `Config` — table-driven validator: every bad input → expected error; every good input → expected normalised config.

**Invariant tests:**

- Non-empty samples: `p50 ≤ p95 ≤ p99 ≤ max`.
- Σ per-step `samples.count` ≤ `authors × edits/sec × dwell × steps`.
- `startedAt < finishedAt`, and `finishedAt − startedAt ≥ Σ(warmup + dwell)`.

**Integration test (one short real-world sweep):**

- `src/sim/__tests__/integration.spec.ts`. Spawns local Etherpad via existing test scaffold. Tiny config: `lurkers=0, sweep=authors=2..4:step=2:warmup=500ms:dwell=2s`, scrape 500 ms.
- Asserts: report files exist, JSON parses to schema, each step has `count > 0`, all `latencyMs ≥ 0`, no `breakageFlags` at trivial concurrency.
- Runtime budget ≤ 15 s. Acceptance test for the tool.

**Legacy-contract test (the CI safety net):**

- `src/sim/__tests__/legacy-contract.spec.ts`. Spawns local Etherpad with `loadTest:true`.
- Calls `runLegacy({ duration: 10, authors: 5 })` directly (not via shell), asserts exit-code-equivalent return is 0.
- Same with deliberately overloaded config (e.g., authors much larger than budget) — asserts non-zero, i.e., breakage criterion still trips.
- This is the explicit guarantee that "legacy CI invocations behave the same as before."

**CI matrix:**

- Unit + invariant: every PR, all supported Node versions.
- Integration + legacy-contract: every PR, latest Node only.
- Nightly long-sweep: **not** part of this design; that's Phase 2's job.

**What we don't test:**

- Absolute latency numbers (hardware-dependent, flake-prone).
- Comparison-with-previous-run logic (deferred feature, nothing to test).

---

## Phase 2 — Research dive

Once the harness merges and publishes, Phase 2 produces the deliverable that closes #7756.

**Inputs:** harness from Phase 1, the reference machine (spec recorded in `RunMeta`), a fixed Etherpad SHA as baseline.

### Levers to score

| # | Lever | Change | Risk |
|---|---|---|---|
| 0 | Baseline | none — current `develop` SHA | — |
| 1 | `perMessageDeflate=true` on socket.io | one setting in `socketio.ts` | low |
| 2 | `--max-old-space-size=4096` etc. (issue thread #2) | node flag only | none |
| 3 | Batch fan-out (issue thread #3) | coalesce N changesets in a window before emit | medium |
| 4 | Drop polling: `socketTransportProtocols = ['websocket']` only | one settings change | low |
| 5 | Raw `ws` instead of socket.io (issue thread #1) | **deferred unless 1–4 inconclusive** | high |

Order matters: lever 5 only prototyped if 1–4 leave the curve unimproved.

### Method per lever

1. Checkout baseline SHA. `etherpad-loadtest --sweep authors=10..200:step=10 --report out/baseline`.
2. Apply lever as a branch. Same sweep, `--report out/leverN`.
3. Compare `out/*/report.csv` — diff p95 column at each step.
4. Lever useful if cliff shifts by ≥ one step at p95 < `break-p95`, **or** evloop_p95 flattens at same step count.
5. Score: `{cliffShift, p95AtCliff-1: Δms, evloopShift, cpuCost, errorRate: Δ}`.

### Deliverable

**File:** `docs/scaling-dive-2026-05.md` in **`ether/etherpad`** (the project being analysed).

Sections:

1. **Methodology** — machine spec, harness commit SHA, baseline SHA, exact CLI.
2. **Baseline curve** — report.md from first real run + one-sentence interpretation against Section 6's decision rules.
3. **One subsection per lever 1–4** — config diff, before/after table, sparkline, score, verdict.
4. **Lever 5 decision** — explicit yes/no.
5. **Recommendation** — what to actually merge; follow-up issue if a deeper transport change warranted.

Raw `report.json` files for each lever committed alongside the doc (gzipped if large) for reproducibility.

### What Phase 2 is not

- Not a continuous benchmark.
- Not "ship the best lever as part of this work" — each useful lever becomes its own PR citing the dive doc.
- Not where lever 5 lives if pursued — separate brainstorm → spec → plan cycle.

### Cost guess

- ~2 hours of pure run-time on the reference box (20 steps × 35 s × 6 levers + buffer).
- ~1 day of write-up.
- Independent of harness implementation time.

---

## Implementation-plan scope

This spec covers two phases, but only **Phase 1 (harness)** is plannable code work and should be the target of the next `writing-plans` invocation. Phase 2 is a manual research activity — running the harness, observing, writing a Markdown doc into `ether/etherpad`. It does not need a step-by-step implementation plan, only the methodology block already in this spec.

## Decisions log

- **2026-05-15** — Harness lives in `etherpad-load-test` (not a new repo, not core).
- **2026-05-15** — Measure both client and server side.
- **2026-05-15** — Establish curve, no fixed target N.
- **2026-05-15** — Single reference box, harness colocated with SUT.
- **2026-05-15** — Two-layer split: `sim/` library + thin `cli.ts`.
- **2026-05-15** — Legacy mode is a byte-for-byte port; new measurement code never executes on the legacy path.
- **2026-05-15** — Harness v1 ships against existing `/stats/prometheus` metrics; the 3 new core counters are a follow-up PR.
