const TTL = 60_000;
const cache = new Map<string, { expires: number; value: Promise<number | undefined> }>();

/** Public client-side quotes only; a missing quote never hides the token cost. */
export function spotPrice(symbol: string): Promise<number | undefined> {
  if (symbol === "USDC") return Promise.resolve(1);
  const saved = cache.get(symbol);
  if (saved && saved.expires > Date.now()) return saved.value;
  const value = (async () => {
    try {
      const response = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const json = await response.json();
      const price = Number(json.data?.amount);
      return Number.isFinite(price) && price > 0 ? price : undefined;
    } catch { return undefined; }
  })();
  cache.set(symbol, { expires: Date.now() + TTL, value });
  return value;
}

export function usdCost(amount: number, symbol: string, prices: Record<string, number | undefined>): number | undefined {
  const price = prices[symbol];
  return price === undefined ? undefined : amount * price;
}