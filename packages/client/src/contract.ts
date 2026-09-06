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
    params: { id: 'a hosted asset id', sequence: 'a positive integer written as digits' },
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
      'The price in force at an instant: the last published tick at or before it, the rule settlement uses.',
    params: { id: 'a hosted asset id' },
    query: { at: 'an instant in milliseconds' },
    response: { object: { assetId: 'string', at: 'integer', rule: 'string', ...PUBLISHED } },
    refusals: {
      '400': 'a missing or malformed instant, or an instant after the newest published one',
      '404':
        'the asset is unknown, the record starts after the instant, or this deployment keeps no record',
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
      '400': 'the sequence is not a positive integer',
      '404': 'the asset is unknown, or this deployment does not publish commitments',
      '409':
        'the sequence is published but its window is not yet committed (the newest committed sequence is named), or the archive disagrees with the record',
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
        "'live' to be told a gap and joined at the oldest retained sequence, instead of a 400",
    },
    stream: {
      message: TICK_FRAME,
      gap: GAP_FRAME,
      close: { reason: 'string' },
    },
    refusals: {
      '400':
        'a malformed from or onGap, or (without onGap=live) a sequence the venue cannot replay',
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
