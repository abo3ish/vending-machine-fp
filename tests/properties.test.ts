// Instead of hand-picking scenarios, throw thousands of random event sequences at the machine
// (including nonsense: coins while dispensing, hardware signals out of nowhere) and check rules that must always hold.
// This is cheap only because step() is pure: no mocks, no setup, no teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { COINS, add, makeChange, noCoins, run, total, value, type Coin, type CoinCounts, type Event, type Machine } from '../src/machine.ts';

const coin = fc.constantFrom(...COINS);
const counts = fc.record({ 5: fc.nat(6), 10: fc.nat(6), 25: fc.nat(6), 100: fc.nat(6) });

const event: fc.Arbitrary<Event> = fc.oneof(
  { weight: 3, arbitrary: coin.map((c) => ({ tag: 'insert', coin: c }) as const) },
  { weight: 2, arbitrary: fc.constantFrom('A1', 'A2', 'B1', 'Z9').map((slot) => ({ tag: 'select', slot }) as const) },
  { weight: 2, arbitrary: fc.constant<Event>({ tag: 'buy' }) },
  { weight: 1, arbitrary: fc.constantFrom<Event>({ tag: 'cancel' }, { tag: 'dispensed' }, { tag: 'jammed' }) },
);

const machine: fc.Arbitrary<Machine> = fc.record({
  phase: fc.constant({ tag: 'idle' } as const),
  slots: fc.record({
    A1: fc.record({ product: fc.constant('Cola'), price: fc.integer({ min: 1, max: 40 }).map((n) => n * 5), qty: fc.nat(3) }),
    A2: fc.record({ product: fc.constant('Water'), price: fc.integer({ min: 1, max: 40 }).map((n) => n * 5), qty: fc.nat(3) }),
    B1: fc.record({ product: fc.constant('Chips'), price: fc.integer({ min: 1, max: 40 }).map((n) => n * 5), qty: fc.nat(3) }),
  }),
  box: counts,
});

const scenario = fc.tuple(machine, fc.array(event, { maxLength: 60 }));

const returned = (trace: ReturnType<typeof run>): Coin[] =>
  trace.flatMap((t) => t.effects.flatMap((e) => (e.tag === 'returnCoins' ? e.coins : [])));
const escrow = (m: Machine): readonly Coin[] => (m.phase.tag === 'idle' ? [] : m.phase.inserted);
const sold = (start: Machine, end: Machine) =>
  Object.entries(start.slots).reduce((sum, [id, s]) => sum + (s.qty - end.slots[id]!.qty) * s.price, 0);

test('no coin is created or lost: box + inserted = box + returned + escrow, per denomination', () => {
  fc.assert(fc.property(scenario, ([start, events]) => {
    const trace = run(start, events);
    const end = trace.at(-1)?.after ?? start;
    const inserted = events.flatMap((e) => (e.tag === 'insert' ? [e.coin] : []));
    assert.deepEqual(add(start.box, inserted), add(add(end.box, returned(trace)), escrow(end)));
  }), { numRuns: 2000 });
});

test('the box grows by exactly the price of what was sold', () => {
  fc.assert(fc.property(scenario, ([start, events]) => {
    const end = run(start, events).at(-1)?.after ?? start;
    assert.equal(value(end.box) - value(start.box), sold(start, end));
  }), { numRuns: 2000 });
});

test('stock and coin counts never go negative', () => {
  fc.assert(fc.property(scenario, ([start, events]) => {
    for (const { after } of run(start, events)) {
      for (const s of Object.values(after.slots)) assert.ok(s.qty >= 0);
      for (const c of COINS) assert.ok(after.box[c] >= 0);
    }
  }), { numRuns: 2000 });
});

test('nothing is dispensed unless it is in stock and fully paid', () => {
  fc.assert(fc.property(scenario, ([start, events]) => {
    for (const { before, event, effects } of run(start, events)) {
      for (const e of effects) {
        if (e.tag !== 'dispense') continue;
        const slot = before.slots[e.slot]!;
        assert.ok(slot.qty > 0);
        assert.ok(before.phase.tag === 'paying' && event.tag === 'buy');
        assert.ok(total(before.phase.inserted) >= slot.price);
      }
    }
  }), { numRuns: 2000 });
});

test('replaying the same events gives the same history', () => {
  fc.assert(fc.property(scenario, ([start, events]) => {
    assert.deepEqual(run(start, events), run(start, events));
  }), { numRuns: 300 });
});

// makeChange against brute force: it must find change whenever any combination exists.
test('makeChange finds change exactly when change is possible', () => {
  const possible = (amount: number, c: CoinCounts): boolean => {
    for (let a = 0; a <= c[100]; a++) for (let b = 0; b <= c[25]; b++) for (let d = 0; d <= c[10]; d++) {
      const left = amount - 100 * a - 25 * b - 10 * d;
      if (left >= 0 && left % 5 === 0 && left / 5 <= c[5]) return true;
    }
    return false;
  };
  fc.assert(fc.property(fc.integer({ min: 0, max: 60 }).map((n) => n * 5), counts, (amount, c) => {
    const change = makeChange(amount, c);
    assert.equal(change !== null, possible(amount, c));
    if (change) {
      assert.equal(total(change), amount);
      for (const k of COINS) assert.ok(add(noCoins, change)[k] <= c[k]);
    }
  }), { numRuns: 2000 });
});
