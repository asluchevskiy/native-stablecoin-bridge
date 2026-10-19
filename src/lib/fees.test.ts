import { expect, it } from "vitest";
import type { ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { estimateCosts } from "./fees";
const chain = (name: string) => ({ chain: name, name, nativeCurrency: { symbol: "ETH", decimals: 18 } }) as unknown as ChainDefinition;
it("separates EURC native-token FORWARD and PRE_FINALITY quote fees without double counting", () => {
  const estimate = { gasFees: [], fees: [{ type: "provider", token: "ETH", amount: "0.003" }], quote: { totalAmount: "3000", items: [{ type: "FORWARD", amount: "2000" }, { type: "PRE_FINALITY", amount: "1000" }] } } as unknown as EstimateResult<string, string>;
  expect(estimateCosts(estimate, chain("Ethereum"), chain("Base"), "EURC", true)).toEqual([
    { kind: "gas", chain: "Ethereum", symbol: "ETH" }, { kind: "relayer", symbol: "ETH", amount: 0.002 }, { kind: "fast", symbol: "ETH", amount: 0.001 },
  ]);
});
it("shows destination network gas only when minting without the relayer", () => {
  expect(estimateCosts(undefined, chain("Ethereum"), chain("Base"), "USDC", true).map((c) => c.chain)).toEqual(["Ethereum"]);
  expect(estimateCosts(undefined, chain("Ethereum"), chain("Base"), "USDC", false).map((c) => c.chain)).toEqual(["Ethereum", "Base"]);
});