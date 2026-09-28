import { createHash } from 'node:crypto';

/**
 * The venue's API as a contract (PH-29.2).
 *
 * A broker codes against routes, parameters and response shapes; until this
 * file those lived in a controller and its tests, and a change to any of them
 * was a diff nobody outside the repository could read. This is the same
 * knowledge as data: every public route, what it takes, what it answers and
 * how it refuses. The venue serves it at `GET /contract`, `/health` carries
 * its version, `docs/architecture/API_CONTRACT.md` is rendered from it, and
 * `contract.test.ts` holds the controller to it — the route set, and every
 * live response's keys and types — and fails when the contract's digest moves
 * without a new entry in {@link CONTRACT_HISTORY}. A breaking change is a
 * version, or it is a red build.
 *
 * Types are named as strings a client can read: `integer`, `number`,
 * `string`, `boolean`, `array`, `object`, and `T|null` for a nullable.
 */
export type FieldType =
  | 'integer'
  | 'number'
  | 'string'
  | 'boolean'
  | 'array'
  | 'object'
  | 'integer|null'
  | 'number|null'
  | 'string|null'
  | 'object|null';

/**
 * An array whose every item has these keys (PH-40.4). A bare `'array'` says only
 * that a value is a list, and Cycle Audit 13 fed the history route
 * `[{nonsense:true,logQuantum:'banana'}, 7, null]` and the shape check passed it.
 */
export interface ItemsField {
  readonly items: Shape;
}

export type Shape = Readonly<Record<string, FieldType | ItemsField>>;

export interface RouteContract {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly summary: string;
  /** Path parameters and what they must be. */
  readonly params?: Readonly<Record<string, string>>;
  /** Query parameters and what they must be; `?` marks an optional one. */
  readonly query?: Readonly<Record<string, string>>;
  /** A JSON object with these keys, or an array whose items have these keys. */
  readonly response?: { readonly object: Shape } | { readonly array: Shape };
  /** A server-sent event stream: the frames it writes, by event name (`message` is the default event). */
  readonly stream?: Readonly<Record<string, Shape>>;
  /** Status → when. */
  readonly refusals?: Readonly<Record<string, string>>;
  /** Needs the operator's bearer token (`OTC_ADMIN_TOKEN`) and a JSON body. */
  readonly admin?: true;
  /** A plain-text response in the named format rather than JSON. */
  readonly text?: 'prometheus';
}

const MARKET: Shape = {
  id: 'string',
  displayName: 'string',
  family: 'string',
  price: 'integer|null',
  displayPrice: 'string|null',
  sequence: 'integer|null',
  instant: 'integer|null',
  recovery: 'object|null',
};

/**
 * A published tick, and the frame its integer counts in (PH-38.3).
 *
 * `price` is a count of log quanta above a reference, so it is not a price
 * until it is paired with the two numbers that make it one. Until 3.0.0 those
 * were served only by `/catalogue`, as the values in force **now**, and every
 * recorded tick was rendered with them — so when a release moved a lattice the
 * whole retained past began answering with prices nobody had published.
 *
 * `logQuantum` and `referencePrice` are therefore carried with the tick, and
 * `displayPrice` is **null** when the venue cannot say what the integer counted
 * in, rather than a number derived from today's frame. The integer is never
 * null: it is the settlement primitive and it is not in doubt.
 */
const PUBLISHED: Shape = {
  sequence: 'integer',
  instant: 'integer',
  price: 'integer',
  logQuantum: 'number|null',
  referencePrice: 'number|null',
  // How many decimals `displayPrice` carries: TradingView's `pricescale` is
  // `10 ** displayPrecision` (PH-40.4, Cycle Audit 13 a2-04).
  displayPrecision: 'integer|null',
  displayPrice: 'string|null',
};

/**
 * One stored candle (PH-40.4). Four integers on the tick lattice and the frame
 * they count in — null, all three, when the bar straddles a change of unit and so
 * is a price in neither. `tickCount` is what a chart shows as volume.
 */
const CANDLE: Shape = {
  openInstant: 'integer',
  timeframe: 'string',
  open: 'integer',
  high: 'integer',
  low: 'integer',
  close: 'integer',
  tickCount: 'integer',
  firstSequence: 'integer',
  lastSequence: 'integer',
  logQuantum: 'number|null',
  referencePrice: 'number|null',
  displayPrecision: 'integer|null',
};

/** A frame in force from a sequence onward, as `GET /markets/:id/lattices` lists it. */
const LATTICE: Shape = {
  assetId: 'string',
  fromSequence: 'integer',
  fromInstant: 'integer',
  logQuantum: 'number',
  referencePrice: 'number',
  displayPrecision: 'integer',
};

/**
 * A recorded discontinuity, as `GET /markets/:id/seams` lists it (PH-31).
 *
 * The two instants are what `settle()`'s `RecordSeam` takes; the two sequences
 * say where the record stops and starts again, so the same answer explains a
 * hole in `/ticks/:sequence` and a restart in the commitment chain.
 */
const SEAM: Shape = {
  assetId: 'string',
  lastSequence: 'integer',
  lastInstant: 'integer',
  resumesAtSequence: 'integer',
  resumesAtInstant: 'integer',
  reframes: 'boolean',
};

const TICK_FRAME: Shape = { sequence: 'integer', instant: 'integer', price: 'integer' };
const GAP_FRAME: Shape = { requested: 'integer|null', reason: 'string', resumesAt: 'integer|null' };
/**
 * The price in force and the instant it is final through (PH-40.2): what a
 * `?heartbeat=` stream writes between ticks. `sequence`, `instant` and `price`
 * are the tick in force — one this connection has already been handed, or, on
 * a live join, the one the stream continues after — and `/markets/:id/price`
 * answers that tick for every instant from `instant` through `asOf`.
 */
const HEARTBEAT_FRAME: Shape = { ...TICK_FRAME, asOf: 'integer' };
const HEARTBEAT_QUERY =
  'milliseconds between heartbeat frames, 500 to 30000; omitted, the stream carries none';

const REGISTRATION_JOB: Shape = {
  id: 'string',
  brief: 'object',
  state: 'string',
  stage: 'string|null',
  reason: 'string|null',
  assetId: 'string|null',
  submittedAt: 'integer',
  finishedAt: 'integer|null',
};

export const API_ROUTES: readonly RouteContract[] = [
  {
    method: 'GET',
    path: '/health',
    summary:
      'Whether every hosted market is publishing, and the contract version this venue speaks.',
    response: {
      object: {
        status: 'string',
        assets: 'integer',
        stalled: 'array',
        bootNonce: 'string|null',
        apiVersion: 'string',
        ready: 'boolean',
        // `production` or `lab` (ADR-0018). A Lab-composed process serves every
        // route here **plus** `/lab` and its price-steering controls, and nothing
        // in the API said which one you were talking to: a broker's own gate
        // passed against a Lab. Refuse to go live against anything but
        // `production`.
        composition: 'string',
      },
    },
  },
  {
    method: 'GET',
    path: '/health/live',
    summary: 'Liveness: the process serves HTTP. Nothing about the markets.',
    response: { object: { live: 'boolean' } },
  },
  {
    method: 'GET',
    path: '/health/ready',
    summary:
      'Readiness: every market resumed and primed, nothing stalled; 503 with the reason until then.',
    response: { object: { ready: 'boolean' } },
    refusals: {
      '503':
        'the markets have not finished resuming, the venue is shutting down, or a market is stalled (named)',
    },
  },
  {
    method: 'GET',
    path: '/metrics',
    summary:
      'The operator counters in the Prometheus text format: markets, stalls, readiness, ticks published, subscribers, replay budget, uptime, memory, record heads.',
    text: 'prometheus',
  },
  {
    method: 'GET',
    path: '/contract',
    summary: 'This contract, as data, with its version and digest.',
    response: { object: { version: 'string', digest: 'string', routes: 'array' } },
  },
  {
    method: 'GET',
    path: '/markets',
    summary: 'Every hosted market and where it stands.',
    response: { array: MARKET },
    refusals: {
      // Every route but the operational probes is rate limited, so this is the one
      // refusal a broker's own traffic causes — and it was on no route and in no
      // guide until the readiness audit of 2026-09-28.
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id',
    summary: 'One hosted market and where it stands.',
    params: { id: 'a hosted asset id' },
    response: { object: MARKET },
    refusals: {
      '404': 'the asset is not hosted',
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/catalogue',
    summary:
      'Every asset this deployment knows, hosted or not, with its instrument and calibration.',
    response: {
      array: {
        seat: 'object|null',
        id: 'string',
        displayName: 'string',
        family: 'string',
        live: 'boolean',
        retired: 'boolean',
        referencePrice: 'number',
        displayPrecision: 'integer',
        logQuantum: 'number',
        meanIntervalMs: 'number',
        // The fraction of horizons whose continuous return was smaller than one
        // quantum: a proxy for texture, **not** the rate a contract is refunded
        // at, and typically three to four times larger than it.
        tieRate: 'number',
        // The at-the-money rate this asset's lattice actually produces at the
        // shortest horizon, measured on the published series. This is the number a
        // broker sizes a payout with, and the one the refund ceiling bounds.
        realisedRefundRate: 'number',
        excessKurtosis: 'number',
        dispersion: 'object',
      },
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/archetypes',
    summary: 'The archetypes an operator may register an asset under.',
    response: {
      array: {
        id: 'string',
        label: 'string',
        family: 'string',
        character: 'string',
        dispersion: 'object',
        excessKurtosis: 'object',
      },
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/history',
    summary: 'Stored candles of one market over a window, at an offered timeframe.',
    params: { id: 'a known asset id' },
    query: {
      timeframe: 'an offered timeframe id, 1m or coarser',
      from: 'an instant in milliseconds, inclusive',
      to: 'an instant in milliseconds, exclusive, after from',
    },
    response: {
      object: {
        assetId: 'string',
        timeframe: 'string',
        from: 'integer',
        to: 'integer',
        candles: { items: CANDLE },
      },
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
      '400':
        'a missing or malformed parameter, a timeframe finer than 1m, or a window past 20 000 bars',
      '404': 'the asset is unknown, or this deployment keeps no candle history',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/ticks/:sequence',
    summary: 'The published tick at a sequence, from the record.',
    params: {
      id: "a known asset id; a retired market's record still answers",
      sequence: 'a positive integer written as digits',
    },
    response: { object: { assetId: 'string', ...PUBLISHED } },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
      '400': 'the sequence is not a positive integer',
      '404':
        'the asset is unknown, the sequence is outside the record (the bounds are named), or this deployment keeps no record',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/price',
    summary:
      'The price in force at an instant: the last published tick at or before it, the rule settlement uses. A retired market answers it from its record, which is what retirement leaves readable.',
    params: { id: "a known asset id; a retired market's record still answers" },
    query: { at: 'an instant in milliseconds' },
    response: {
      object: {
        assetId: 'string',
        at: 'integer',
        rule: 'string',
        ...PUBLISHED,
        seam: 'object|null',
      },
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
      '400':
        'a missing or malformed instant, or an instant after the one the price is final through — the last clean pass for a hosted market, the newest instant its record holds for one this process no longer hosts. This is what makes a contract impossible to settle before its final millisecond',
      '404':
        'the asset is unknown, the record starts after the instant, or this deployment keeps no record',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/seams',
    summary:
      'Every discontinuity the record holds for this market: where it stops and where it starts again, in sequence and in instant. What settle() takes as seams.',
    params: { id: "a known asset id; a retired market's record still answers" },
    response: { array: SEAM },
    refusals: {
      '404': 'the asset is unknown, or this deployment keeps no record',
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/lattices',
    summary:
      "Every frame this market's integers have counted in, oldest first. Half-open by sequence: an epoch covers up to the next one's fromSequence, and the last is in force. The join table for a broker that archived raw integers.",
    params: { id: "a known asset id; a retired market's record still answers" },
    response: { array: LATTICE },
    refusals: {
      '404': 'the asset is unknown, or this deployment keeps no record',
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/proof/:sequence',
    summary:
      'The inclusion proof of a published sequence: the signed commitment of its window, the Merkle path and the publisher key.',
    params: { id: 'a hosted asset id', sequence: 'a positive integer written as digits' },
    response: {
      object: {
        assetId: 'string',
        sequence: 'integer',
        publisherPublicKey: 'string|null',
        commitment: 'object',
        proof: 'object',
        linksRead: 'integer',
      },
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
      '400': 'the sequence is not a positive integer',
      '404': 'the asset is unknown, or this deployment does not publish commitments',
      '409':
        'the sequence is published but its window is not yet committed (the newest committed sequence is named), or the archive disagrees with the record, or the archived window no longer hashes to the root its commitment signs',
      '503':
        'the commitment chain file is damaged past a line the message names; proofs of earlier sequences are unaffected',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/stream',
    summary:
      'Server-sent events: every tick of one market in order, resumable by sequence; a gap is told, never skipped.',
    params: { id: 'a hosted asset id' },
    query: {
      'from?': 'the next sequence wanted; omitted joins at the live edge',
      'onGap?':
        "'live' to be told a gap and joined at the sequence the feed resumes at, instead of a 400",
      'heartbeat?': HEARTBEAT_QUERY,
    },
    stream: {
      message: TICK_FRAME,
      gap: GAP_FRAME,
      close: { reason: 'string' },
      heartbeat: HEARTBEAT_FRAME,
    },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
      '400':
        'a malformed from or onGap, or (without onGap=live) a sequence the venue cannot replay — including, between a restart that seamed this market and its first tick, every sequence below the one it will resume at',
      '404': 'the asset is not hosted',
    },
  },
  {
    method: 'GET',
    path: '/markets/stream',
    summary: 'Server-sent events: several markets on one connection, each frame naming its asset.',
    query: {
      assets: 'comma-separated hosted asset ids',
      'from?': 'per-asset next sequences, in the order of assets',
      'onGap?': "'live', as for one market",
      'heartbeat?': HEARTBEAT_QUERY,
    },
    stream: {
      message: { asset: 'string', ...TICK_FRAME },
      gap: { asset: 'string', ...GAP_FRAME },
      close: { asset: 'string', reason: 'string' },
      heartbeat: { asset: 'string', ...HEARTBEAT_FRAME },
    },
    refusals: {
      '400': 'a malformed parameter, or an asset that is not hosted',
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/registrations',
    summary: 'Every asset-registration job this process has run.',
    response: { array: REGISTRATION_JOB },
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'GET',
    path: '/registrations/:id',
    summary: 'One registration job.',
    params: { id: 'a job id' },
    response: { object: REGISTRATION_JOB },
    refusals: {
      '404': 'no such job',
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'POST',
    path: '/assets',
    summary: 'Register an asset from a brief; answers the job that builds it.',
    admin: true,
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'PATCH',
    path: '/assets/:id',
    summary: 'Rename an asset.',
    admin: true,
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
  {
    method: 'POST',
    path: '/assets/:id/retire',
    summary: 'Stop hosting a market; its record stays readable.',
    admin: true,
    refusals: {
      '429':
        'too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused',
    },
  },
];

/**
 * The contract's versions, oldest first. The last entry is the one in force:
 * its digest must equal {@link contractDigest} over {@link API_ROUTES}, and
 * its version is {@link API_VERSION}. A change to the routes is a new entry
 * with a greater version, or the guard fails by name.
 */
export const CONTRACT_HISTORY: readonly { readonly version: string; readonly digest: string }[] = [
  { version: '1.0.0', digest: '5bc1dd766f15aa0c' },
  // PH-30.1: liveness, readiness, metrics; `ready` on /health. Additive.
  { version: '1.1.0', digest: '1f9fc7c84b19c58c' },
  // PH-31 (Cycle Audit 10, a4-01 / a1-01): `GET /markets/:id/seams`, and a
  // `409` on `GET /markets/:id/price` for an instant inside a recorded
  // discontinuity.
  //
  // **Major, not minor.** The route is additive, but the refusal is not: an
  // instant a 1.x venue answered `200` with a price is now refused, so a
  // broker that treats a non-200 as a transport error changes behaviour on
  // requests it was already making. The old answer was wrong — it was the
  // price of a tick from before a gap nobody generated, settled against for
  // real money — and correcting a wrong answer to a refusal is still a change
  // a client must be told about by its version.
  { version: '2.0.0', digest: '0d5dd03fcc427fee' },
  // Cycle Audit 10, two changes in one version because they landed together.
  //
  // **The proof route (a4-05, and a8-06's refusal written down).** Its `409`
  // now also covers an archived window that no longer hashes to the root its
  // own commitment signs — a window an operator edited serves no proof for any
  // sequence in it, not only for the line that was edited — and the `503` a
  // damaged chain file has answered since a8-06 is listed rather than left for
  // a broker to meet unannounced.
  //
  // **The routes that answered `500` (a4-06, a6-08, a6-02, a1-06).**
  // `GET /markets/:id/price` on a **retired** market threw a bare `RangeError`
  // reaching for a live tick the venue no longer hosts, so a broker settling an
  // open contract on it got `500 Internal server error` — nothing that says
  // whether to retry — for exactly the markets whose contracts are running out.
  // It answers from the record now, bounded by the record's own head. And
  // `GET /markets/:id/stream` in the window between a seamed boot and its first
  // tick: the feed held nothing there, so it refused a resume from a sequence
  // it really had published, while `from=1` was accepted and silently joined at
  // the seam. The venue declares the resume point to the feed at priming, so
  // that window now answers what the window after it answers.
  //
  // **Minor, not major.** Every status this table already listed still means
  // what it said. Two refusals a venue could already make are written down; a
  // `500` becomes the `200` this table always described; and one request that
  // used to succeed by accident — `from=1` inside a sub-second boot window,
  // answered with a silent jump — now gets the `400` the same table already
  // lists for a sequence the venue cannot replay.
  { version: '2.1.0', digest: '76df7ddf99783c45' },
  // PH-38.3: a published price says what it counts in, and `GET
  // /markets/:id/lattices` lists every frame the record has held.
  //
  // **Major, and the reason is a correction rather than a feature.** A
  // canonical price is an integer count of log quanta above a reference, so it
  // is not a price until it is paired with those two numbers — and until now
  // they were served only by `/catalogue`, as the values in force *now*. Every
  // recorded tick was rendered with them, so when v2.4.0 moved all thirty
  // lattices the whole retained past began answering with prices nobody had
  // ever published: measured on the live venue, 3,728,119 of 7,500,278 retained
  // ticks, on 30 of 30 assets, a median error of 31.8% and a worst case of
  // 1,483% (Cycle Audit 12, finding 3).
  //
  // Two changes a broker must be told about by a version. `PUBLISHED` carries
  // `logQuantum` and `referencePrice`, so a client that archived integers can
  // render them for itself rather than one request per tick. And
  // `displayPrice` is now `string|null`: a venue that cannot say what an
  // integer counted in answers **null** instead of a number derived from a
  // frame nobody published it on. A broker whose parser rejects null will fail
  // on exactly the deep-history requests it makes to reconcile a statement —
  // which is the change being announced, and is why this is 3.0.0 and not
  // 2.2.0.
  { version: '3.0.0', digest: 'd205f4f674c19cfa' },
  // PH-40.1, ADR-0021 (the Human Owner, 2026-09-26): a contract settles at its
  // final millisecond, across any seam. Two changes a broker is told about here.
  // `GET /markets/:id/price` no longer answers 409 inside a seam: it answers the
  // price in force — the last tick before the gap, which the market reopened
  // from — and names the seam in a new `seam` key, null outside one. And every
  // entry of `GET /markets/:id/seams` says whether the lattice changed there
  // (`reframes`), because that is the one seam `settle()` still refuses.
  //
  // **Minor.** Nothing a 3.0.0 client parses becomes invalid: two keys are added,
  // and a refusal a client handled by refunding now arrives as a price it settles
  // at — which is the rule this version exists to deliver.
  { version: '3.1.0', digest: 'fbe42c5a23f5c378' },
  // PH-40.2: a market that is open says so. A stream asked for `?heartbeat=<ms>`
  // writes an `event: heartbeat` frame between ticks: the tick in force and
  // `asOf`, the instant it is final through. And `GET /markets/:id/price` answers
  // any instant up to that point rather than only up to the last tick, so a
  // contract settles once its final millisecond has passed instead of waiting
  // for the market's next tick.
  //
  // **Minor.** The heartbeat is opt-in, so a client that never asks for it never
  // meets the event; and the only requests whose answer changes are ones that
  // were refused `400` — *not yet* — and are now answered with the price that
  // retry would have got.
  { version: '3.2.0', digest: '689cdc98d3e3828c' },
  // PH-40.4, Cycle Audit 13 a3-03 and a2-04: what a chart consumes is in the
  // contract. `GET /markets/:id/history` declares its candle — four integers,
  // the tick count a chart shows as volume, the sequences it was folded from and
  // the frame it counts in — where it said only `array`, and every published
  // price and candle says how many decimals it carries (`displayPrecision`,
  // TradingView's `pricescale` is `10 ** displayPrecision`).
  //
  // **Minor.** One key is added to every price and every candle; nothing a 3.2.0
  // client parses changes meaning.
  { version: '3.3.0', digest: '29f014d456a6c000' },
  // The readiness audit of 2026-09-28: `GET /catalogue` serves
  // `realisedRefundRate` beside `tieRate`, and the two are now defined. `tieRate`
  // is a proxy — the fraction of horizons whose continuous return was smaller than
  // one quantum — reading 11%–17% where the rate the engine refunds at is
  // 3.5%–4.8%; it was the only one served and defined nowhere, so a broker sizing
  // a payout from it was three to four times out.
  //
  // **Minor.** One key is added to an item a 3.3.0 client already parses.
  { version: '3.4.0', digest: '841f6c8a05b0ff11' },
  // The readiness audit of 2026-09-28: every route but the operational probes now
  // lists the `429` it has always been able to answer. `OTC_RATE_LIMIT_PER_MINUTE`
  // is 600 by default and `GET /markets/:id/price` — the settlement route — is
  // among them, so this is the one refusal a broker's own traffic causes; it was
  // on no route and in no guide, and its body omitted the `error` key the guide
  // declares every refusal carries. The body carries it now.
  //
  // **Minor.** A status the venue could always answer is written down.
  { version: '3.5.0', digest: '6b778c7f993eb41c' },
  // The readiness audit of 2026-09-28: `GET /health` says which composition
  // answered, `production` or `lab` (ADR-0018). A Lab-composed process serves
  // every route in this contract **and** `/lab`, whose controls push, pulse and
  // target a market's price — and nothing here distinguished them, so the broker's
  // own pre-production gate passed 37 of 37 against a Lab. The conformance suite
  // now refuses anything but `production`.
  //
  // **Minor.** One key is added to a response a 3.5.0 client already parses.
  { version: '3.6.0', digest: 'd94c5ab58d3ba40a' },
];

export const API_VERSION: string = CONTRACT_HISTORY[CONTRACT_HISTORY.length - 1]!.version;

/** A stable digest of the routes: sha256 over their canonical JSON. */
export function contractDigest(routes: readonly RouteContract[] = API_ROUTES): string {
  return createHash('sha256').update(JSON.stringify(routes)).digest('hex').slice(0, 16);
}

/** What `GET /contract` answers. */
export function contractDocument(): {
  version: string;
  digest: string;
  routes: readonly RouteContract[];
} {
  return { version: API_VERSION, digest: contractDigest(), routes: API_ROUTES };
}

function shapeRows(shape: Shape): string {
  return Object.entries(shape)
    .map(([key, type]) =>
      typeof type === 'string'
        ? `| \`${key}\` | \`${type}\` |`
        : `| \`${key}\` | array of \`{ ${Object.entries(type.items)
            .map(([k, t]) => `${k}: ${typeof t === 'string' ? t : 'array'}`)
            .join(', ')} }\` |`,
    )
    .join('\n');
}

/** The contract as the Markdown `docs/architecture/API_CONTRACT.md` holds. */
export function renderContract(): string {
  const lines: string[] = [
    '# API Contract',
    '',
    'Type: SUPPORTING DOCUMENTATION (generated; do not edit by hand)',
    `Version: ${API_VERSION}`,
    `Digest: ${contractDigest()}`,
    'Source: `apps/api/src/contract.ts` — rendered by `npm run contract:render`; held to the controller by `contract.test.ts`',
    '',
    '---',
    '',
    'Every public route of the venue, what it takes, what it answers and how it',
    'refuses. Types: `integer`, `number`, `string`, `boolean`, `array`, `object`,',
    'and `T|null` for a nullable. `GET /contract` serves the same data; `/health`',
    'carries the version. A change to any route is a new version in',
    '`CONTRACT_HISTORY`, or the unit suite fails.',
    '',
  ];
  for (const route of API_ROUTES) {
    lines.push(`## ${route.method} \`${route.path}\``, '', route.summary, '');
    if (route.admin) {
      lines.push('Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.', '');
    }
    if (route.params) {
      lines.push('| Path parameter | Must be |', '| --- | --- |');
      for (const [k, v] of Object.entries(route.params)) lines.push(`| \`${k}\` | ${v} |`);
      lines.push('');
    }
    if (route.query) {
      lines.push('| Query parameter | Must be |', '| --- | --- |');
      for (const [k, v] of Object.entries(route.query)) lines.push(`| \`${k}\` | ${v} |`);
      lines.push('');
    }
    if (route.response) {
      const isArray = 'array' in route.response;
      lines.push(
        isArray ? 'Response: a JSON array; each item:' : 'Response: a JSON object:',
        '',
        '| Key | Type |',
        '| --- | --- |',
        shapeRows(isArray ? route.response.array : route.response.object),
        '',
      );
    }
    if (route.text !== undefined) {
      lines.push(`Response: \`text/plain\`, the ${route.text} text format.`, '');
    }
    if (route.stream) {
      lines.push(
        'Response: `text/event-stream`. Frames by event name (`message` is the default event):',
        '',
      );
      for (const [event, shape] of Object.entries(route.stream)) {
        lines.push(`\`${event}\`:`, '', '| Key | Type |', '| --- | --- |', shapeRows(shape), '');
      }
    }
    if (route.refusals) {
      lines.push('| Status | When |', '| --- | --- |');
      for (const [k, v] of Object.entries(route.refusals)) lines.push(`| ${k} | ${v} |`);
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
