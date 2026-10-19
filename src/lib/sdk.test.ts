import { expect, it, vi } from "vitest";
import type { ChainDefinition } from "@circle-fin/bridge-kit";
const mocks = vi.hoisted(() => {
  const adapter = { getAddress: vi.fn(async () => "0xestimate") };
  return { adapter, create: vi.fn(() => adapter), key: vi.fn(() => "ephemeral-test-key"), estimate: vi.fn(async () => ({ gasFees: [], fees: [] })), bridge: vi.fn(), retry: vi.fn() };
});
vi.mock("./polyfills", () => ({}));
vi.mock("@circle-fin/adapter-viem-v2", () => ({ createViemAdapterFromPrivateKey: mocks.create }));
vi.mock("viem/accounts", () => ({ generatePrivateKey: mocks.key }));
vi.mock("@circle-fin/bridge-kit", () => ({ BridgeKit: class { estimate = mocks.estimate; bridge = mocks.bridge; retry = mocks.retry; } }));
import { assertTransferAdapter, estimateWithoutWallet } from "./sdk";
it("creates one in-memory estimate adapter and prohibits using it for execution", async () => {
  const from = { chain: "Ethereum", type: "evm" } as ChainDefinition;
  const to = { chain: "Base", type: "evm" } as ChainDefinition;
  await estimateWithoutWallet({ from, to, amount: "100", token: "USDC", fast: true, relayer: true });
  await estimateWithoutWallet({ from, to, amount: "200", token: "USDC", fast: false, relayer: false, recipient: "0xrecipient" });
  expect(mocks.key).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.estimate).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: { adapter: mocks.adapter, chain: "Ethereum" }, to: { adapter: mocks.adapter, chain: "Base", recipientAddress: "0xestimate", useForwarder: true } }));
  expect(mocks.estimate).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: { adapter: mocks.adapter, chain: "Base", recipientAddress: "0xrecipient" } }));
  expect(() => assertTransferAdapter(mocks.adapter)).toThrow("Estimate-only adapter cannot bridge or retry");
  expect(() => assertTransferAdapter({})).not.toThrow();
  expect(mocks.bridge).not.toHaveBeenCalled();
  expect(mocks.retry).not.toHaveBeenCalled();
  expect(localStorage.getItem("privateKey")).toBeNull();
});