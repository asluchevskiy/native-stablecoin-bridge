import type { ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { L } from "./chains";

export type CostLine = { kind: "gas" | "relayer" | "fast" | "provider"; chain?: string; symbol: string; amount?: number };

/** Keep the quote's human-readable summary and atomic item breakdown distinct. */
export function estimateCosts(estimate: EstimateResult<string, string> | undefined, source: ChainDefinition | undefined, destination: ChainDefinition | undefined, token: string, relayer: boolean): CostLine[] {
  if (!source || !destination) return [];
  const costs: CostLine[] = [];
  for (const chain of [source, ...(!relayer ? [destination] : [])]) {
    const gas = estimate?.gasFees.filter((g) => String(g.blockchain) === L(chain).chain);
    const known = gas?.filter((g) => g.fees);
    costs.push({ kind: "gas", chain: L(chain).name, symbol: L(chain).nativeCurrency.symbol,
      ...(known?.length ? { amount: known.reduce((sum, g) => sum + Number(g.fees?.fee ?? 0) / 10 ** L(chain).nativeCurrency.decimals, 0) } : {}) });
  }
  const quote = estimate?.quote as { totalAmount?: string; items?: { type: string; amount: string }[] } | undefined;
  for (const fee of estimate?.fees ?? []) {
    if (fee.amount === null) { costs.push({ kind: fee.type === "forwarder" ? "relayer" : "provider", symbol: fee.token }); continue; }
    if (token === "EURC" && fee.type === "provider" && quote?.items?.length && Number(quote.totalAmount) > 0) {
      for (const item of quote.items) costs.push({ kind: item.type === "FORWARD" ? "relayer" : item.type === "PRE_FINALITY" ? "fast" : "provider", symbol: fee.token,
        amount: Number(fee.amount) * Number(item.amount) / Number(quote.totalAmount) });
    } else costs.push({ kind: fee.type === "forwarder" ? "relayer" : token === "USDC" && fee.type === "provider" ? "fast" : "provider", symbol: fee.token, amount: Number(fee.amount) });
  }
  return costs;
}