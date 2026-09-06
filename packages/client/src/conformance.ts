import type { Tick } from '@otc/core';
import {
  verifyCommitment,
  verifyInclusion,
  type InclusionProof,
  type SignedCommitment,
} from '@otc/distribution';
import { API_ROUTES, API_VERSION, contractDigest, type RouteContract } from './contract.js';
import { shapeProblems } from './shape.js';
import { readStream } from './sse.js';

/**
 * The integration checklist, executable against a live venue (PH-29.3).
 *
 * A broker ran the guide's checklist by hand; this runs it: every contracted
 * JSON route answers with exactly the contracted keys and types, the stream
 * resumes exactly and tells a gap rather than skipping it, the price route
 * answers by the rule over the ticks the stream delivered, and a proof for a
 * committed sequence verifies against the publisher's key. Pure over `fetch`,
 * so a test can point it at a spawned venue and a broker at its deployment.
 */
export interface ConformanceCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ConformanceReport {
  readonly baseUrl: string;
  readonly clientVersion: string;
  readonly venueVersion: string | null;
  readonly assets: readonly string[];
  readonly checks: readonly ConformanceCheck[];
  readonly ok: boolean;
}

export interface ConformanceOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** Ticks to read from the stream for the resume and price checks. */
  readonly ticks?: number;
  readonly signal?: AbortSignal;
}

interface MarketView {
  readonly id: string;
  readonly sequence: number | null;
  readonly instant: number | null;
}

function lastAtOrBefore(ticks: readonly Tick[], instant: number): Tick | null {
  let found: Tick | null = null;
  for (const tick of ticks) {
    if (tick.instant <= instant) found = tick;
    else break;
  }
  return found;
}

export async function conformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const wanted = options.ticks ?? 200;
  const checks: ConformanceCheck[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };
  const get = async (path: string): Promise<{ status: number; body: unknown; text: string }> => {
    const response = await doFetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  };

  // ---- the venue speaks this contract ---------------------------------------
  let venueVersion: string | null = null;
  const health = await get('/health');
  if (health.status !== 200 || typeof health.body !== 'object' || health.body === null) {
    check(
      'health answers',
      false,
      `GET /health answered ${health.status}: ${health.text.slice(0, 200)}`,
    );
    return {
      baseUrl: base,
      clientVersion: API_VERSION,
      venueVersion,
      assets: [],
      checks,
      ok: false,
    };
  }
  check('health answers', true, `status ${String((health.body as { status?: unknown }).status)}`);
  const spoken = (health.body as { apiVersion?: unknown }).apiVersion;
  venueVersion = typeof spoken === 'string' ? spoken : null;
  check(
    'contract version',
    venueVersion === API_VERSION,
    `venue ${venueVersion}, this client ${API_VERSION}`,
  );
  const contract = await get('/contract');
  const digest = (contract.body as { digest?: unknown } | null)?.digest;
  check(
    'contract digest',
    contract.status === 200 && digest === contractDigest(),
    `venue ${String(digest)}, this client ${contractDigest()}`,
  );

  // ---- readiness and metrics (PH-30.1) ---------------------------------------
  const ready = await get('/health/ready');
  check(
    'ready',
    ready.status === 200,
    `GET /health/ready answered ${String(ready.status)}: ${ready.text.slice(0, 120)}`,
  );
  const metrics = await get('/metrics');
  const metricLines = metrics.text.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
  const wellFormed = metricLines.every((l) => /^[a-z_]+(\{[^}]*\})? -?\d+(\.\d+)?$/.test(l));
  check(
    'metrics',
    metrics.status === 200 &&
      wellFormed &&
      metricLines.some((l) => l.startsWith('otc_markets_hosted ')),
    `GET /metrics answered ${String(metrics.status)} with ${String(metricLines.length)} samples${wellFormed ? '' : ', not all well formed'}`,
  );

  // ---- every contracted JSON route, by keys and types -----------------------
  const markets = await get('/markets');
  const views = Array.isArray(markets.body) ? (markets.body as MarketView[]) : [];
  const assets = views.map((m) => m.id);
  const subject = views.find((m) => m.sequence !== null && m.instant !== null) ?? views[0];
  check('a market is hosted', subject !== undefined, `${String(assets.length)} hosted`);
  if (subject === undefined) {
    return { baseUrl: base, clientVersion: API_VERSION, venueVersion, assets, checks, ok: false };
  }
  const id = subject.id;
  const newestInstant = subject.instant ?? 0;
  const instantiate = (route: RouteContract): string | null => {
    let path = route.path.replace(':id', encodeURIComponent(id)).replace(':sequence', '1');
    if (route.query === undefined) return path;
    const params = new URLSearchParams();
    for (const key of Object.keys(route.query)) {
      if (key.endsWith('?')) continue;
      if (key === 'timeframe') params.set(key, '1m');
      else if (key === 'from') params.set(key, String(newestInstant - 3_600_000));
      else if (key === 'to') params.set(key, String(newestInstant + 60_000));
      else if (key === 'at') params.set(key, String(newestInstant));
      else if (key === 'assets') params.set(key, id);
      else return null;
    }
    const query = params.toString();
    path = query === '' ? path : `${path}?${query}`;
    return path;
  };
  for (const route of API_ROUTES) {
    if (route.method !== 'GET' || route.response === undefined) continue;
    const path = instantiate(route);
    if (path === null) {
      check(`GET ${route.path}`, false, 'the client cannot instantiate its query');
      continue;
    }
    const answer = await get(path);
    if (answer.status !== 200) {
      const listed =
        answer.status === 429 ||
        (route.refusals !== undefined && String(answer.status) in route.refusals);
      check(
        `GET ${route.path}`,
        listed,
        listed
          ? `refused ${answer.status}, a refusal the contract lists: ${answer.text.slice(0, 120)}`
          : `answered ${answer.status}, which the contract does not list: ${answer.text.slice(0, 200)}`,
      );
      continue;
    }
    const problems: string[] = [];
    if ('array' in route.response) {
      if (!Array.isArray(answer.body)) problems.push('not an array');
      else {
        for (const [index, item] of (answer.body as unknown[]).entries()) {
          problems.push(...shapeProblems(`[${String(index)}]`, item, route.response.array));
        }
      }
    } else {
      problems.push(...shapeProblems('', answer.body, route.response.object));
    }
    check(
      `GET ${route.path}`,
      problems.length === 0,
      problems.length === 0 ? 'keys and types as contracted' : problems.slice(0, 3).join('; '),
    );
  }

  // ---- the stream: ordered, resumable, honest about gaps --------------------
  const first = await readStream({
    baseUrl: base,
    assetId: id,
    from: 1,
    onGap: 'live',
    ticks: wanted,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    fetch: doFetch,
  });
  let ordered = first.ticks.length > 1;
  for (let i = 1; i < first.ticks.length; i += 1) {
    if (first.ticks[i]!.sequence !== first.ticks[i - 1]!.sequence + 1) ordered = false;
    if (first.ticks[i]!.instant < first.ticks[i - 1]!.instant) ordered = false;
  }
  check(
    'stream delivers contiguous, non-decreasing ticks',
    ordered,
    `${String(first.ticks.length)} ticks read (status ${String(first.status)}${first.refusal === null ? '' : `: ${first.refusal.slice(0, 120)}`})`,
  );
  const last = first.ticks[first.ticks.length - 1];
  if (last !== undefined) {
    const resumed = await readStream({
      baseUrl: base,
      assetId: id,
      from: last.sequence + 1,
      ticks: 5,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      fetch: doFetch,
    });
    // The name says *exactly*, and until Cycle Audit 10 it read five ticks and
    // looked at the first: a venue that answered the right sequence and then
    // dropped one out of the middle of the resumed run passed. A resume is
    // contiguous or it is a hole nobody was told about (INV-002), so the whole
    // run is checked, not its first frame.
    let resumesExactly = resumed.gaps.length === 0 && resumed.ticks.length > 0;
    if (resumed.ticks[0]?.sequence !== last.sequence + 1) resumesExactly = false;
    for (let i = 1; i < resumed.ticks.length; i += 1)
      if (resumed.ticks[i]!.sequence !== resumed.ticks[i - 1]!.sequence + 1) resumesExactly = false;
    check(
      'stream resumes exactly from M+1',
      resumesExactly,
      `asked ${String(last.sequence + 1)}, got [${resumed.ticks
        .slice(0, 8)
        .map((t) => String(t.sequence))
        .join(', ')}], ${String(resumed.gaps.length)} gaps`,
    );
    const tooFar = await readStream({
      baseUrl: base,
      assetId: id,
      from: last.sequence + 1_000_000,
      ticks: 1,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      fetch: doFetch,
    });
    check(
      'stream refuses a sequence never published',
      tooFar.status === 400,
      `status ${String(tooFar.status)}`,
    );
    const told = first.gaps[0];
    check(
      'a gap, when told, names where the record resumes',
      told === undefined ||
        (told.resumesAt !== null && first.ticks[0]?.sequence === told.resumesAt),
      told === undefined
        ? 'no gap told: the whole record was replayed from 1'
        : `gap resumesAt ${String(told.resumesAt)}, first tick ${String(first.ticks[0]?.sequence)}`,
    );

    // ---- the price rule over what the stream delivered ----------------------
    const start = first.ticks[0]!.instant;
    const span = last.instant - start;
    let priceOk = 0;
    let priceChecked = 0;
    let priceDetail = '';
    for (let i = 0; i <= 100 && priceDetail === ''; i += 1) {
      const at = start + Math.floor((span * i) / 100);
      const expected = lastAtOrBefore(first.ticks, at)!;
      const answer = await get(`/markets/${encodeURIComponent(id)}/price?at=${String(at)}`);
      priceChecked += 1;
      const body = answer.body as { sequence?: unknown; price?: unknown; rule?: unknown } | null;
      if (
        answer.status === 200 &&
        body?.sequence === expected.sequence &&
        body.price === expected.price &&
        body.rule === 'last-tick-at-or-before'
      ) {
        priceOk += 1;
      } else {
        priceDetail = `at ${String(at)} expected sequence ${String(expected.sequence)}, got ${answer.status} ${answer.text.slice(0, 160)}`;
      }
    }
    check(
      'price at an instant is the last tick at or before it',
      priceOk === priceChecked && priceChecked > 0,
      priceDetail === '' ? `${String(priceOk)} instants agree` : priceDetail,
    );
    const future = await get(
      `/markets/${encodeURIComponent(id)}/price?at=${String(last.instant + 86_400_000)}`,
    );
    check(
      'price refuses an instant after the newest published',
      future.status === 400,
      `status ${String(future.status)}`,
    );

    // ---- the market's price is one the record already carries --------------
    //
    // **Cycle Audit 10 (a1-03).** A venue draws the next tick before its
    // instant falls due and holds it. Served inside `/markets/:id`'s own
    // `price`, `sequence` and `instant`, that tick is the next price of the
    // market with nothing in the response to give it away — no extra key, no
    // cursor, no shape to check — and this checklist passed unchanged against
    // a venue doing exactly that.
    //
    // Replay does not separate them: a pending tick's sequence is the newest
    // published plus one, which is a resume point every feed accepts, and the
    // tick it then delivers is that same tick. The *record* does separate
    // them. `/price?at=` is answered from what has been published, and refuses
    // an instant past the newest — so a market quoting a price its own record
    // cannot produce at its own instant is quoting one it has not published.
    //
    // Several rounds, because a tick that was pending when the market answered
    // may be published a moment later, and one round could be lucky.
    const ROUNDS = 5;
    let carried = 0;
    let carriedDetail = '';
    for (let round = 0; round < ROUNDS && carriedDetail === ''; round += 1) {
      const reported = await get(`/markets/${encodeURIComponent(id)}`);
      const body = reported.body as {
        sequence?: unknown;
        instant?: unknown;
        price?: unknown;
      } | null;
      if (
        reported.status !== 200 ||
        typeof body?.sequence !== 'number' ||
        typeof body.instant !== 'number'
      ) {
        carriedDetail = `GET /markets/${id} answered ${String(reported.status)} without a tick`;
        break;
      }
      const atMarket = await get(
        `/markets/${encodeURIComponent(id)}/price?at=${String(body.instant)}`,
      );
      const priced = atMarket.body as { sequence?: unknown; price?: unknown } | null;
      if (
        atMarket.status === 200 &&
        priced?.sequence === body.sequence &&
        priced.price === body.price
      ) {
        carried += 1;
      } else {
        carriedDetail =
          `the market reported sequence ${String(body.sequence)} at instant ` +
          `${String(body.instant)}, and the record answered ${String(atMarket.status)} ` +
          `${atMarket.text.slice(0, 160)}`;
      }
    }
    check(
      'the price the market reports is one the record already carries',
      carried === ROUNDS,
      carriedDetail === '' ? `${String(carried)} rounds agree` : carriedDetail,
    );

    // ---- a proof, when the venue publishes ----------------------------------
    const proof = await get(
      `/markets/${encodeURIComponent(id)}/proof/${String(first.ticks[0]!.sequence)}`,
    );
    if (proof.status === 404) {
      check(
        'proof',
        true,
        `the venue does not publish commitments (404): ${proof.text.slice(0, 120)}`,
      );
    } else if (proof.status === 409) {
      check('proof', true, `not yet committed (409): ${proof.text.slice(0, 120)}`);
    } else if (proof.status === 200) {
      const body = proof.body as {
        publisherPublicKey: string | null;
        commitment: SignedCommitment;
        proof: InclusionProof;
      };
      const signed =
        body.publisherPublicKey !== null &&
        verifyCommitment(body.commitment, body.publisherPublicKey);
      const included = verifyInclusion(body.commitment.commitment, body.proof);
      const agrees =
        body.proof.sequence === first.ticks[0]!.sequence &&
        body.proof.price === first.ticks[0]!.price &&
        body.proof.instant === first.ticks[0]!.instant;
      check(
        'proof verifies against the publisher key and agrees with the stream',
        signed && included && agrees,
        `signature ${String(signed)}, inclusion ${String(included)}, agrees with the stream ${String(agrees)}`,
      );
    } else {
      check('proof', false, `answered ${proof.status}: ${proof.text.slice(0, 160)}`);
    }
  }

  return {
    baseUrl: base,
    clientVersion: API_VERSION,
    venueVersion,
    assets,
    checks,
    ok: checks.every((c) => c.ok),
  };
}

/** The report as Markdown, for `npm run conformance -- --out`. */
export function renderConformance(report: ConformanceReport): string {
  const lines = [
    `# Conformance — ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    `Venue: \`${report.baseUrl}\` (contract ${String(report.venueVersion)}; this client ${report.clientVersion})`,
    `Assets hosted: ${String(report.assets.length)}`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...report.checks.map(
      (c) => `| ${c.name} | ${c.ok ? 'pass' : '**fail**'} | ${c.detail.replace(/\|/g, '\\|')} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
