import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChange, run, step, type CoinCounts, type Event, type Machine } from '../src/machine.ts';

const box: CoinCounts = { 5: 4, 10: 4, 25: 4, 100: 0 };
const machine: Machine = {
  phase: { tag: 'idle' },
  slots: { A1: { product: 'Cola', price: 65, qty: 1 }, A2: { product: 'Candy', price: 50, qty: 0 } },
  box,
};

const last = (start: Machine, events: Event[]) => run(start, events).at(-1)!;

test('buying with change: stock and box change only once the product is out', () => {
  const ready = last(machine, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 100 }]);
  assert.deepEqual(ready.effects, [{ tag: 'display', text: 'Press BUY, change $0.35' }], 'paying enough does not dispense by itself');

  const [, early] = step(last(machine, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 25 }]).after, { tag: 'buy' });
  assert.deepEqual(early, [{ tag: 'display', text: 'Insert $0.40 more' }]);

  const paid = last(machine, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 100 }, { tag: 'buy' }]);
  assert.deepEqual(paid.effects, [{ tag: 'dispense', slot: 'A1' }, { tag: 'display', text: 'Dispensing...' }]);
  assert.equal(paid.after.slots.A1!.qty, 1, 'not committed yet');
  assert.deepEqual(paid.after.box, box);

  const [done, effects] = step(paid.after, { tag: 'dispensed' });
  assert.deepEqual(effects[0], { tag: 'returnCoins', coins: [25, 10] });
  assert.equal(done.slots.A1!.qty, 0);
  assert.deepEqual(done.box, { 5: 4, 10: 3, 25: 3, 100: 1 });
  assert.deepEqual(done.phase, { tag: 'idle' });
});

test('a jam refunds the exact coins and commits nothing', () => {
  const t = last(machine, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 25 }, { tag: 'insert', coin: 100 }, { tag: 'buy' }, { tag: 'jammed' }]);
  assert.deepEqual(t.effects[0], { tag: 'returnCoins', coins: [25, 100] });
  assert.deepEqual(t.after, machine);
});

test('exact change only: refuses the sale instead of shortchanging', () => {
  const broke = { ...machine, box: { 5: 0, 10: 0, 25: 0, 100: 0 } };
  const t = last(broke, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 100 }, { tag: 'buy' }]);
  assert.deepEqual(t.effects, [{ tag: 'returnCoins', coins: [100] }, { tag: 'display', text: 'Exact change only' }]);
  assert.deepEqual(t.after, broke);
});

test('cancel returns what was inserted', () => {
  const t = last(machine, [{ tag: 'select', slot: 'A1' }, { tag: 'insert', coin: 25 }, { tag: 'insert', coin: 10 }, { tag: 'cancel' }]);
  assert.deepEqual(t.effects[0], { tag: 'returnCoins', coins: [25, 10] });
  assert.deepEqual(t.after.phase, { tag: 'idle' });
});

test('sold out and unknown slots stay idle', () => {
  assert.equal(step(machine, { tag: 'select', slot: 'A2' })[0], machine);
  assert.equal(step(machine, { tag: 'select', slot: 'Z9' })[0], machine);
});

test('coins outside a sale are handed straight back', () => {
  assert.deepEqual(step(machine, { tag: 'insert', coin: 25 })[1][0], { tag: 'returnCoins', coins: [25] });
});

test('makeChange backtracks where greedy would give up', () => {
  assert.deepEqual(makeChange(30, { 5: 0, 10: 3, 25: 1, 100: 0 }), [10, 10, 10]);
  assert.deepEqual(makeChange(35, { 5: 1, 10: 3, 25: 1, 100: 0 }), [25, 10]);
  assert.equal(makeChange(15, { 5: 0, 10: 1, 25: 1, 100: 0 }), null);
  assert.deepEqual(makeChange(0, { 5: 0, 10: 0, 25: 0, 100: 0 }), []);
});
