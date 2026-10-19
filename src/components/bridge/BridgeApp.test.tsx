import { act, fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BridgeApp } from "./BridgeApp";
import { loadHistory } from "@/lib/history";
import type { Result } from "@/lib/transfers";

const fixtures = vi.hoisted(() => {
  const chain = (name: string, id: number) => ({ chain: name, name, type: "evm", chainId: id, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, explorerUrl: `https://${name.toLowerCase()}.example/tx/{hash}`, rpcEndpoints: ["https://rpc.example"], usdcAddress: "0x0000000000000000000000000000000000000001", eurcAddress: "0x0000000000000000000000000000000000000002", cctpx: {}, cctp: { forwarderSupported: { destination: true } } });
  const handlers = new Set<(payload: unknown) => void>();
  const transfers: { params: any; resolve: (r: any) => void; reject: (e: Error) => void }[] = [];
  const provider = { request: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  const adapter = {};
  const kit = {
    getSupportedChains: () => [chain("Ethereum", 1), chain("Base", 8453)],
    providers: [{ name: "CCTPXBridgingProvider", supportsRoute: async () => true }],
    estimate: vi.fn().mockResolvedValue({ gasFees: [], fees: [{ type: "provider", token: "ETH", amount: "0.002" }], quote: { totalAmount: "2000", items: [{ type: "FORWARD", amount: "2000" }] } }),
    on: (_: string, h: (p: unknown) => void) => handlers.add(h),
    off: (_: string, h: (p: unknown) => void) => handlers.delete(h),
    bridge: vi.fn((params: any) => new Promise((resolve, reject) => transfers.push({ params, resolve, reject }))),
    retry: vi.fn((result: any, _ctx: any, meta: any) => new Promise((resolve, reject) => transfers.push({ params: { ...result, invocationMeta: meta }, resolve, reject }))),
  };
  return { kit, handlers, transfers, provider, adapter };
});

vi.mock("@/lib/sdk", () => ({
  loadSdk: async () => ({ kit: fixtures.kit, sdk: {} }),
  makeEvmAdapter: async () => fixtures.adapter,
  makeSolanaAdapter: async () => fixtures.adapter,
  errMsg: async (e: Error) => e.message,
  isUserRejection: () => false,
}));
vi.mock("@/lib/chains", async (original) => ({ ...await original<typeof import("@/lib/chains")>(), fetchBalances: vi.fn().mockResolvedValue({ token: "500", native: "1", nativeSymbol: "ETH", decimals: 6 }) }));
vi.mock("@/lib/wallets", async (original) => ({ ...await original<typeof import("@/lib/wallets")>(), discoverEvmWallets: (cb: (w: unknown[]) => void) => { cb([{ uuid: "wallet", rdns: "test.wallet", name: "Test wallet", provider: fixtures.provider }]); return () => {}; } }));
vi.mock("@/lib/prices", async (original) => ({ ...await original<typeof import("@/lib/prices")>(), spotPrice: async (symbol: string) => symbol === "USDC" ? 1 : 2500 }));

const mount = () => render(<I18nProvider><TooltipProvider><BridgeApp /></TooltipProvider></I18nProvider>);
const emit = (id: string, method: string, values: object) => act(() => { for (const h of fixtures.handlers) h({ protocol: "cctpx", traceId: id, method, values }); });
const pending = () => loadHistory().find((h) => h.result.state === "pending");
async function confirm(amount: string) {
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: amount } });
  await waitFor(() => expect(screen.getByRole("button", { name: `Bridge ${amount} EURC to Base` })).toBeEnabled(), { timeout: 4000 });
  fireEvent.click(screen.getByRole("button", { name: `Bridge ${amount} EURC to Base` }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: /^Confirm$/ }));
  await waitFor(() => expect(fixtures.kit.bridge).toHaveBeenCalled());
}
beforeEach(() => {
  localStorage.clear();
  fixtures.handlers.clear(); fixtures.transfers.length = 0;
  fixtures.kit.bridge.mockClear(); fixtures.kit.retry.mockClear();
  fixtures.provider.request.mockReset();
  fixtures.provider.request.mockImplementation(async ({ method }: { method: string }) => method === "eth_accounts" || method === "eth_requestAccounts" ? ["0x1111111111111111111111111111111111111111"] : null);
  localStorage.setItem("nsb.wallet.evm", "test.wallet");
});
afterEach(() => cleanup());

describe("transfer session", () => {
  it("restores silently, runs two isolated EURC transfers, and completes background history", async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    expect(fixtures.provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(fixtures.provider.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    fireEvent.click(screen.getByRole("radio", { name: /Standard/ }));
    await confirm("100");
    const first = pending();
    if (!first) throw new Error("No in-flight transfer persisted");
    expect(fixtures.transfers[0]?.params.invocationMeta.traceId).toBe(first.id);
    expect(first.result.steps).toEqual([]);
    emit(first.id, "approve", { transactionHash: "0xapprove1" });
    emit(first.id, "transfer", { transactionHash: "0xtransfer1" });
    expect(loadHistory().find((h) => h.id === first.id)?.result.steps).toMatchObject([{ name: "approve", state: "success", txHash: "0xapprove1" }, { name: "transfer", state: "success", txHash: "0xtransfer1" }]);
    expect(screen.getByText(/Waiting for source-chain finality/)).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "https://ethereum.example/tx/0xtransfer1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start another transfer" }));
    await confirm("50");
    const second = loadHistory().find((h) => h.id !== first.id);
    if (!second) throw new Error("No second transfer");
    emit(second.id, "approve", { transactionHash: "0xapprove2" });
    emit(first.id, "fetchAttestation", { status: "complete", attestation: "0xattestation1" });
    expect(loadHistory().find((h) => h.id === second.id)?.result.steps).toHaveLength(1);
    expect(loadHistory().find((h) => h.id === first.id)?.result.steps.find((s) => s.name === "fetchAttestation")?.data).toBe("0xattestation1");
    expect(screen.queryByRole("button", { name: "Resume transfer" })).not.toBeInTheDocument();
    const final: Result = { ...first.result, state: "success", steps: [{ name: "approve", state: "success" }, { name: "transfer", state: "success", txHash: "0xtransfer1" }, { name: "fetchAttestation", state: "success", data: "0xattestation1" }, { name: "forward", state: "success", txHash: "0xmint1" }] };
    await act(async () => { fixtures.transfers[0]?.resolve(final); });
    expect(loadHistory().find((h) => h.id === first.id)?.result.state).toBe("success");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(loadHistory().find((h) => h.id === second.id)?.result.state).toBe("pending");
    const receipt = screen.getByLabelText("Receipt");
    expect(within(receipt).getByText("50 EURC")).toBeInTheDocument();
    expect(within(receipt).queryByText("Transfer complete")).not.toBeInTheDocument();
  });
  it("resumes saved EURC via retry with the existing entry trace ID", async () => {
    const [source, destination] = fixtures.kit.getSupportedChains();
    localStorage.setItem("nsb.history.v1", JSON.stringify([{ id: "saved", createdAt: 123, network: "mainnet", result: { state: "pending", provider: "CCTPXBridgingProvider", token: "EURC", amount: "100", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: true }, steps: [{ name: "approve", state: "success" }, { name: "transfer", state: "success", txHash: "0xoldburn" }] } }]));
    mount();
    await waitFor(() => expect(fixtures.provider.request).toHaveBeenCalledWith({ method: "eth_accounts" }));
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Resume transfer" }));
    await waitFor(() => expect(fixtures.kit.retry).toHaveBeenCalled());
    expect(fixtures.kit.retry.mock.calls[0]?.[2]).toEqual({ traceId: "saved" });
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
    emit("saved", "fetchAttestation", { status: "complete", attestation: "0xresumed" });
    expect(loadHistory()[0]?.result.steps.find((s) => s.name === "fetchAttestation")?.data).toBe("0xresumed");
  });
  it("keeps hard-error transfer hashes retryable, and removes failures before any transaction", async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    await confirm("100");
    const first = pending();
    if (!first) throw new Error("No entry");
    emit(first.id, "transfer", { transactionHash: "0xretained" });
    await act(async () => { fixtures.transfers[0]?.reject(new Error("Polling unavailable")); });
    expect(loadHistory().find((h) => h.id === first.id)?.result.steps).toMatchObject([{ name: "transfer", state: "success", txHash: "0xretained" }]);
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: undefined }));
    await waitFor(() => expect(fixtures.kit.retry).toHaveBeenCalled());
    expect(fixtures.kit.bridge).toHaveBeenCalledTimes(1);
    await act(async () => { fixtures.transfers[1]?.resolve({ ...first.result, state: "success" }); });
    fireEvent.click(screen.getByRole("button", { name: "Bridge again" }));
    await confirm("50");
    const failed = loadHistory().find((h) => h.id !== first.id);
    if (!failed) throw new Error("No new entry");
    await act(async () => { fixtures.transfers[2]?.reject(new Error("Validation failed")); });
    expect(loadHistory().find((h) => h.id === failed.id)).toBeUndefined();
  });
});