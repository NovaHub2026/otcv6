# Auditor a6 — apps/api and apps/web

Worktree `/home/alejo/.otc-audit7/a6`, detached at `36bbf89`. Everything below was executed there on 2026-09-02; nothing was committed and the tree ends clean (`git status --short` prints only the pre-existing `?? node_modules` symlink the coordinator installed).

## Method (what you ran, what you planted, what you could not do)

**Read.** `CLAUDE.md`, `CATALOGUE_AND_PANEL.md` §5–§7, `CONSISTENCY_CONTRACT.md`, PH-18, PH-18.1–18.3, PH-19.5, PH-20, PH-20.1–20.3, `CYCLE-AUDIT-006.md` §4, the 2026-09-02 DECISION-LOG entry, every file under `apps/api/src` and `apps/web/src`, `apps/web/next.config.mjs`, and the package sources the surface calls into (`runtime/registry.ts`, `runtime/venue.ts`, `distribution/feed.ts`, `chart/bars.ts`, `chart/window.ts`, `engine/registration.ts`, `engine/brief.ts`, `core/timeframe.ts`, the `Candle` and `InstrumentSpec` types).

**Ran** (exit codes seen, outputs kept under the scratchpad `a6/` directory):

| What                                   | Command / script                                                                                                                                                                                                     | Result                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Build                                  | `npm run build` in the worktree                                                                                                                                                                                      | exit 0                                                             |
| Hand-started engine `svc`              | `node apps/api/dist/main.js` on OS port 34107, temp state dir, no backfill                                                                                                                                           | healthy; killed at the end                                         |
| Hand-started engine `bf`               | same with `OTC_BACKFILL_DAYS=2` on port 33749                                                                                                                                                                        | healthy after ~3 min of provisioning; SIGTERMed at the end         |
| Malformed-input battery                | `probe.mjs` — 140 requests across every route                                                                                                                                                                        | table below                                                        |
| CORS / preflight / cross-origin writes | `curl` with `Origin: http://evil.example`                                                                                                                                                                            | a6-01                                                              |
| Overlay write race                     | `races.mjs` — 20 concurrent `PATCH /assets/:id`                                                                                                                                                                      | a6-02                                                              |
| Registration race                      | `races.mjs` — 3 concurrent `POST /assets`, polled at 20 ms                                                                                                                                                           | survived; a6-06                                                    |
| SSE battery                            | `sse.mjs` — headers, `Last-Event-ID` resume, `?from`, evicted/future/garbage, 300 connect/abort cycles with fd/socket/RSS counts, a 60 s paused client, 50 mid-write disconnects                                     | a6-04; rest survived                                               |
| CA6-34 amplification                   | `amp.mjs` on `bf` — 30 and 60 concurrent 1 m/2-day history requests, RSS sampled at 50 ms                                                                                                                            | survived (numbers below)                                           |
| Catch-up failure                       | `kill -STOP` 20 s then `-CONT` on `bf`; `/health`, `/markets/:id`, log                                                                                                                                               | survived; a6-05, a6-18                                             |
| Boot/env matrix                        | `envmatrix.mjs` as parent process: no secret, `abc` secret, `OTC_BACKFILL_DAYS=abc/-1/1e3`, `PORT=abc/70000`, nested `OTC_STATE_DIR`, `OTC_CORS_ORIGIN` list, SIGTERM exit status, SIGKILL mid-registration + reboot | a6-09, a6-15; rest survived                                        |
| SIGTERM race trials                    | `sigterm.mjs` ×5                                                                                                                                                                                                     | exit by signal every time, no ENOENT                               |
| Proxy unit test                        | `npx vitest run --project unit apps/web/src/app/engine/engineProxy.test.ts`                                                                                                                                          | 8/8, exit 0                                                        |
| Registration acceptance                | `npx vitest run --project statistical apps/api/src/registration.stat.test.ts`                                                                                                                                        | 4/4, exit 0, 23.3 s                                                |
| Browser suite, required                | `OTC_REQUIRE_BROWSER=1 npx vitest run --project statistical apps/web/src/panel.stat.test.ts`                                                                                                                         | **FAILS at launch** (a6-03)                                        |
| Browser suite, not required            | same without the variable                                                                                                                                                                                            | 6/6 reported _passed_, exit 0, six `SKIPPED — no browser` warnings |
| Client bundle                          | `npm run build:web`, grep `.next/static`                                                                                                                                                                             | 0 hits for `OTC_API_BASE` and `127.0.0.1:3000`; `.next` removed    |
| Chromium EventSource check             | Playwright script                                                                                                                                                                                                    | could not run (no Chromium on host)                                |

**Planted** (each restored with `git checkout --`, `dist` rebuilt, digest of status verified):

| Plant                                                                                                       | Guard                       | Result                                                                |
| ----------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `PATCH` export removed from `apps/web/src/app/engine/[...path]/route.ts`                                    | `engineProxy.test.ts`       | caught — 1 of 8 fails, `(0 , PATCH) is not a function`                |
| `VenueService.start()` resumes a retired market (`if (false && this.retired.has(...))`), `apps/api` rebuilt | `registration.stat.test.ts` | caught — `a retired market is not resumed: expected true to be false` |

**Could not do.** The two browser-suite plants PH-20.2 §6 / PH-20.3 §5 list (chart height, stream resubscription) — Chromium cannot launch on this host (a6-03), so the browser guard was replaced by the two plants above. EventSource-after-non-200 behaviour is therefore asserted from the WHATWG spec and code reading, not observed. Eviction (50,000 ticks; 4.6 h for `btcusd`) was not exercised. Seven auditors share the machine, so wall-clock numbers are approximate.

## Route table (method, path, validation observed, worst status seen)

| Method     | Path                     | Params / body             | Response                                                                                                                                         | Validation observed                                                                                                                                                                                                          | Worst status                   |
| ---------- | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| GET        | `/health`                | —                         | `{status, assets, stalled[]}`                                                                                                                    | —                                                                                                                                                                                                                            | 200                            |
| GET        | `/markets`               | —                         | array of `{id, displayName, family, price, displayPrice (string), sequence, instant, recovery}`                                                  | —                                                                                                                                                                                                                            | 200                            |
| GET        | `/markets/:id`           | id                        | as above                                                                                                                                         | `assetIds.includes(id)`; `../x`, `%2e%2e`, empty, 65 chars, uppercase, unicode, `__proto__`, `constructor`, `%00` all 404                                                                                                    | 404                            |
| GET        | `/markets/:id/history`   | `timeframe`, `from`, `to` | `{assetId, timeframe, from, to, candles[]}`                                                                                                      | timeframe via `isTimeframeId`; instants via `parseInt` + safe-integer + `to>from`; base-tier and 20,000-bar cap. `from=…abc` → 200, `1.9` → 1, `0x10` → 0 (a6-12); `limit` ignored                                           | 400                            |
| GET        | `/markets/:id/stream`    | `from`, `Last-Event-ID`   | SSE `id:`/`data:` per tick, `event: close`                                                                                                       | `from` regex-checked; LEID numeric else ignored; evicted → 400; **future → 500** (a6-04)                                                                                                                                     | **500**                        |
| GET        | `/archetypes`            | —                         | 8 archetypes with dispersion band                                                                                                                | —                                                                                                                                                                                                                            | 200                            |
| GET        | `/catalogue`             | —                         | `{id, displayName, family, live, retired, referencePrice, displayPrecision, logQuantum, meanIntervalMs, tieRate, excessKurtosis, dispersion{…}}` | —                                                                                                                                                                                                                            | 200                            |
| POST       | `/assets`                | JSON brief                | `{job, state, poll}` 201                                                                                                                         | hand-written `asBrief`; unknown fields ignored (a6-07); `null` dispersion = unset (a6-07); malformed id → **409** (a6-08); non-object/array → 400; `text/plain`, no content-type → 400; body > 100 KB → 413 (10 MB in 30 ms) | 413                            |
| PATCH      | `/assets/:id`            | `{displayName}`           | `{id, displayName}`                                                                                                                              | `assertOverlay` closed list; `retiredAt` redirected; non-string displayName → 400 with internal message; no length bound (a6-13); **concurrent → 500 + lost update** (a6-02)                                                 | **500**                        |
| POST       | `/assets/:id/retire`     | —                         | `{id, retiredAt}` 201                                                                                                                            | 404 unknown, 409 twice; **no auth, CORS-simple** (a6-01)                                                                                                                                                                     | 201 from `http://evil.example` |
| GET        | `/registrations`         | —                         | jobs newest first                                                                                                                                | in-memory (a6-10)                                                                                                                                                                                                            | 200                            |
| GET        | `/registrations/:id`     | job id                    | job                                                                                                                                              | 404 unknown                                                                                                                                                                                                                  | 404                            |
| DELETE/PUT | anything                 | —                         | —                                                                                                                                                | Nest 404                                                                                                                                                                                                                     | 404                            |
| any        | `/engine/*` (Next proxy) | GET/POST/PATCH only       | upstream status/body streamed                                                                                                                    | path confined to engine origin by URL normalisation; engine down → Next 500 (fetch rejects)                                                                                                                                  | 500 (engine down)              |

No stack trace leaks in any response body; stacks go to the server log (`PayloadTooLargeError`, `UnknownSequenceError`, `ENOENT` at ERROR level).

## Findings

### a6-01 — The write surface is unauthenticated and CORS does not protect it: any web page can retire any market

**Severity** material

**Where** `apps/api/src/main.ts:40-45` (CORS), `apps/api/src/main.ts:52-53` (`app.listen(port)`, no bind address), `apps/api/src/market.controller.ts:223-238` (`POST /assets/:id/retire`)

**Claim** PH-20.3 §4 and the comment in `main.ts` say the wildcard default "allows GET and HEAD only" so that "an open cross-origin write is [not] a page in another tab creating markets". That is only true for requests a browser preflights. `POST /assets/:id/retire` carries no body and no custom header, so it is a CORS _simple request_: the browser sends it without a preflight, the server executes it, and CORS only governs whether the page may read the answer. There is no token, no secret, no allow-list, and no bind-address option — the service listens on every interface.

**Evidence**

```
$ ss -ltnp | grep 34107
LISTEN 0 511 *:34107 *:* users:(("MainThread",pid=10301,fd=24))

$ curl -si -X OPTIONS /assets -H 'Origin: http://evil.example' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://evil.example
Access-Control-Allow-Methods: GET,HEAD                 <- preflight refuses POST, as documented

$ curl -si -X POST /assets/gbpjpy/retire -H 'Origin: http://evil.example'   # no preflight is ever sent for this shape
HTTP/1.1 201 Created
Access-Control-Allow-Origin: http://evil.example
{"id":"gbpjpy","retiredAt":1788350034435}

$ curl -s /catalogue | ...   -> gbpjpy:live=false:retired=true
```

With `OTC_CORS_ORIGIN="http://a.example, http://b.example"` (envmatrix): `simple POST retire from evil.example: 201 ACAO=null -> {"id":"eurusd","retiredAt":...}` — still executed. `POST /assets` with JSON is only protected by accident: a simple `application/x-www-form-urlencoded` body parses every field as a string and `asBrief` refuses `referencePrice` (400); a future field that accepts a string would open it too.

**Impact** An operator who opens any third-party page while the engine is reachable from their browser (the panel's proxy makes `127.0.0.1:3000` the default) can have every market retired — irreversibly, by the 2026-09-02 decision — with no record of who did it. On a LAN, anyone who can reach the port can create, rename and retire assets directly.

**Recommended fix** (1) An `OTC_ADMIN_TOKEN` required on every non-GET route (`Authorization: Bearer`), refused at boot if unset the way `OTC_MASTER_SECRET` is; the Next proxy adds it server-side from its own environment so the browser never holds it. (2) `OTC_BIND` defaulting to `127.0.0.1`. (3) Require `Content-Type: application/json` on every write so no write is a simple request. (4) Replace the "GET/HEAD only" sentence in `main.ts` and PH-20.3 §4: CORS is not authorisation.

### a6-02 — Concurrent overlay writes lose updates and return 500: a rename racing a retire can un-retire a market at the next boot

**Severity** material

**Where** `packages/runtime/src/registry.ts:167-179` (`putOverlay`: read → merge → write `_overlays.json.<pid>.tmp` → rename), called from `apps/api/src/market.controller.ts:209` and `:236`

**Claim** `putOverlay` is an unserialised read-modify-write on one file with a temp name that is unique per _process_, not per call — the same shape CA6-35 found in `FileStateStore`. Two overlapping calls read the same snapshot, both write the same temp file, the first rename moves it, the second rename fails `ENOENT` (500), and whichever snapshot lands last erases the other's field.

**Evidence** (`races.mjs`, 20 concurrent `PATCH /assets/{eurusd,btcusd,xauusd,x}` with `displayName: name-i`)

```
status counts { '200': 4, '500': 16 }
_overlays.json: {"spx":{...},"eurusd":{"displayName":"x"},"gbpjpy":{...},"xauusd":{"displayName":"name-18"},"x":{"displayName":"name-19"}}
  eurusd: in-memory=name-0 stored=x        <-- DIVERGED
  btcusd: in-memory=BTC/USD stored=undefined <-- DIVERGED (rename never reached disk)
  xauusd: in-memory=name-2 stored=name-18  <-- DIVERGED
svc.log: ERROR [ExceptionsHandler] Error: ENOENT: no such file or directory, rename '/tmp/a6-svc-ulSTq6/assets/_overlays.json.10301.tmp' -> '.../_overlays.json'  (x16)
```

**Impact** Retirement is written through the same path (`registry.putOverlay(id, { retiredAt })`, after the venue has already dropped the market). A rename from a second tab or a second operator that overlaps a retire drops `retiredAt` from disk; the controller's own comment (`market.controller.ts:230-234`) names exactly the consequence: "a restart would silently host it again and print a tick after a gap". The venue and the registry also disagree after any collision, so `/catalogue` shows names the next boot will not.

**Recommended fix** Serialise `putOverlay` behind a promise chain inside `FileAssetRegistry` (the pattern `RegistrationService.queue` already uses), use a per-call temp name (`${target}.${pid}.${counter}.tmp`), and have the controller apply the in-memory rename only after the write resolved. Add a unit test that issues 20 concurrent `putOverlay` calls and asserts every field survives — the plant is the current code.

### a6-03 — The browser guard cannot run on this host, and the recorded gate evidence says it did

**Severity** material (evidence)

**Where** `apps/web/src/panel.stat.test.ts:161-188`; claims in `SESSION_HANDOFF.md:86-91`, `CURRENT_STATE.md:100-101`, `docs/phases/PH-20-the-operator-panel.md:62-78`, `PH-20.2 §7`, `PH-20.3 §6`

**Claim** Every Chromium build under `~/.cache/ms-playwright` links against `libnspr4`, `libnss3`, `libnssutil3` and `libasound`, none of which exists on this host. With `OTC_REQUIRE_BROWSER=1` the suite fails in `beforeAll`; without it the six tests are reported as **passed** while doing nothing. `SESSION_HANDOFF.md` records "`npm run gate` on the PH-20 tree, 2026-09-02: exit 0, with `OTC_REQUIRE_BROWSER=1`", and PH-20.2/20.3 record `panel.stat.test.ts 5 passed (36.6s)` / `6 passed (39.2s)`. Neither can be reproduced here.

**Evidence**

```
$ ldconfig -p | grep -i "nspr\|nss3"        -> nothing
$ find / -xdev -name 'libnspr4.so*' -o -name 'libnss3.so*'   -> nothing
$ ldd ~/.cache/ms-playwright/chromium_headless_shell-1234/.../chrome-headless-shell | grep "not found"
        libnspr4.so => not found / libnss3.so => not found / libnssutil3.so => not found / libasound.so.2 => not found
(same for chromium-1148)

$ OTC_REQUIRE_BROWSER=1 npx vitest run --project statistical apps/web/src/panel.stat.test.ts
 FAIL  apps/web/src/panel.stat.test.ts
Error: A browser is required here and could not be launched. ... sudo apt-get install -y libnss3 libnspr4 libasound2t64
EXIT=1

$ npx vitest run --project statistical apps/web/src/panel.stat.test.ts
SKIPPED — no browser ... (x6)
 ✓ apps/web/src/panel.stat.test.ts (6 tests) 68ms      Tests  6 passed (6)     EXIT=0
```

**Impact** Either the 2026-09-02 gate ran in an environment this repository does not describe, or the browser layer was not executed for the run the approval cites. Locally, every `npm run gate` without the variable reports the panel layer green with zero browser coverage — the exact shape of CA6-10, which PH-20.1 §4 says this design ends. CI (`ci.yml:90`) does set the variable and installs the libraries, so the layer may be real there; the local record is what is wrong.

**Recommended fix** Record the environment of the cited run (or re-run it where Chromium launches) and correct `SESSION_HANDOFF.md`/`PH-20 §4` if it was not this host. Make the no-browser path a real skip (`ctx.skip()` in each test, or `describe.skipIf`) so the summary says `skipped`, not `passed`. Add the three packages to the developer setup notes.

### a6-04 — The stream answers 500 for a sequence in the future; a browser's EventSource then never reconnects

**Severity** material

**Where** `apps/api/src/market.controller.ts:421-424` (only `EvictedError` is mapped); `packages/distribution/src/feed.ts:168-170` (`UnknownSequenceError`)

**Claim** `TickFeed.since` throws `UnknownSequenceError` for `fromSequence > newest + 1`. The controller maps `EvictedError` to 400 and rethrows everything else, so both `?from=<future>` and `Last-Event-ID: <future>` produce a 500 with a stack in the log. Per the WHATWG EventSource algorithm a non-200 response fails the connection permanently (`readyState` CLOSED, no retry).

**Evidence**

```
 500  stream from=99999999999                 | {"statusCode":500,"message":"Internal server error"}
 500  stream Last-Event-ID=99999999999        | {"statusCode":500,"message":"Internal server error"}
 500  stream Last-Event-ID=999999999999999999999999999999 | {"statusCode":500,...}
svc.log: ERROR [ExceptionsHandler] UnknownSequenceError: Sequence 99999999999 for btcusd has never been published; the newest is 78. ...
```

**Impact** A client that reconnects with a stale id after a service restart on a fresh state directory (sequence leasing normally prevents this, but a moved/cleared directory does not) gets an internal error rather than the refusal the feed already phrases; in the panel that is a `stream-status` of "stream interrupted — reconnecting" that never reconnects. Also an unauthenticated way to fill the log with stack traces.

**Recommended fix** `catch (error) { if (error instanceof EvictedError || error instanceof UnknownSequenceError) throw new BadRequestException(error.message); throw error; }`, plus a unit case in `adminSurface.test.ts` for a future `from`.

### a6-05 — The "logged once per distinct reason" stall log is defeated by its own message and floods at N lines per second

**Severity** material (operations)

**Where** `apps/api/src/venue.service.ts:355-364`; `packages/runtime/src/hosted.ts:81-82` (`Market is ${Math.round(behindMs/1000)}s behind the clock…`)

**Claim** The dedup key is the error message, and the message contains the seconds behind, which grows every scheduler tick. So a stalled venue logs one ERROR line per asset per tick for the rest of the process's life — the comment above it says "a log nobody can read is a log nobody reads".

**Evidence** (after `kill -STOP` 20 s / `kill -CONT` on `bf`, five assets)

```
STALLED lines per second: 5 10:01:32 / 5 10:01:33 / 5 10:01:34 / 5 10:01:35 ...
total STALLED lines: 270 in 299 log lines (74 KB) in ~54 s
```

**Impact** Five assets: 5 lines/s. PH-21's hundred-asset catalogue: ~100 lines/s, ~30 MB/hour, for as long as the process lives — and the one line that matters (the first) is buried. The stall itself is permanent by design (ADR-0010), so the flood is too.

**Recommended fix** Key the dedup on `failure.error.name` (or on the asset id alone), and log the changing number at debug level or in `/health` only.

### a6-06 — A registration job never reports which stage it is in

**Severity** minor

**Where** `apps/api/src/registration.service.ts:138` (`stage: 'identity'` set once), `packages/engine/src/registration.ts:184` (`registerAsset` has no progress callback); claim in `apps/web/src/app/assets/new/CreateAsset.tsx:94-96` ("a second-resolution poll shows them") and `CATALOGUE_AND_PANEL.md` §6

**Claim** `stage` is set to `identity` when the job starts and is only changed by a refusal. The six-stage progress report the screen is built around can never show progress; it shows six dots, then either all ticks or one cross.

**Evidence** (`races.mjs`, three jobs polled every 20 ms until done)

```
states/stages observed: job-3:running:identity x1 | job-4:queued:null x1 | job-5:queued:null x1 | job-3:registered:null x2 | job-4:refused:identity x2 | job-5:running:identity x1 | job-5:registered:null x1
```

No `safety`, `authoring`, `calibration`, `dispersion` or `differentiation` was ever observable while running. A `major-crypto` job runs 19 s showing "identity".

**Recommended fix** Thread an `onStage?: (stage) => void` through `RegistrationOptions` and `registerAsset`, call `#update(id, { stage })` from it. Correct the comment and §6.

### a6-07 — The panel silently sends `dispersion: null` for a non-numeric entry, and the server treats `null` as "not supplied"

**Severity** minor

**Where** `apps/web/src/app/assets/new/CreateAsset.tsx:87-93` (`Number(dispersion)` → `NaN` → `JSON.stringify` → `null`); `apps/api/src/market.controller.ts:543` (`dispersion !== undefined && dispersion !== null`); unknown fields ignored at `:508-559`

**Claim** An operator who types `0,25` or `0.3%` gets an asset with the archetype's default budget and no error. Unknown fields (`drift`, `payout`) are accepted silently, so the "closed set" PH-20.2 §2 describes is enforced by ignoring rather than refusing.

**Evidence**

```
 400  POST /assets {..."dispersion":"abc"}   | dispersion is σ of the quarterly log return and must be a positive number.
 409  POST /assets {..."dispersion":null}     | (accepted as unset; 409 only because id x already existed)
 201  POST /assets {"id":"x",...,"drift":5,"payout":0.9}  | {"job":"job-1",...}
```

**Recommended fix** Client: refuse `Number.isNaN` before submitting. Server: treat `null` as an error for optional numeric fields and refuse unknown top-level fields by name.

### a6-08 — A malformed asset id is answered with 409 Conflict

**Severity** minor

**Where** `apps/api/src/market.controller.ts:171-172` maps every non-null `checkIdentity` string to `ConflictException`

**Evidence** `409 POST /assets {"id":"X-BAD",...} | Asset id "X-BAD" must match /^[a-z0-9][a-z0-9._-]{0,63}$/` (also for a 65-character id). `registration.stat.test.ts:279` only asserts `>= 400`, so the wrong status is not caught.

**Recommended fix** Return a discriminated result from `checkIdentity` (or test the pattern first in the controller) and answer 400 for shape, 409 for duplicates.

### a6-09 — Shutdown runs twice and exits by signal; the SQLite history is never closed

**Severity** minor

**Where** `apps/api/src/main.ts:20` (`enableShutdownHooks`) and `:57-66` (own SIGTERM handler); `node_modules/@nestjs/core/nest-application-context.js:190-213` (Nest calls `onModuleDestroy` then `process.kill(process.pid, signal)`); `packages/runtime/src/sqliteHistory.ts:81` (`close()` has no caller)

**Claim** Two handlers race on SIGTERM: `main.ts` calls `venue.stop()` then `app.close()` (which calls `stop()` again through `onModuleDestroy`); Nest's own hook calls `onModuleDestroy` and then re-raises the signal, so `process.exit(0)` never runs and the process dies with status "killed by SIGTERM" (143). `history.db` is left with a WAL that is never checkpointed by a close.

**Evidence** (`envmatrix.mjs`, `sigterm.mjs` ×5)

```
exit code null sig SIGTERM after 11 ms; files rewritten on SIGTERM: btcusd.json,eurusd.json,gbpjpy.json,spx.json,xauusd.json; wal present: true
trial 1..5: exit code=null signal=SIGTERM | ENOENT: 0 | tick failed: 0
bf state dir after SIGTERM: history.db 4096 B (mtime 08:54), history.db-wal 3,605,032 B (mtime 10:00), checkpoint jsons rewritten 10:01:38
```

The checkpoint does happen (files rewritten), and no `ENOENT` from the doubled `checkpoint()` was observed in five trials with five assets — the CA6-35 shape is present in principle (two concurrent `store.save` per asset from the same pid) but did not fire here.

**Recommended fix** Keep one shutdown path: drop the `process.once` handlers and let `onModuleDestroy` do the checkpoint; call `history.close()` in a `HistoryService.onModuleDestroy`; if a clean `0` is wanted, do not use `enableShutdownHooks` and call `process.exit(0)` yourself.

### a6-10 — Job history is in-memory only; after a restart the Create screen polls a 404 for ever with its button disabled

**Severity** minor

**Where** `apps/api/src/registration.service.ts:84` (`Map`), `apps/web/src/app/assets/new/CreateAsset.tsx:97-110` (`setInterval` cleared only on a terminal state; `.catch(() => {})`)

**Evidence** `envmatrix.mjs`: after SIGKILL mid-job and reboot on the same directory, `/registrations after restart: []`. Code: the interval keeps firing on 404, `job.state` stays `running`, `running` keeps `create-submit` disabled ("Registering…").

**Recommended fix** Persist jobs beside the registry (a `_jobs.json`), or on a 404 stop polling and show "the engine restarted; check the Assets screen".

### a6-11 — Once a resume point is evicted, one client loops on a 400 every second and the other never reconnects

**Severity** minor (code reading; not exercised — needs 50,000 ticks and a browser)

**Where** `apps/web/src/lib/marketStream.ts:238-243` (reconnects with the same `window.resumeFrom` after every error, fixed 1 s, no backoff); `apps/web/src/app/preview/PreviewChart.tsx:310-337` (bare `EventSource`, no handling of a terminal failure)

**Claim** CA6-31 made an evicted resume a 400 on the server. The ticks page still asks for the same evicted `from` every second for ever (the client cannot see a status code). The Preview chart relies on the browser's own `Last-Event-ID` retry; after eviction that retry is answered 400, and the EventSource algorithm closes on any non-200 without retrying, so the status "stream interrupted — reconnecting" is permanent while the candles are stale. The retention window is 50,000 ticks: ~4.6 h for `btcusd`, ~46 h for `spx` — a laptop closed overnight.

**Recommended fix** On a stream error, both clients should refetch history and reopen without a resume point (drawing the gap honestly as missing bars), with backoff; surface "reconnected after a gap" in the status.

### a6-12 — History `from`/`to` still parse with the tail-discarding `parseInt` that CA6 corrected on the stream

**Severity** minor

**Where** `apps/api/src/market.controller.ts:487-494`

**Evidence** `200 history from=1788349926509abc` (parsed as 1788349926509); `from=1.9` → 1 (then "496,764 bars" refusal); `from=0x10` → 0.

**Recommended fix** The same `/^\d+$/` check the stream endpoint got.

### a6-13 — `displayName` has no length bound and non-string values leak internal messages

**Severity** minor

**Where** `packages/runtime/src/registry.ts:249` (`named.displayName.trim()` with no type check); `market.controller.ts:203`

**Evidence** `200 PATCH /assets/gbpjpy {"displayName":"nnn…(100,000 chars)"}` stored and served in `/catalogue` (rendered in the sidebar for every viewer); `400 {"displayName":123} | named.displayName.trim is not a function`; `400 {"displayName":null} | Cannot read properties of null (reading 'trim')`.

**Recommended fix** `typeof displayName !== 'string'` → RangeError with a real message; cap at e.g. 64 characters.

### a6-14 — The service-booting tests accept any healthy service on their port as their own engine

**Severity** minor (test hazard; relevant with several auditors on one machine)

**Where** `apps/api/src/panelSurface.stat.test.ts:44-91` (fixed 4310+ with EADDRINUSE walk; health polled before the child listens), `clientReconstruction.stat.test.ts:357-397` (34301+), `stream.stat.test.ts:105,143` and `restart.stat.test.ts:260,276,299` (fixed 34101–34103, 34201–34202, no retry), `registration.stat.test.ts:38-49` and `apps/web/src/panel.stat.test.ts:110-123` (OS port, closed, then spawned — TOCTOU)

**Claim** Every `boot` helper polls `GET /health` on the candidate port and returns on the first `ok`, checking only that its own child has not exited _yet_. With `OTC_BACKFILL_DAYS=2` the child spends minutes provisioning before it listens; a foreign engine already on 4310 answers `/health` immediately and the suite runs its INV-004/join assertions against someone else's market while its own child later dies with EADDRINUSE unnoticed — the same "tested a different engine" failure PH-20.2 §5 documents for the panel. Two auditors running `panelSurface.stat.test.ts` at once collide deterministically on 4310.

**Evidence** Code paths above; no collision was provoked (I did not run the fixed-port suites concurrently with another auditor on purpose).

**Recommended fix** Pass a boot nonce in the environment and have `/health` echo it (or wait for the child's own `hosting N markets on :port` log line before polling); never return on a health response the child cannot have produced.

### a6-15 — `OTC_BACKFILL_DAYS` accepts exponent notation and has no upper bound

**Severity** minor

**Where** `apps/api/src/app.module.ts:119-127` (`Number(raw)`)

**Evidence** `OTC_BACKFILL_DAYS=1e3`: `running after 3s: true; refused? false` — a thousand-day, irreversible genesis started from a typo. `abc` and `-1` are refused with clear messages.

**Recommended fix** `/^\d+(\.\d+)?$/` and a documented ceiling (e.g. 365), refused by name.

### a6-16 — Documentation drift on the surface

**Severity** minor

**Where** `apps/api/src/app.module.ts:110-112` ("`main.ts` reads this and asks `HistoryService.provision` before the venue starts" — it is `VenueService.start`, `venue.service.ts:109`); `apps/web/src/app/preview/page.tsx:410` ("through the rewrite in `next.config.mjs`" — it is the route handler, and PH-20.2 §5 says the rewrite was removed); `apps/api/src/market.controller.ts:40-50` ("Read-only observation … Nothing here is economic. There are no positions…" above `POST /assets`, `PATCH`, `retire`); `main.ts:23-45` and PH-20.3 §4 (the CORS sentence, see a6-01); `CreateAsset.tsx:94-96` (see a6-06).

### a6-17 — Duplicate JSON keys: last wins silently

**Severity** minor

**Evidence** `POST /assets {"id":"x",…,"referencePrice":1,"referencePrice":2}` → `201`, and `/registrations` shows `"referencePrice":2`. Standard `JSON.parse`; worth a note because the brief is the one input that decides a market's reference price.

### a6-18 — The panel has no view of `/health`: a stalled venue still reads `live`

**Severity** minor

**Where** `apps/web/src/app/preview/PreviewChart.tsx:308` (status set to `live` when the stream opens, never revisited); nothing in `apps/web` reads `/health`

**Evidence** After the SIGSTOP/SIGCONT on `bf`: `/health` → `degraded` with five reasons; `/markets/btcusd` → `sequence 522100` frozen; the SSE connection stays open with no events, so the chart shows `live` and a frozen `last-price`. This is the operator-visible symptom PH-19.5 §2 describes; the fix reached `/health` and the log, not the screen.

**Recommended fix** Poll `/health` every few seconds in the shell (`Nav`) and show `degraded` with the reason; in `PreviewChart`, flip the status when no tick arrives for > 3× the asset's `meanIntervalMs`.

## What survived

- **Id handling.** `../x`, `%2e%2e`, empty, 65 chars, uppercase, unicode, `__proto__`, `constructor`, `%00`, leading space: 404 on every route; nothing reached the file system (`#pathFor` regex, `assetIds.includes`). No 500 in the id battery.
- **Body limits.** Express's 100 KB JSON limit: a 10 MB JSON body → 413 in 30 ms, 10 MB `text/plain` → 400 in 23 ms, no hang. Deeply nested and `__proto__` bodies → 400 by field name.
- **History validation.** Unknown/`0`/negative/`1e9` timeframes, `NaN`, `Infinity`, strings, 20-digit integers, negatives, `from>to`, empty window, arrays: all 400 with the field named. The 20,000-bar cap holds (`from=0` → "496,764 1h bars, past the 20,000").
- **CA6-34.** `bf` with two days of minute bars: one full-window 1 m request = 467 KB / 2,940 candles; 30 concurrent → 315 ms, +27 MB peak RSS; 60 concurrent → 573 ms, +11 MB more (peak 142 MB vs 1.86 GB before); `/health` stayed `ok`. A maximal 20,000-bar request extrapolates to ~3.2 MB; sixty of them to ~190 MB. Bounded per request; still no rate limit or concurrency cap.
- **SSE.** Headers `text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive` (the `X-Accel-Buffering: no` is added by the Next proxy, verified by `engineProxy.test.ts`). `id:` equals `data.sequence`. `Last-Event-ID` resume after a 4 s disconnect: `first 347..361 | resumed 362..376 | exact continuation`, reconstruction contiguous. `?from` takes precedence over the header. Garbage `Last-Event-ID` (`abc`, `-1`, `1.5`, empty) is ignored and the stream starts live (arguably a silent gap for a client that sent garbage, but only a client that never received an id would). Evicted → 400 (verified by `panelSurface.stat.test.ts`; not reachable on a fresh service here).
- **Connections.** 300 connect/abort cycles: open fds 25 → 25, established sockets 0 → 0, RSS flat. 50 disconnects 30 ms after the request: no unhandled error, no `EPIPE`/`ECONNRESET` in the log. A client that never reads for 60 s is not disconnected — the kernel and Node buffers absorb ~7.7 KB — but memory per such client is bounded by those buffers (RSS +172 KB total over the minute), so the backpressure disconnect is late rather than absent.
- **Registration.** Two `POST /assets` with the same new id plus a third, all at once: all 201; the queue ran them one at a time; the second `race1` was refused at `identity` ("already registered") after the first completed. Persist-before-host order confirmed in `registration.service.ts:170-171`. SIGKILL 350 ms into two metal jobs: registry held `killme.json` and no `.tmp`; the reboot was healthy with `killme` hosted; `registration.stat.test.ts` 4/4 in 23 s. Plant "retired market resumed at boot" caught.
- **Retire.** Second retire 409; retired market not resumed at boot (plant caught); history still answers (the suite asserts 200); `/catalogue` reports `live:false, retired:true`.
- **Catch-up failure.** SIGSTOP 20 s: every market `STALLED — Market is 23s behind the clock, past the 15s catch-up bound`, `/health` → `degraded` naming each asset and reason, `/markets/:id` frozen with `recovery: resumed`. Permanent until restart, by ADR-0010.
- **Boot.** No secret → exit 1 naming `OTC_MASTER_SECRET` and INV-009; `abc` secret → "must be 64 hex characters"; `OTC_BACKFILL_DAYS=abc`/`-1` → exit 1 by name; `PORT=abc`/`70000` → `ERR_SOCKET_BAD_PORT` exit 1; a three-level missing `OTC_STATE_DIR` is created (checkpoints, `history.db`, `assets/`). `OTC_CORS_ORIGIN="http://a.example, http://b.example"` → preflights from both named origins get `GET,HEAD,POST,PATCH,OPTIONS`; `evil.example` gets no `Access-Control-Allow-Origin`.
- **Proxy.** `engineProxy.test.ts` 8/8; `GET`/`POST`/`PATCH` exported and these are the three methods `lib/api.ts` uses (retire is a POST); `..` segments are normalised by `new URL` inside the engine origin, so no traversal past it; `Last-Event-ID`, `accept`, `content-type` forwarded in, `content-type`/`cache-control`/`etag` forwarded out; `OTC_API_BASE` read per request (test). Engine down → the route handler's `fetch` rejects and Next answers a generic 500, which the panel shows verbatim as `500 from /engine/catalogue: …` — blunt but not silent.
- **Bundle.** `npm run build:web` exit 0; `grep -rl OTC_API_BASE apps/web/.next/static` → 0 files; `127.0.0.1:3000` → 0 files; the only reader is the server route chunk. `next.config.mjs` has no `env` key (test).
- **Hydration.** `layout.tsx`/`page.tsx` are static; `Date.now()` and `toLocaleTimeString` in `PreviewChart` run in effects or on client-only state (`last` is null at SSR). `Chart.tsx` unsubscribes on unmount and its pending reconnect timer checks `closed`; `PreviewChart` aborts the fetch, closes the stream and removes the price line on every asset/timeframe change.
- **Rendering contract.** The ticks page draws only `reduceToColumns` output from a `TickWindow` (`columnsFor`); the candle page draws `toBars` of stored candles and `LiveBarBuilder` bars only for buckets opened after connect (CA6-30's rule, `bars.ts:173-179`). Timeframe switching re-reduces or refetches the same record and never touches the stream.
- **Contract drift.** `HistoryCandle` (chart) equals core `Candle` field for field; `CatalogueEntry` matches the controller (`retired` is optional in the type and always present); `ArchetypeEntry` omits the extra `excessKurtosis` the controller sends (harmless); `RegistrationJobView` matches `RegistrationJob`; no `bigint` anywhere; the only number-as-string is `displayPrice` on `/markets`, which the panel does not consume. Ticks arrive as plain numbers and are cast to the branded `Tick` type.
- **Accessibility basics.** Every input is inside a `<label>` with visible text; every action is a `<button type="button">` with text; the retire confirmation reads "retire {id} for good?" before a red `retire` button.

## Limits of this audit

- **No browser here.** Chromium cannot launch on this host (a6-03), so the browser suite ran only as a skip and as a required-failure; the two PH-20 browser plants were replaced by a proxy plant and an API plant, both caught. The EventSource claims in a6-04 and a6-11 rest on the WHATWG algorithm and the code, not on an observed browser.
- **Eviction not exercised.** The 50,000-tick retention window was not reached; evicted-resume behaviour is taken from `panelSurface.stat.test.ts` (which I did not run — it needs a backfilled boot of several minutes and shares port 4310 with any other auditor).
- **Shared machine.** Seven auditors; timings (315/573 ms, 11 ms shutdown) are indicative. RSS was sampled with `ps -o rss` at 50 ms.
- **Not run:** `panelSurface.stat.test.ts`, `stream.stat.test.ts`, `restart.stat.test.ts`, `clientReconstruction.stat.test.ts` (fixed ports; a6-14), the full statistical suite, `npm run gate`, `npm run lint` — per the brief.
- **Not attempted:** any change under `packages/` that a spawned service would need (the service resolves packages through the main repository's `dist`); the `OTC_PUBLICATION_DIR` publishing path; the trading boundary.
- **Cleanup verified:** both hand-started engines killed (`pgrep` empty), all `/tmp/a6-*` directories removed, `apps/web/.next` removed, `git -C /home/alejo/.otc-audit7/a6 status --short` prints only the coordinator's `?? node_modules` symlink; ignored `dist/` and `tsbuildinfo` files exist from the `npm run build` the brief asked for.
