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
 * JSON route answers with exactly the contracted keys and types, the record
 * answers the same ticks it streamed, the stream resumes exactly and tells a
 * gap rather than skipping it, the price route answers by the rule over the
 * ticks the stream delivered, and a proof for a committed sequence verifies
 * against the publisher's key — the one told to the run, when it was told
 * one. Pure over `fetch`, so a test can point it at a spawned venue and a
 * broker at its deployment.
 *
 * **What a PASS is worth** (Cycle Audit 10, a4-03/a4-04). Two of its checks
 * used to be weaker than their names: the proof was verified against the key
 * the venue shipped with it, and the routes were read for keys and types
 * while their content went uncompared. Both are why
 * {@link ConformanceOptions.publisherPublicKey} exists and why the record is
 * now asked whether it agrees with its own stream.
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
  /**
   * Whether a publisher key was told to this run (Cycle Audit 10, a4-03).
   *
   * `false` means the proof check could only verify the signature against the
   * key the venue shipped beside it, and a PASS says nothing about who signed
   * the window. The rendered report states it above the table, because it is
   * the difference between a proof and a claim.
   */
  readonly publisherKeyPinned: boolean;
}

export interface ConformanceOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** Ticks to read from the stream for the resume and price checks. */
  readonly ticks?: number;
  readonly signal?: AbortSignal;
  /**
   * The publisher's key, **told out of band** — the operator's
   * `publisher.json`, an announcement, a key file the broker was handed.
   *
   * **Cycle Audit 10, a4-03.** Without it this suite verified a proof's
   * signature against the key carried in the same response, and reported that
   * as "verifies against the publisher key". A venue signing with any key of
   * its own and naming that key passed: an auditor built exactly that and got
   * `ok: true`. Told the key, the check is worth its name; not told, it is
   * still run — an internally consistent proof is better than none — but it
   * is named and rendered as self-certified, and never as verified against
   * the publisher.
   */
  readonly publisherPublicKey?: string;
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
  const pinnedKey = options.publisherPublicKey ?? null;
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
      publisherKeyPinned: pinnedKey !== null,
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
    return {
      baseUrl: base,
      clientVersion: API_VERSION,
      venueVersion,
      assets,
      checks,
      ok: false,
      publisherKeyPinned: pinnedKey !== null,
    };
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

    // ---- the record answers the same ticks it streamed ---------------------
    //
    // **Cycle Audit 10 (a4-04).** Every route above was read for its keys and
    // its types and nothing else, so a venue answering `/ticks/1` with
    // sequence 1 and another tick's instant and price passed this checklist —
    // a stale replica, a cache keyed wrongly, a proxy stitching two
    // deployments together. Content, not shape: the stream just said what
    // those ticks are, and the record is asked whether it agrees (INV-002,
    // INV-003).
    //
    // Sampled from the **newest** end, plus the oldest tick delivered. A
    // record evicts from the oldest end, and a venue at its retention edge
    // evicts while this suite runs — so a `404` on the oldest sample is
    // reported rather than failed, and everything else is held to the
    // content the stream just gave.
    const oldest = first.ticks[0]!;
    const sampled = [oldest, first.ticks[first.ticks.length - 2] ?? last, last].filter(
      (tick, index, all) => all.findIndex((t) => t.sequence === tick.sequence) === index,
    );
    let sameDetail = '';
    let evicted = '';
    for (const tick of sampled) {
      if (sameDetail !== '') break;
      const answer = await get(`/markets/${encodeURIComponent(id)}/ticks/${String(tick.sequence)}`);
      const body = answer.body as {
        sequence?: unknown;
        instant?: unknown;
        price?: unknown;
      } | null;
      if (answer.status === 404 && tick.sequence === oldest.sequence) {
        evicted = `; sequence ${String(tick.sequence)} left the record between the stream and this read`;
        continue;
      }
      if (
        answer.status !== 200 ||
        body?.sequence !== tick.sequence ||
        body.instant !== tick.instant ||
        body.price !== tick.price
      ) {
        sameDetail =
          `the stream delivered sequence ${String(tick.sequence)} at ${String(tick.instant)} ` +
          `price ${String(tick.price)}; /ticks/${String(tick.sequence)} answered ` +
          `${String(answer.status)} ${answer.text.slice(0, 160)}`;
      }
    }
    check(
      'the record answers the ticks the stream delivered',
      sameDetail === '',
      sameDetail === '' ? `${String(sampled.length)} sampled ticks agree${evicted}` : sameDetail,
    );

    // ---- and the market is not behind its own stream -----------------------
    //
    // The other half of a4-04: `/markets/:id` was read for shape only, so a
    // replica reporting a tick from ten minutes ago as the market's current
    // price passed. That tick is in the record, so the round-trip through
    // `/price` below cannot see it; only the stream can, and it has just said
    // how far the record reaches.
    const head = await get(`/markets/${encodeURIComponent(id)}`);
    const headBody = head.body as { sequence?: unknown } | null;
    check(
      'the market is not behind the ticks it streamed',
      head.status === 200 &&
        typeof headBody?.sequence === 'number' &&
        headBody.sequence >= last.sequence,
      `the market reports sequence ${String(headBody?.sequence)}, the stream delivered through ` +
        `${String(last.sequence)}`,
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
      // **Which key** (Cycle Audit 10, a4-03). Told one, the signature is
      // evidence: only its holder could have signed this window. Not told
      // one, the only key here came from the same response as the signature,
      // and a venue that signs with a key of its own and names that key
      // passes every cryptographic step. That run still reports — an
      // internally consistent proof is worth more than none — under a name
      // that says what it checked.
      const key = pinnedKey ?? body.publisherPublicKey;
      const signed = key !== null && verifyCommitment(body.commitment, key);
      const names = pinnedKey === null || body.publisherPublicKey === pinnedKey;
      const included = verifyInclusion(body.commitment.commitment, body.proof);
      const agrees =
        body.proof.sequence === first.ticks[0]!.sequence &&
        body.proof.price === first.ticks[0]!.price &&
        body.proof.instant === first.ticks[0]!.instant;
      check(
        pinnedKey === null
          ? 'proof verifies against the key the venue names (not independent) and agrees with the stream'
          : 'proof verifies against the publisher key and agrees with the stream',
        signed && names && included && agrees,
        `signature ${String(signed)}, inclusion ${String(included)}, agrees with the stream ` +
          `${String(agrees)}` +
          (pinnedKey === null
            ? ', against the key the venue names — pass the publisher key to check it independently'
            : `, names the key it was signed with ${String(names)}`),
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
    publisherKeyPinned: pinnedKey !== null,
  };
}

/** The report as Markdown, for `npm run conformance -- --out`. */
export function renderConformance(report: ConformanceReport): string {
  const lines = [
    `# Conformance — ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    `Venue: \`${report.baseUrl}\` (contract ${String(report.venueVersion)}; this client ${report.clientVersion})`,
    `Assets hosted: ${String(report.assets.length)}`,
    report.publisherKeyPinned
      ? 'Publisher key: told to this run, so a served proof was checked against it.'
      : 'Publisher key: **not told to this run**. A served proof was checked against the key ' +
        'the venue named beside it, which proves nothing about who published the tick. Run ' +
        'again with the key you were told out of band (`--key`).',
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
