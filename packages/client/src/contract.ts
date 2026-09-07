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

export type Shape = Readonly<Record<string, FieldType>>;

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

const PUBLISHED: Shape = {
  sequence: 'integer',
  instant: 'integer',
  price: 'integer',
  displayPrice: 'string',
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
};

const TICK_FRAME: Shape = { sequence: 'integer', instant: 'integer', price: 'integer' };
const GAP_FRAME: Shape = { requested: 'integer|null', reason: 'string', resumesAt: 'integer|null' };

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
  },
  {
    method: 'GET',
    path: '/markets/:id',
    summary: 'One hosted market and where it stands.',
    params: { id: 'a hosted asset id' },
    response: { object: MARKET },
    refusals: { '404': 'the asset is not hosted' },
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
        tieRate: 'number',
        excessKurtosis: 'number',
        dispersion: 'object',
      },
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
        candles: 'array',
      },
    },
    refusals: {
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
    response: { object: { assetId: 'string', at: 'integer', rule: 'string', ...PUBLISHED } },
    refusals: {
      '400':
        'a missing or malformed instant, or an instant after the newest published one — for a market this process no longer hosts, after the newest instant its record holds',
      '404':
        'the asset is unknown, the record starts after the instant, or this deployment keeps no record',
      '409':
        'the instant falls inside a recorded discontinuity — nothing was published for it and nothing ever will be; the seam is named (see /markets/:id/seams)',
    },
  },
  {
    method: 'GET',
    path: '/markets/:id/seams',
    summary:
      'Every discontinuity the record holds for this market: where it stops and where it starts again, in sequence and in instant. What settle() takes as seams.',
    params: { id: "a known asset id; a retired market's record still answers" },
    response: { array: SEAM },
    refusals: { '404': 'the asset is unknown, or this deployment keeps no record' },
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
    },
    stream: {
      message: TICK_FRAME,
      gap: GAP_FRAME,
      close: { reason: 'string' },
    },
    refusals: {
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
    },
    stream: {
      message: { asset: 'string', ...TICK_FRAME },
      gap: { asset: 'string', ...GAP_FRAME },
      close: { asset: 'string', reason: 'string' },
    },
    refusals: { '400': 'a malformed parameter, or an asset that is not hosted' },
  },
  {
    method: 'GET',
    path: '/registrations',
    summary: 'Every asset-registration job this process has run.',
    response: { array: REGISTRATION_JOB },
  },
  {
    method: 'GET',
    path: '/registrations/:id',
    summary: 'One registration job.',
    params: { id: 'a job id' },
    response: { object: REGISTRATION_JOB },
    refusals: { '404': 'no such job' },
  },
  {
    method: 'POST',
    path: '/assets',
    summary: 'Register an asset from a brief; answers the job that builds it.',
    admin: true,
  },
  { method: 'PATCH', path: '/assets/:id', summary: 'Rename an asset.', admin: true },
  {
    method: 'POST',
    path: '/assets/:id/retire',
    summary: 'Stop hosting a market; its record stays readable.',
    admin: true,
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
    .map(([key, type]) => `| \`${key}\` | \`${type}\` |`)
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
