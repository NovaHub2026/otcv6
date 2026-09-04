import { describe, expect, it } from 'vitest';
import { createPollGate } from './poll.js';

/**
 * Cycle Audit 8 (a4): the poll's ordering, as the interleavings that produced
 * the defect.
 */
describe('the poll gate', () => {
  it('lets the newest refresh write, and drops the one it overtook', () => {
    const gate = createPollGate();
    // Two refreshes of the same market, in flight together.
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(second)).toBe(true);
    // The older answer arrives last — the network's order, not the poll's.
    gate.end(second);
    expect(gate.isCurrent(first), 'a refresh overtaken by a later one was allowed to render').toBe(
      false,
    );
  });

  it('reports a refresh still out, so a tick can be skipped rather than stacked', () => {
    const gate = createPollGate();
    expect(gate.busy()).toBe(false);
    const ticket = gate.begin();
    expect(gate.busy(), 'a refresh in flight is not counted').toBe(true);
    gate.end(ticket);
    expect(gate.busy()).toBe(false);
  });

  it('is idle only when every refresh has come back', () => {
    const gate = createPollGate();
    const first = gate.begin();
    const second = gate.begin();
    gate.end(first);
    expect(gate.busy(), 'the poll read as idle with a refresh still out').toBe(true);
    gate.end(second);
    expect(gate.busy()).toBe(false);
  });

  it('survives a ticket handed back twice', () => {
    // `end` is called from a `finally`; a count would go negative here and the
    // poll would report itself busy for the rest of the session.
    const gate = createPollGate();
    const ticket = gate.begin();
    gate.end(ticket);
    gate.end(ticket);
    expect(gate.busy()).toBe(false);
    const next = gate.begin();
    expect(gate.busy()).toBe(true);
    expect(gate.isCurrent(next)).toBe(true);
  });
});
