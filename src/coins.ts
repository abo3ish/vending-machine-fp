// Money is integer cents: 0.1 + 0.2 !== 0.3 is not a bug a vending machine can afford.
export type Coin = 5 | 10 | 25 | 100;

// How many of each coin. The machine needs denominations, not a total, to know if it can give change.
export type CoinCounts = Readonly<Record<Coin, number>>;

export const COINS: readonly Coin[] = [100, 25, 10, 5]; // largest first
export const noCoins: CoinCounts = { 5: 0, 10: 0, 25: 0, 100: 0 };

export const total = (coins: readonly Coin[]): number => coins.reduce((sum, c) => sum + c, 0);
export const value = (counts: CoinCounts): number => COINS.reduce((sum, c) => sum + c * counts[c], 0);

// Returns new counts; sign -1 takes the coins out.
export function add(counts: CoinCounts, coins: readonly Coin[], sign: 1 | -1 = 1): CoinCounts {
  const out = { ...counts };
  for (const c of coins) out[c] += sign;
  return out;
}

// Coins that sum to `amount` using at most `available` of each, or null if no combination exists.
// Largest-first, backtracking when stuck: greedy alone gives up on 30¢ from {25, 10, 10, 10},
// this finds 10 + 10 + 10. Four denominations keep the search tiny.
export function makeChange(amount: number, available: CoinCounts): Coin[] | null {
  const search = (i: number, left: number): Coin[] | null => {
    if (left === 0) return [];
    const c = COINS[i];
    if (c === undefined) return null;
    for (let n = Math.min(available[c], Math.floor(left / c)); n >= 0; n--) {
      const rest = search(i + 1, left - n * c);
      if (rest) return [...Array<Coin>(n).fill(c), ...rest];
    }
    return null;
  };
  return search(0, amount);
}
