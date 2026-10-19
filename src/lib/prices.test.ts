import { afterEach, describe, expect, it, vi } from "vitest";
import { spotPrice, usdCost } from "./prices";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("public USD prices", () => {
  it("uses USDC at $1 without a network call", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await spotPrice("USDC")).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("caches ETH spot quotes for exactly 60 seconds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { amount: "2500" } }) });
    vi.stubGlobal("fetch", fetcher);
    expect(await spotPrice("ETH")).toBe(2500);
    vi.setSystemTime(159_999);
    expect(await spotPrice("ETH")).toBe(2500);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(160_000);
    await spotPrice("ETH");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  });
  it("leaves unavailable USD values absent instead of inventing a price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await spotPrice("EURC")).toBeUndefined();
    expect(usdCost(0.01, "ETH", {})).toBeUndefined();
  });
});