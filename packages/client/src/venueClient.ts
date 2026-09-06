import type { Tick } from '@otc/core';
import {
  verifyCommitment,
  verifyInclusion,
  type InclusionProof,
  type SignedCommitment,
} from '@otc/distribution';
import { API_ROUTES, API_VERSION, type RouteContract, type Shape } from './contract.js';
import { shapeProblems } from './shape.js';
import { streamFrames, type GapFrame } from './sse.js';

/**
 * The reference client (PH-29.4): the venue's public surface as one class
 * over `fetch`, every answer checked against the contract before it is
 * returned, the stream resumed exactly across a dropped connection.
 *
 * A broker's engineer writes this once, usually wrong in one of three places:
 * a resume that skips or repeats a tick, a gap filled by silence, a price read
 * from a copy of the stream rather than from the record. This is the one to
 * embed instead, and `conformance()` is written with it.
 */
export class ContractViolation extends Error {
  constructor(
    readonly route: string,
    readonly problems: readonly string[],
  ) {
    super(`${route} departed from contract ${API_VERSION}: ${problems.join('; ')}`);
    this.name = 'ContractViolation';
  }
}

/** A refusal the contract lists, carried as a value rather than thrown. */
export interface Refusal {
  readonly status: number;
  readonly message: string;
}

export interface Published {
  readonly sequence: number;
  readonly instant: number;
  readonly price: number;
  readonly displayPrice: string;
}

export interface PriceInForce extends Published {
  readonly assetId: string;
  readonly at: number;
  readonly rule: string;
}

export interface VerifiedProof {
  readonly assetId: string;
  readonly sequence: number;
  readonly publisherPublicKey: string;
  readonly commitment: SignedCommitment;
  readonly proof: InclusionProof;
  /** Both checks passed: the signature under the key, the tick under the root. */
  readonly verified: true;
}

export interface Market {
  readonly id: string;
  readonly displayName: string;
  readonly family: string;
  readonly price: number | null;
  readonly displayPrice: string | null;
  readonly sequence: number | null;
  readonly instant: number | null;
  readonly recovery: unknown;
}

export type StreamEvent =
  | { readonly kind: 'tick'; readonly tick: Tick }
  | { readonly kind: 'gap'; readonly gap: GapFrame }
  | { readonly kind: 'reconnected'; readonly from: number };

export interface SubscribeOptions {
  readonly from?: number;
  /** Told a gap rather than refused; the default, because a client that is refused learns nothing. */
  readonly onGap?: 'live' | 'refuse';
  readonly signal?: AbortSignal;
  /** Reconnect attempts after a dropped connection before giving up. */
  readonly reconnects?: number;
}

export interface VenueClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** The publisher's key, told out of band; a proof is verified against it when given. */
  readonly publisherPublicKey?: string;
}

const routeByPath = new Map(API_ROUTES.map((r) => [`${r.method} ${r.path}`, r]));

function shapeOf(route: RouteContract): { object?: Shape; array?: Shape } {
  if (route.response === undefined) return {};
  return 'array' in route.response
    ? { array: route.response.array }
    : { object: route.response.object };
}

export class VenueClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #publisherKey: string | null;

  constructor(options: VenueClientOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? fetch;
    this.#publisherKey = options.publisherPublicKey ?? null;
  }

  get baseUrl(): string {
    return this.#base;
  }

  async health(): Promise<{
    status: string;
    assets: number;
    apiVersion: string;
    stalled: unknown[];
  }> {
    return (await this.#get('GET /health', '/health')) as {
      status: string;
      assets: number;
      apiVersion: string;
      stalled: unknown[];
    };
  }

  async markets(): Promise<Market[]> {
    return (await this.#get('GET /markets', '/markets')) as Market[];
  }

  async market(id: string): Promise<Market | Refusal> {
    return (await this.#getOrRefusal('GET /markets/:id', `/markets/${encodeURIComponent(id)}`)) as
      Market | Refusal;
  }

  async catalogue(): Promise<Record<string, unknown>[]> {
    return (await this.#get('GET /catalogue', '/catalogue')) as Record<string, unknown>[];
  }

  async history(
    id: string,
    timeframe: string,
    from: number,
    to: number,
  ): Promise<
    { assetId: string; timeframe: string; from: number; to: number; candles: unknown[] } | Refusal
  > {
    const query = `timeframe=${encodeURIComponent(timeframe)}&from=${String(from)}&to=${String(to)}`;
    return (await this.#getOrRefusal(
      'GET /markets/:id/history',
      `/markets/${encodeURIComponent(id)}/history?${query}`,
    )) as
      | { assetId: string; timeframe: string; from: number; to: number; candles: unknown[] }
      | Refusal;
  }

  /** The recorded tick at a sequence, or the refusal naming the record's bounds. */
  async tick(id: string, sequence: number): Promise<(Published & { assetId: string }) | Refusal> {
    return (await this.#getOrRefusal(
      'GET /markets/:id/ticks/:sequence',
      `/markets/${encodeURIComponent(id)}/ticks/${String(sequence)}`,
    )) as (Published & { assetId: string }) | Refusal;
  }

  /** The price in force at an instant — the last tick at or before it — or the refusal. */
  async priceAt(id: string, at: number): Promise<PriceInForce | Refusal> {
    return (await this.#getOrRefusal(
      'GET /markets/:id/price',
      `/markets/${encodeURIComponent(id)}/price?at=${String(at)}`,
    )) as PriceInForce | Refusal;
  }

  /**
   * The proof of a published sequence, verified: the commitment's signature
   * under the publisher's key (the one this client was told, else the one the
   * venue names) and the tick under the commitment's root. A proof that does
   * not verify is a `ContractViolation`; a refusal (not yet committed, not
   * publishing) is returned as one.
   */
  async proof(id: string, sequence: number): Promise<VerifiedProof | Refusal> {
    const answer = await this.#getOrRefusal(
      'GET /markets/:id/proof/:sequence',
      `/markets/${encodeURIComponent(id)}/proof/${String(sequence)}`,
    );
    if (isRefusal(answer)) return answer;
    const body = answer as {
      assetId: string;
      sequence: number;
      publisherPublicKey: string | null;
      commitment: SignedCommitment;
      proof: InclusionProof;
    };
    const key = this.#publisherKey ?? body.publisherPublicKey;
    const problems: string[] = [];
    if (key === null) problems.push('no publisher key to verify against');
    else if (!verifyCommitment(body.commitment, key))
      problems.push('the commitment is not signed by the publisher key');
    if (this.#publisherKey !== null && body.publisherPublicKey !== this.#publisherKey) {
      problems.push('the venue names another publisher key than the one this client was told');
    }
    if (!verifyInclusion(body.commitment.commitment, body.proof))
      problems.push('the tick is not under the commitment root');
    if (body.proof.sequence !== sequence)
      problems.push(`the proof is for sequence ${String(body.proof.sequence)}`);
    if (problems.length > 0)
      throw new ContractViolation('GET /markets/:id/proof/:sequence', problems);
    return {
      assetId: body.assetId,
      sequence: body.sequence,
      publisherPublicKey: key!,
      commitment: body.commitment,
      proof: body.proof,
      verified: true,
    };
  }

  /**
   * Every tick of a market in order, from `from` (default: the live edge),
   * across dropped connections: after a drop the stream is reopened from the
   * last delivered sequence plus one, so nothing is repeated and nothing is
   * skipped; a gap the venue tells is yielded as an event and the ticks that
   * follow come from `resumesAt`. The iterator ends when the caller aborts,
   * when the venue closes the stream with a reason, or when the reconnect
   * budget is spent.
   */
  async *subscribe(
    id: string,
    options: SubscribeOptions = {},
  ): AsyncGenerator<StreamEvent, string, void> {
    let from = options.from;
    let budget = options.reconnects ?? 5;
    let delivered: number | null = null;
    for (;;) {
      if (options.signal?.aborted) return 'aborted';
      let closed: string | null = null;
      for await (const frame of streamFrames({
        baseUrl: this.#base,
        assetId: id,
        ...(from === undefined ? {} : { from }),
        ...(options.onGap === 'refuse' ? {} : { onGap: 'live' as const }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        fetch: this.#fetch,
      })) {
        if (frame.kind === 'open') {
          if (frame.status !== 200) {
            throw new ContractViolation('GET /markets/:id/stream', [
              `refused ${String(frame.status)}: ${frame.refusal ?? ''}`,
            ]);
          }
        } else if (frame.kind === 'gap') {
          yield { kind: 'gap', gap: frame.gap };
        } else if (frame.kind === 'close') {
          closed = frame.reason;
        } else {
          // A repeat after a resume is never yielded twice; a skip is a hole
          // the venue did not tell, and the contract forbids it.
          if (delivered !== null && frame.tick.sequence <= delivered) continue;
          if (delivered !== null && frame.tick.sequence !== delivered + 1) {
            throw new ContractViolation('GET /markets/:id/stream', [
              `sequence ${String(frame.tick.sequence)} after ${String(delivered)} with no gap told`,
            ]);
          }
          delivered = frame.tick.sequence;
          yield { kind: 'tick', tick: frame.tick };
        }
      }
      if (options.signal?.aborted) return 'aborted';
      if (closed !== null) return closed;
      // The connection dropped without a close frame: resume exactly.
      if (budget === 0) return 'reconnect budget spent';
      budget -= 1;
      from = delivered === null ? from : delivered + 1;
      yield { kind: 'reconnected', from: from ?? 0 };
    }
  }

  async #get(key: string, path: string): Promise<unknown> {
    const answer = await this.#getOrRefusal(key, path);
    if (isRefusal(answer))
      throw new ContractViolation(key, [`refused ${String(answer.status)}: ${answer.message}`]);
    return answer;
  }

  async #getOrRefusal(key: string, path: string): Promise<unknown> {
    const route = routeByPath.get(key);
    if (route === undefined) throw new Error(`${key} is not a contracted route.`);
    const response = await this.#fetch(`${this.#base}${path}`, {
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (response.status !== 200) {
      const listed = route.refusals !== undefined && String(response.status) in route.refusals;
      if (!listed)
        throw new ContractViolation(key, [
          `answered ${String(response.status)}, which the contract does not list: ${text.slice(0, 200)}`,
        ]);
      const message = (body as { message?: unknown } | null)?.message;
      return {
        status: response.status,
        message: typeof message === 'string' ? message : text,
      } satisfies Refusal;
    }
    const shape = shapeOf(route);
    const problems: string[] = [];
    if (shape.array !== undefined) {
      if (!Array.isArray(body)) problems.push('not an array');
      else
        for (const [i, item] of (body as unknown[]).entries())
          problems.push(...shapeProblems(`[${String(i)}]`, item, shape.array));
    } else if (shape.object !== undefined) {
      problems.push(...shapeProblems('', body, shape.object));
    }
    if (problems.length > 0) throw new ContractViolation(key, problems);
    return body;
  }
}

export function isRefusal(value: unknown): value is Refusal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number' &&
    'message' in value &&
    Object.keys(value).length === 2
  );
}
