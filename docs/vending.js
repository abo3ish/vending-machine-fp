// src/coins.ts
var COINS = [100, 25, 10, 5];
var noCoins = { 5: 0, 10: 0, 25: 0, 100: 0 };
var total = (coins) => coins.reduce((sum, c) => sum + c, 0);
var value = (counts) => COINS.reduce((sum, c) => sum + c * counts[c], 0);
function add(counts, coins, sign = 1) {
  const out = { ...counts };
  for (const c of coins) out[c] += sign;
  return out;
}
function makeChange(amount, available) {
  const search = (i, left) => {
    if (left === 0) return [];
    const c = COINS[i];
    if (c === void 0) return null;
    for (let n = Math.min(available[c], Math.floor(left / c)); n >= 0; n--) {
      const rest = search(i + 1, left - n * c);
      if (rest) return [...Array(n).fill(c), ...rest];
    }
    return null;
  };
  return search(0, amount);
}

// src/machine.ts
var money = (cents) => `$${(cents / 100).toFixed(2)}`;
var show = (text) => ({ tag: "display", text });
var giveBack = (coins) => coins.length ? [{ tag: "returnCoins", coins }] : [];
var refund = (m, coins, text) => [{ ...m, phase: { tag: "idle" } }, [...giveBack(coins), show(text)]];
function step(m, e) {
  switch (m.phase.tag) {
    case "idle":
      return idle(m, e);
    case "paying":
      return paying(m, m.phase, e);
    case "dispensing":
      return dispensing(m, m.phase, e);
  }
}
function idle(m, e) {
  switch (e.tag) {
    case "select": {
      const slot = m.slots[e.slot];
      if (!slot) return [m, [show("No such slot")]];
      if (slot.qty === 0) return [m, [show(`${slot.product} is sold out`)]];
      return [{ ...m, phase: { tag: "paying", slot: e.slot, inserted: [] } }, [show(`${slot.product}: insert ${money(slot.price)}`)]];
    }
    case "insert":
      return [m, [...giveBack([e.coin]), show("Select a product first")]];
    case "buy":
      return [m, [show("Select a product first")]];
    case "cancel":
      return [m, []];
    // A stray signal from the hardware changes nothing.
    case "dispensed":
    case "jammed":
      return [m, []];
  }
}
function paying(m, p, e) {
  switch (e.tag) {
    case "select":
      return [m, [show("Finish or cancel first")]];
    case "insert": {
      const inserted = [...p.inserted, e.coin];
      const paid = total(inserted);
      const price = m.slots[p.slot].price;
      const text = paid < price ? `Paid ${money(paid)}, ${money(price - paid)} to go` : `Press BUY, change ${money(paid - price)}`;
      return [{ ...m, phase: { ...p, inserted } }, [show(text)]];
    }
    case "buy": {
      const paid = total(p.inserted);
      const price = m.slots[p.slot].price;
      if (paid < price) return [m, [show(`Insert ${money(price - paid)} more`)]];
      const change = makeChange(paid - price, add(m.box, p.inserted));
      if (!change) return refund(m, p.inserted, "Exact change only");
      return [{ ...m, phase: { tag: "dispensing", slot: p.slot, inserted: p.inserted, change } }, [{ tag: "dispense", slot: p.slot }, show("Dispensing...")]];
    }
    case "cancel":
      return refund(m, p.inserted, "Cancelled");
    case "dispensed":
    case "jammed":
      return [m, []];
  }
}
function dispensing(m, d, e) {
  switch (e.tag) {
    case "select":
      return [m, [show("Please wait")]];
    case "insert":
      return [m, [...giveBack([e.coin]), show("Please wait")]];
    case "buy":
      return [m, [show("Please wait")]];
    case "cancel":
      return [m, [show("Too late to cancel")]];
    // The only place stock and the coin box change, and only once the product is out.
    case "dispensed": {
      const slot = m.slots[d.slot];
      return [{
        phase: { tag: "idle" },
        slots: { ...m.slots, [d.slot]: { ...slot, qty: slot.qty - 1 } },
        box: add(add(m.box, d.inserted), d.change, -1)
      }, [...giveBack(d.change), show(`Enjoy your ${slot.product}`)]];
    }
    // Nothing was committed, so there is nothing to roll back: hand the money back.
    case "jammed":
      return refund(m, d.inserted, "Jammed: money refunded");
  }
}
function run(start, events) {
  let m = start;
  return events.map((event) => {
    const [after, effects] = step(m, event);
    const t = { event, before: m, after, effects };
    m = after;
    return t;
  });
}
export {
  COINS,
  add,
  makeChange,
  money,
  noCoins,
  run,
  step,
  total,
  value
};
