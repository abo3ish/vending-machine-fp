// The whole vending machine is one pure function: step(machine, event) -> [machine, effects].
// No I/O, no clock, no mutation. The shell (UI, hardware driver) feeds it events and carries out the effects.
import { add, makeChange, total, type Coin, type CoinCounts } from './coins.ts';

export * from './coins.ts';

export type Slot = Readonly<{ product: string; price: number; qty: number }>;

// Each phase carries only the data that phase needs, so "idle with a selected product" can't be written down.
export type Phase =
  | Readonly<{ tag: 'idle' }>
  | Readonly<{ tag: 'paying'; slot: string; inserted: readonly Coin[] }>
  // Waiting for the hardware to confirm. The coins sit in escrow: nothing is committed until 'dispensed'.
  | Readonly<{ tag: 'dispensing'; slot: string; inserted: readonly Coin[]; change: readonly Coin[] }>;

type Paying = Extract<Phase, { tag: 'paying' }>;
type Dispensing = Extract<Phase, { tag: 'dispensing' }>;

// Stock is per slot ("A1"), the physical thing that runs empty; the same product may sit in two slots.
export type Machine = Readonly<{ phase: Phase; slots: Readonly<Record<string, Slot>>; box: CoinCounts }>;

export type Event =
  | Readonly<{ tag: 'select'; slot: string }>
  | Readonly<{ tag: 'insert'; coin: Coin }>
  | Readonly<{ tag: 'buy' }>
  | Readonly<{ tag: 'cancel' }>
  // From the hardware: the product dropped, or it got stuck.
  | Readonly<{ tag: 'dispensed' }>
  | Readonly<{ tag: 'jammed' }>;

// What the shell must do. Data, not calls: tests read them, the UI animates them.
export type Effect =
  | Readonly<{ tag: 'display'; text: string }>
  | Readonly<{ tag: 'dispense'; slot: string }>
  | Readonly<{ tag: 'returnCoins'; coins: readonly Coin[] }>;

export type Step = readonly [Machine, readonly Effect[]];

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const show = (text: string): Effect => ({ tag: 'display', text });
const giveBack = (coins: readonly Coin[]): Effect[] => (coins.length ? [{ tag: 'returnCoins', coins }] : []);
const refund = (m: Machine, coins: readonly Coin[], text: string): Step => [{ ...m, phase: { tag: 'idle' } }, [...giveBack(coins), show(text)]];

// Every (phase, event) pair is handled below; drop a case and the compiler refuses to build.
export function step(m: Machine, e: Event): Step {
  switch (m.phase.tag) {
    case 'idle': return idle(m, e);
    case 'paying': return paying(m, m.phase, e);
    case 'dispensing': return dispensing(m, m.phase, e);
  }
}

function idle(m: Machine, e: Event): Step {
  switch (e.tag) {
    case 'select': {
      const slot = m.slots[e.slot];
      if (!slot) return [m, [show('No such slot')]];
      if (slot.qty === 0) return [m, [show(`${slot.product} is sold out`)]];
      return [{ ...m, phase: { tag: 'paying', slot: e.slot, inserted: [] } }, [show(`${slot.product}: insert ${money(slot.price)}`)]];
    }
    case 'insert': return [m, [...giveBack([e.coin]), show('Select a product first')]];
    case 'buy': return [m, [show('Select a product first')]];
    case 'cancel': return [m, []];
    // A stray signal from the hardware changes nothing.
    case 'dispensed':
    case 'jammed': return [m, []];
  }
}

function paying(m: Machine, p: Paying, e: Event): Step {
  switch (e.tag) {
    case 'select': return [m, [show('Finish or cancel first')]];
    case 'insert': {
      const inserted = [...p.inserted, e.coin];
      const paid = total(inserted);
      const price = m.slots[p.slot]!.price;
      const text = paid < price ? `Paid ${money(paid)}, ${money(price - paid)} to go` : `Press BUY, change ${money(paid - price)}`;
      return [{ ...m, phase: { ...p, inserted } }, [show(text)]];
    }
    case 'buy': {
      const paid = total(p.inserted);
      const price = m.slots[p.slot]!.price;
      if (paid < price) return [m, [show(`Insert ${money(price - paid)} more`)]];
      // Change can come from the box or from the coins just inserted.
      const change = makeChange(paid - price, add(m.box, p.inserted));
      if (!change) return refund(m, p.inserted, 'Exact change only');
      return [{ ...m, phase: { tag: 'dispensing', slot: p.slot, inserted: p.inserted, change } }, [{ tag: 'dispense', slot: p.slot }, show('Dispensing...')]];
    }
    case 'cancel': return refund(m, p.inserted, 'Cancelled');
    case 'dispensed':
    case 'jammed': return [m, []];
  }
}

function dispensing(m: Machine, d: Dispensing, e: Event): Step {
  switch (e.tag) {
    case 'select': return [m, [show('Please wait')]];
    case 'insert': return [m, [...giveBack([e.coin]), show('Please wait')]];
    case 'buy': return [m, [show('Please wait')]];
    case 'cancel': return [m, [show('Too late to cancel')]];
    // The only place stock and the coin box change, and only once the product is out.
    case 'dispensed': {
      const slot = m.slots[d.slot]!;
      return [{
        phase: { tag: 'idle' },
        slots: { ...m.slots, [d.slot]: { ...slot, qty: slot.qty - 1 } },
        box: add(add(m.box, d.inserted), d.change, -1),
      }, [...giveBack(d.change), show(`Enjoy your ${slot.product}`)]];
    }
    // Nothing was committed, so there is nothing to roll back: hand the money back.
    case 'jammed': return refund(m, d.inserted, 'Jammed: money refunded');
  }
}

export type Transition = Readonly<{ event: Event; before: Machine; after: Machine; effects: readonly Effect[] }>;

// Replay a list of events. Same events in, same history out: this is the undo, the time travel and the test harness.
export function run(start: Machine, events: readonly Event[]): Transition[] {
  let m = start;
  return events.map((event) => {
    const [after, effects] = step(m, event);
    const t = { event, before: m, after, effects };
    m = after;
    return t;
  });
}
