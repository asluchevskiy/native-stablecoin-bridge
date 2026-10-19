import type { ChainDefinition } from "@circle-fin/bridge-kit";
import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => ({ getGasPrice: vi.fn(), readContract: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(), createPublicClient: () => rpc }));
const chain = (name = "Ethereum", symbol = "ETH") => ({ chain: name, name, type: "evm", nativeCurrency: { symbol, decimals: 18 }, rpcEndpoints: ["https://rpc.example"], usdcAddress: "0x0000000000000000000000000000000000000001", eurcAddress: "0x0000000000000000000000000000000000000002", cctp: { domain: 0, contracts: { v2: { tokenMessenger: "0x0000000000000000000000000000000000000003" } } } }) as unknown as ChainDefinition;
const input = () => ({ chain: chain(), token: "EURC" as const, amount: "10", source: true, relayer: true, testnet: false });
beforeEach(() => { vi.resetModules(); rpc.getGasPrice.mockReset().mockResolvedValue(1_000_000_000n); rpc.readContract.mockReset().mockResolvedValue(10_000_000n); vi.unstubAllGlobals(); });
it("includes 56000 approval units without a wallet for the 340000 EURC transfer", async () => {
  const { estimateGasFallback } = await import("./gas");
  expect(await estimateGasFallback(input())).toEqual({ amount: 0.000396, estimated: true, includesApproval: true });
  expect(rpc.readContract).not.toHaveBeenCalled();
});
it("skips approval when EURC allowance covers the amount and derives its spender from the registry", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ symbol: "EURC", deployments: [{ domainId: 0, enabled: true, tokenManagerAddress: "0xmanager" }] }] }) });
  vi.stubGlobal("fetch", fetchMock);
  const { estimateGasFallback } = await import("./gas");
  const result = await estimateGasFallback({ ...input(), owner: "0xowner" });
  expect(result).toEqual({ amount: 0.00034, estimated: true, includesApproval: false });
  expect(fetchMock).toHaveBeenCalledWith("https://iris-api.circle.com/v2/cctpx/tokens", expect.anything());
  expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: "0x0000000000000000000000000000000000000002", functionName: "allowance", args: ["0xowner", "0xmanager"] }));
  await estimateGasFallback({ ...input(), owner: "0xowner" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("includes approval when allowance is insufficient or fails, using the SDK USDC messenger", async () => {
  const { estimateGasFallback } = await import("./gas");
  rpc.readContract.mockResolvedValueOnce(9_999_999n).mockRejectedValueOnce(new Error("RPC allowance failed"));
  for (let n = 0; n < 2; n++) expect(await estimateGasFallback({ ...input(), token: "USDC", owner: "0xowner" })).toMatchObject({ amount: 0.000257525, includesApproval: true });
  expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: ["0xowner", "0x0000000000000000000000000000000000000003"] }));
});
it("uses the exact USDC burn, forwarding burn, mint and approval constants", async () => {
  const { typicalGasUnits } = await import("./gas");
  expect(typicalGasUnits("USDC", true, false, false)).toBe(169914);
  expect(typicalGasUnits("USDC", true, true, false)).toBe(201525);
  expect(typicalGasUnits("USDC", true, false, true)).toBe(225914);
  expect(typicalGasUnits("USDC", false, false, true)).toBe(237401);
  expect(typicalGasUnits("EURC", true, false, false)).toBe(340000);
});
it("caches gas prices for 30 seconds, refreshing after expiry", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    const { estimateGasFallback } = await import("./gas");
    await estimateGasFallback(input());
    now.mockReturnValue(29999); await estimateGasFallback(input());
    expect(rpc.getGasPrice).toHaveBeenCalledTimes(1);
    now.mockReturnValue(30000); await estimateGasFallback(input());
    expect(rpc.getGasPrice).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); }
});
it("leaves gas unknown on RPC failure and never estimates Solana", async () => {
  const { estimateGasFallback } = await import("./gas");
  rpc.getGasPrice.mockRejectedValueOnce(new Error("RPC unavailable"));
  expect(await estimateGasFallback(input())).toBeUndefined();
  expect(await estimateGasFallback({ ...input(), chain: { ...chain(), type: "solana" } as ChainDefinition })).toBeUndefined();
  expect(rpc.getGasPrice).toHaveBeenCalledTimes(1);
});
it("uses Arc native USDC decimals for gas without a separate currency assumption", async () => {
  const { estimateGasFallback } = await import("./gas");
  expect(await estimateGasFallback({ ...input(), chain: chain("Arc", "USDC"), token: "USDC", source: false, relayer: false })).toMatchObject({ amount: 0.000237401, includesApproval: false });
});