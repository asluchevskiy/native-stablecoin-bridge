import type { ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { L } from "./chains";

export type CostLine = { kind: "gas" | "relayer" | "fast" | "provider"; chain?: string; symbol: string; amount?: number };

export type FeeTier = { finalityThreshold: number; minimumFee: number; forwardFee?: { low: number | string; med: number | string; high: number | string } };

export function validEstimateAmount(amount: string): boolean {
  return /^\d+(?:\.\d{0,6})?$|^\.\d{1,6}$/.test(amount) && Number.isFinite(Number(amount)) && Number(amount) > 0;
}

export function arrivalKind(source: ChainDefinition | undefined, fast: boolean): "arrivalFast" | "arrivalStandard" | "arrivalOther" {
  return fast ? "arrivalFast" : source && /^Ethereum(?:_|$)/.test(L(source).chain) ? "arrivalStandard" : "arrivalOther";
}

export function publicFeeEstimate(tiers: FeeTier[], amount: string, fast: boolean, relayer: boolean): EstimateResult<string, string> {
  const tier = tiers.find((t) => Number(t.finalityThreshold) === (fast ? 1000 : 2000));
  if (!tier || !validEstimateAmount(amount) || !Number.isFinite(Number(tier.minimumFee)) || Number(tier.minimumFee) < 0) throw new Error("Fee tier unavailable");
  const protocol = Number(amount) * Number(tier.minimumFee) / 10000;
  const relay = relayer ? Number(tier.forwardFee?.high) / 1e6 : 0;
  if (!Number.isFinite(relay) || relay < 0) throw new Error("Relay fee unavailable");
  return { gasFees: [], fees: [
    { type: "provider", token: "USDC", amount: String(protocol) },
    ...(relayer ? [{ type: "forwarder", token: "USDC", amount: String(relay) }] : []),
  ] } as unknown as EstimateResult<string, string>;
}

export async function fetchPublicFeeEstimate(source: ChainDefinition, destination: ChainDefinition, amount: string, fast: boolean, relayer: boolean, testnet: boolean): Promise<EstimateResult<string, string>> {
  const srcDomain = L(source).cctp?.domain;
  const dstDomain = L(destination).cctp?.domain;
  if (srcDomain == null || dstDomain == null) throw new Error("CCTP domains unavailable");
  const iris = testnet ? "https://iris-api-sandbox.circle.com" : "https://iris-api.circle.com";
  const response = await fetch(`${iris}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}?forward=true`);
  if (!response.ok) throw new Error(`Circle fee estimate unavailable (${response.status})`);
  const tiers = await response.json() as FeeTier[];
  if (!Array.isArray(tiers)) throw new Error("Invalid Circle fee response");
  return publicFeeEstimate(tiers, amount, fast, relayer);
}

/** Keep the quote's human-readable summary and atomic item breakdown distinct. */
export function estimateCosts(estimate: EstimateResult<string, string> | undefined, source: ChainDefinition | undefined, destination: ChainDefinition | undefined, token: string, relayer: boolean): CostLine[] {
  if (!source || !destination) return [];
  const costs: CostLine[] = [];
  for (const chain of [source, ...(!relayer ? [destination] : [])]) {
    const gas = estimate?.gasFees.filter((g) => String(g.blockchain) === L(chain).chain);
    const known = gas?.filter((g) => g.fees && Number.isFinite(Number(g.fees.fee)));
    costs.push({ kind: "gas", chain: L(chain).name, symbol: L(chain).nativeCurrency.symbol,
      // Bridge Kit's live estimate returns fee in human-readable native-token units.
      ...(known?.length && known.length === gas?.length ? { amount: known.reduce((sum, g) => sum + Number(g.fees?.fee), 0) } : {}) });
  }
  const quote = estimate?.quote as { totalAmount?: string; items?: { type: string; amount: string }[] } | undefined;
  for (const fee of estimate?.fees ?? []) {
    if (fee.amount === null) { costs.push({ kind: fee.type === "forwarder" ? "relayer" : "provider", symbol: fee.token }); continue; }
    if (token === "EURC" && fee.type === "provider" && quote?.items?.length && Number(quote.totalAmount) > 0) {
      for (const item of quote.items) costs.push({ kind: item.type === "FORWARD" ? "relayer" : item.type === "PRE_FINALITY" ? "fast" : "provider", symbol: fee.token,
        amount: Number(fee.amount) * Number(item.amount) / Number(quote.totalAmount) });
    } else if (Number(fee.amount) > 0) costs.push({ kind: fee.type === "forwarder" ? "relayer" : token === "USDC" && fee.type === "provider" ? "fast" : "provider", symbol: fee.token, amount: Number(fee.amount) });
  }
  return costs;
}