import { expect, it } from "vitest";
import type { ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { arrivalKind, estimateCosts, fetchPublicFeeEstimate, publicFeeEstimate, validEstimateAmount } from "./fees";
import { vi } from "vitest";
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

it("accepts positive amounts with at most six decimals independently of wallet or balance", () => {
  expect(validEstimateAmount("100.123456")).toBe(true);
  expect(validEstimateAmount(".5")).toBe(true);
  for (const amount of ["0", "-1", "100.1234567", "1e3", "Infinity", ""]) expect(validEstimateAmount(amount)).toBe(false);
});
const tiers = [
  { finalityThreshold: 1000, minimumFee: 14, forwardFee: { low: "100000", med: "200000", high: "300000" } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: "100000", med: "200000", high: "250000" } },
];
it("converts Fast basis points and high relayer base units without assuming gas", () => {
  const estimate = publicFeeEstimate(tiers, "100", true, true);
  expect(estimate.fees).toEqual([{ type: "provider", token: "USDC", amount: "0.14" }, { type: "forwarder", token: "USDC", amount: "0.3" }]);
  expect(estimate.gasFees).toEqual([]);
});
it("selects Standard tier and omits relay fees for self mint", () => {
  expect(publicFeeEstimate(tiers, "100", false, false).fees).toEqual([{ type: "provider", token: "USDC", amount: "0" }]);
  expect(publicFeeEstimate(tiers, "100", false, true).fees[1]?.amount).toBe("0.25");
});
it("rejects missing or malformed public fees instead of guessing", () => {
  expect(() => publicFeeEstimate([], "100", true, true)).toThrow();
  expect(() => publicFeeEstimate([{ finalityThreshold: 1000, minimumFee: NaN }], "100", true, false)).toThrow();
  expect(() => publicFeeEstimate([{ finalityThreshold: 1000, minimumFee: 1 }], "100", true, true)).toThrow();
});
it("uses SDK domains including domain zero and the selected Iris network", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => tiers });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const src = { ...chain("Ethereum"), cctp: { domain: 0 } } as unknown as ChainDefinition;
    const dst = { ...chain("Base"), cctp: { domain: 6 } } as unknown as ChainDefinition;
    await fetchPublicFeeEstimate(src, dst, "100", true, true, false);
    expect(fetchMock).toHaveBeenLastCalledWith("https://iris-api.circle.com/v2/burn/USDC/fees/0/6?forward=true");
    await fetchPublicFeeEstimate(src, dst, "100", false, false, true);
    expect(fetchMock).toHaveBeenLastCalledWith("https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6?forward=true");
  } finally { vi.unstubAllGlobals(); }
});
it("gives route-specific short arrival estimates", () => {
  expect(arrivalKind(chain("Ethereum"), true)).toBe("arrivalFast");
  expect(arrivalKind(chain("Ethereum_Sepolia"), false)).toBe("arrivalStandard");
  expect(arrivalKind(chain("Base"), false)).toBe("arrivalOther");
});