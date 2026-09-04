/**
 * The panel's poll, reduced to the two questions `setInterval` cannot answer.
 *
 * **Cycle Audit 8 (a4).** The Lab screen refreshes once a second, and each
 * refresh is a state read followed by six more. Nothing counted them. A tick
 * fired whether or not the previous one had come back, so an outage did not
 * pause the poll — it queued it, seven requests a second for as long as the
 * Lab took to answer, all resolving at once when it did. And every one of them
 * called `setState` unconditionally: two refreshes of the *same* market landed
 * in whatever order the network gave them, so the strip could go backwards
 * while the market went forwards. The screen's asset check caught only a
 * change of market, which is the one case where the two answers are visibly
 * different.
 *
 * So a refresh takes a ticket. It may write to the screen only while its
 * ticket is the newest one issued — an answer overtaken by a later request is
 * discarded rather than rendered — and a tick that finds a refresh still out
 * is skipped rather than stacked on top of it.
 *
 * Kept out of the screen so the ordering can be tested for what it is: React
 * refs are only reachable through a rendered component, and this rule is about
 * interleaving, not about rendering.
 */
export interface PollGate {
  /** Take a ticket for a refresh about to start. */
  begin(): number;
  /** Whether this ticket is still the newest issued: an older answer is dropped. */
  isCurrent(ticket: number): boolean;
  /** Give a ticket back — answered, refused or timed out, it is no longer out. */
  end(ticket: number): void;
  /** Whether any refresh is still out. */
  busy(): boolean;
}

export function createPollGate(): PollGate {
  let issued = 0;
  /**
   * The tickets still out, by number rather than as a count: `end` is called
   * from a `finally` that a re-entrant refresh could reach twice, and a count
   * would then go negative and report an idle poll as busy forever.
   */
  const out = new Set<number>();
  return {
    begin: (): number => {
      issued += 1;
      out.add(issued);
      return issued;
    },
    isCurrent: (ticket: number): boolean => ticket === issued,
    end: (ticket: number): void => {
      out.delete(ticket);
    },
    busy: (): boolean => out.size > 0,
  };
}
