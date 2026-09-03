/**
 * The Lab's session record: two streams, and they are separate by construction.
 *
 * §72–§73 of the specification require natural engine behaviour and Lab actions
 * to be shown separately and **never mixed**. That is not a display preference.
 * A timeline that blended them would make a Lab session unreadable as evidence
 * about the engine: an operator, or an auditor six months later, could not tell
 * which regime change the market produced and which one somebody asked for.
 *
 * So they are two arrays with two element types, not one array with a `source`
 * field. A field can be set wrong; a type cannot be, and `labSession.test.ts`
 * asserts an action cannot reach the engine stream.
 */

/** Something the engine did, unasked. */
export interface EngineEvent {
  readonly at: number;
  readonly asset: string;
  readonly kind: 'regime' | 'volatility' | 'stall' | 'recovery' | 'seam';
  readonly detail: string;
}

/**
 * Something an operator asked for.
 *
 * The fields are §78's list, and they are required rather than optional because
 * a record missing its initial state is not auditable — which is the whole
 * reason §78 enumerates them.
 */
export interface LabAction {
  readonly at: number;
  readonly asset: string;
  readonly engineVersion: string;
  readonly action: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly initialState: Readonly<Record<string, unknown>>;
  readonly resultingState: Readonly<Record<string, unknown>>;
  readonly succeeded: boolean;
  /**
   * What the run measured, including — for anything selected — the acceptance
   * rate. An intervention that reports what it asked for without reporting how
   * rare that was is the shape of dishonesty this Lab is built to avoid.
   */
  readonly diagnostics: Readonly<Record<string, unknown>>;
}

/**
 * Where a session's lines go as they are recorded, and where they come from at
 * boot. One line per record, JSON, a `stream` field telling the two apart **in
 * the file only** — the class keeps its two arrays, and a reader that merges
 * them has chosen to (PH-24.8 §2).
 */
export interface SessionSink {
  append(line: string): void;
}

export class LabSession {
  readonly #events: EngineEvent[] = [];
  readonly #actions: LabAction[] = [];
  #sink: SessionSink | null = null;

  /**
   * Persist from here on, after loading what a previous process left.
   *
   * A record that is not there in the morning is not an audit record (§78): a
   * restart used to empty the session. Lines that do not parse are skipped and
   * counted rather than failing the boot — a half-written last line is what a
   * crash leaves, and the session before it is still evidence.
   */
  persistTo(existing: readonly string[], sink: SessionSink): { loaded: number; skipped: number } {
    let loaded = 0;
    let skipped = 0;
    for (const line of existing) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as { stream?: string } & Record<string, unknown>;
        if (parsed.stream === 'engine') {
          const { stream: _s, ...event } = parsed;
          this.#events.push(event as unknown as EngineEvent);
          loaded += 1;
        } else if (parsed.stream === 'lab') {
          const { stream: _s, ...action } = parsed;
          this.#actions.push(action as unknown as LabAction);
          loaded += 1;
        } else if (parsed.stream !== 'meta') {
          // A `meta` line is the export's header; anything else is not a record.
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    this.#sink = sink;
    return { loaded, skipped };
  }

  /** What the engine did. Only the engine's own behaviour reaches here. */
  recordEvent(event: EngineEvent): void {
    this.#events.push(event);
    this.#sink?.append(JSON.stringify({ stream: 'engine', ...event }));
  }

  /** What an operator asked for. */
  recordAction(action: LabAction): void {
    this.#actions.push(action);
    this.#sink?.append(JSON.stringify({ stream: 'lab', ...action }));
  }

  /** The session as its file would read: one JSON line per record, oldest first, per stream. */
  toLines(): string[] {
    return [
      ...this.#events.map((e) => JSON.stringify({ stream: 'engine', ...e })),
      ...this.#actions.map((a) => JSON.stringify({ stream: 'lab', ...a })),
    ];
  }

  get engineEvents(): readonly EngineEvent[] {
    return this.#events;
  }

  get labActions(): readonly LabAction[] {
    return this.#actions;
  }

  /**
   * The session, as two timelines.
   *
   * Deliberately not merged, and deliberately not offered merged. A caller that
   * wants them interleaved can zip them and will have written that decision
   * down; one that gets them interleaved by default never decided anything.
   */
  timelines(): {
    readonly environment: string;
    readonly engine: readonly EngineEvent[];
    readonly lab: readonly LabAction[];
  } {
    return {
      environment: 'OTC LAB — SIMULATION ENVIRONMENT',
      engine: [...this.#events],
      lab: [...this.#actions],
    };
  }
}
