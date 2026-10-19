import { expect, it } from "vitest";
import { arrivalInfo, hasSpeedDowngrade, mainnetTimingId } from "./arrival";

it.each(["Arbitrum", "Base", "Codex", "Edge", "Ink", "Linea", "Morph", "Optimism", "Plume", "Solana", "Unichain", "World_Chain", "X_Layer"])("uses eight-second Fast attestation for %s", (id) => {
  expect(arrivalInfo(id, true).time).toEqual({ min: 8, unit: "second" });
});
it("uses twenty-second Fast attestation for Ethereum", () => {
  expect(arrivalInfo("Ethereum", true).time).toEqual({ min: 20, unit: "second" });
});
it.each(["Ethereum", "Arbitrum", "Base", "Codex", "Optimism", "Plume", "Unichain", "World_Chain", "X_Layer"])("uses 15–19 minute Standard attestation for %s", (id) => {
  expect(arrivalInfo(id, false).time).toEqual({ min: 15, max: 19, unit: "minute" });
});
it.each([["Edge", 16, 21, "minute"], ["Ink", 30, undefined, "minute"], ["Morph", 20, 30, "minute"], ["Linea", 6, 32, "hour"],
  ["Arc", 1, undefined, "second"], ["Avalanche", 8, undefined, "second"], ["Cronos", 1, undefined, "second"],
  ["HyperEVM", 5, undefined, "second"], ["Injective", 1, undefined, "second"], ["Monad", 5, undefined, "second"],
  ["Pharos", 7, undefined, "second"], ["Plasma", 1, undefined, "second"], ["Polygon", 8, undefined, "second"],
  ["Sei", 5, undefined, "second"], ["Solana", 25, undefined, "second"], ["Sonic", 8, undefined, "second"], ["XDC", 10, undefined, "second"]])("uses the published Standard time for %s", (id, min, max, unit) => {
    expect(arrivalInfo(String(id), false).time).toEqual({ min, ...(max ? { max } : {}), unit });
});
it.each(["Sepolia", "Testnet", "Fuji", "Devnet", "Apothem", "Hoodi", "Amoy_Testnet"])("maps the %s testnet suffix without changing mainnet identifiers", (suffix) => {
  expect(mainnetTimingId(`World_Chain_${suffix}`)).toBe("World_Chain");
  expect(arrivalInfo(`World_Chain_${suffix}`, false).time).toEqual({ min: 15, max: 19, unit: "minute" });
});
it("falls back to Standard on Arc while leaving future unknown chains unknown", () => {
  expect(arrivalInfo("Arc", true)).toEqual({ time: { min: 1, unit: "second" }, standardAlreadyFast: true, longStandard: false });
  expect(arrivalInfo("Future", true).time).toBeUndefined();
});
it("flags only Linea's hours-long Standard time", () => {
  expect(arrivalInfo("Linea_Sepolia", false).longStandard).toBe(true);
  expect(arrivalInfo("Morph", false).longStandard).toBe(false);
});
it("detects the nonfatal SDK speed warning on both estimates and results", () => {
  expect(hasSpeedDowngrade({ warnings: [{ code: "SPEED_DOWNGRADED", data: { requested: "FAST", actual: "SLOW" } }] })).toBe(true);
  expect(hasSpeedDowngrade({ warnings: [{ code: "OTHER" }] })).toBe(false);
  expect(hasSpeedDowngrade(undefined)).toBe(false);
});