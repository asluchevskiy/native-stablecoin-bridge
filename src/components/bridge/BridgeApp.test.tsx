import { act, fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BridgeApp } from "./BridgeApp";
import { loadHistory } from "@/lib/history";
import type { Result } from "@/lib/transfers";
import { fetchBalances } from "@/lib/chains";
import { estimateWithoutWallet } from "@/lib/sdk";
import { Toaster } from "@/components/ui/sonner";

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
  assertTransferAdapter: vi.fn(),
  estimateWithoutWallet: vi.fn(async () => ({ gasFees: [], fees: [{ type: "forwarder", token: "USDC", amount: "0.1" }] })),
  errMsg: async (e: Error) => e.message,
  isUserRejection: () => false,
}));
vi.mock("@/lib/chains", async (original) => ({ ...await original<typeof import("@/lib/chains")>(), fetchBalances: vi.fn().mockResolvedValue({ token: "500", native: "1", nativeSymbol: "ETH", decimals: 6 }) }));
vi.mock("@/lib/wallets", async (original) => ({ ...await original<typeof import("@/lib/wallets")>(), discoverEvmWallets: (cb: (w: unknown[]) => void) => { cb([{ uuid: "wallet", rdns: "test.wallet", name: "Test wallet", provider: fixtures.provider }]); return () => {}; } }));
vi.mock("@/lib/prices", async (original) => ({ ...await original<typeof import("@/lib/prices")>(), spotPrice: async (symbol: string) => symbol === "USDC" ? 1 : 2500 }));
vi.mock("@/lib/gas", () => ({ estimateGasFallback: vi.fn(async () => ({ amount: 0.000396, estimated: true, includesApproval: true })) }));

const mount = () => render(<I18nProvider><TooltipProvider><BridgeApp /><Toaster /></TooltipProvider></I18nProvider>);
const emit = (id: string, method: string, values: object) => act(() => { for (const h of fixtures.handlers) h({ protocol: "cctpx", traceId: id, method, values }); });
const pending = () => loadHistory().find((h) => h.result.state === "pending");
async function confirm(amount: string) {
  fireEvent.change(screen.getByLabelText("You send"), { target: { value: amount } });
  await waitFor(() => expect(screen.getByRole("button", { name: `Bridge ${amount} EURC to Base` })).toBeEnabled(), { timeout: 4000 });
  const receipt = screen.getByLabelText("Receipt");
  expect(within(receipt).getByText("Circle relayer fee")).toBeInTheDocument();
  expect(within(receipt).getByText(/Circle's fee is paid in the source chain's native token/)).toBeInTheDocument();
  expect(within(receipt).getByText("0.002 ETH")).toBeInTheDocument();
  expect(within(receipt).getByText("($5.00)")).toBeInTheDocument();
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
  fixtures.kit.estimate.mockClear();
  vi.mocked(estimateWithoutWallet).mockClear();
  fixtures.provider.request.mockReset();
  fixtures.provider.request.mockImplementation(async ({ method }: { method: string }) => method === "eth_accounts" || method === "eth_requestAccounts" ? ["0x1111111111111111111111111111111111111111"] : null);
  localStorage.setItem("nsb.wallet.evm", "test.wallet");
});
afterEach(() => cleanup());

describe("transfer session", () => {
  it("locks EURC forwarding and restores the previous USDC choice", async () => {
    mount();
    const relayer = await screen.findByRole("switch", { name: "Circle relayer mints for me" });
    expect(relayer).toBeChecked();
    fireEvent.click(relayer);
    expect(relayer).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    expect(relayer).toBeChecked();
    expect(relayer).toBeDisabled();
    fireEvent.change(screen.getByLabelText("You send"), { target: { value: "10" } });
    await waitFor(() => expect(fixtures.kit.estimate).toHaveBeenCalledWith(expect.objectContaining({ token: "EURC", to: expect.objectContaining({ useForwarder: true }) })), { timeout: 4000 });
    fireEvent.click(screen.getByRole("radio", { name: "USDC" }));
    expect(relayer).not.toBeChecked();
    expect(relayer).toBeEnabled();
    await waitFor(() => expect(fixtures.kit.estimate).toHaveBeenLastCalledWith(expect.objectContaining({ token: "USDC", to: expect.not.objectContaining({ useForwarder: true }) })), { timeout: 4000 });
  });
  it("shows the relayer hint matching the switch state and none for EURC", async () => {
    mount();
    const relayer = await screen.findByRole("switch", { name: "Circle relayer mints for me" });
    expect(relayer).toBeChecked();
    expect(screen.getByText("Turn off to skip the relay fee — you'll sign the mint on Base yourself and need a little ETH for gas.")).toBeInTheDocument();
    fireEvent.click(relayer);
    expect(relayer).not.toBeChecked();
    expect(screen.getByText("Turn on to let Circle's relayer mint on Base for a small fee — no ETH needed there.")).toBeInTheDocument();
    expect(screen.queryByText(/Turn off to skip the relay fee/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    expect(screen.queryByText(/Turn (off|on) to/)).not.toBeInTheDocument();
    expect(screen.getByText("EURC is always delivered by Circle's relayer. Its fee is part of Circle's quote, so you only sign on Ethereum.")).toBeInTheDocument();
  });
  it("calculates wallet-free EURC and USDC self-mint totals using fallback gas", async () => {
    localStorage.removeItem("nsb.wallet.evm");
    vi.mocked(estimateWithoutWallet).mockResolvedValueOnce({ gasFees: [], fees: [{ type: "provider", token: "ETH", amount: "0.003" }], quote: { totalAmount: "3000", items: [{ type: "FORWARD", amount: "2000" }, { type: "PRE_FINALITY", amount: "1000" }] } } as any);
    mount();
    await screen.findByLabelText("You send");
    fireEvent.click(screen.getByRole("radio", { name: "EURC" }));
    fireEvent.change(screen.getByLabelText("You send"), { target: { value: "10" } });
    const receipt = screen.getByLabelText("Receipt");
    await waitFor(() => expect(within(receipt).getByText("≈ $8.49")).toBeInTheDocument(), { timeout: 4000 });
    expect(estimateWithoutWallet).toHaveBeenLastCalledWith(expect.objectContaining({ token: "EURC", relayer: true }));
    expect(within(receipt).getByText("≈ 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "USDC" }));
    fireEvent.click(screen.getByRole("switch", { name: "Circle relayer mints for me" }));
    await waitFor(() => expect(within(receipt).getByText("≈ $2.08")).toBeInTheDocument(), { timeout: 4000 });
    expect(estimateWithoutWallet).toHaveBeenLastCalledWith(expect.objectContaining({ token: "USDC", relayer: false }));
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
  });
  it("estimates without a wallet and with an insufficient connected balance", async () => {
    localStorage.removeItem("nsb.wallet.evm");
    mount();
    fireEvent.change(await screen.findByLabelText("You send"), { target: { value: "600" } });
    await waitFor(() => expect(estimateWithoutWallet).toHaveBeenCalled(), { timeout: 4000 });
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "EVM wallet" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Test wallet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Not enough USDC" })).toBeDisabled());
    await waitFor(() => expect(fixtures.kit.estimate).toHaveBeenCalled(), { timeout: 4000 });
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
  });
  it("hides Resume for legacy entries and supports immediate removal with Undo", async () => {
    const [source, destination] = fixtures.kit.getSupportedChains();
    localStorage.setItem("nsb.history.v1", JSON.stringify([{ id: "legacy", createdAt: 123, network: "mainnet", result: { state: "error", provider: "CCTPXBridgingProvider", token: "EURC", amount: "100", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: true }, steps: [{ name: "transfer", state: "pending" }] } }]));
    mount();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resume transfer" })).not.toBeInTheDocument());
    fireEvent.keyDown(await screen.findByRole("button", { name: "More: 100 EURC" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from history" }));
    expect(loadHistory()).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(loadHistory().map((h) => h.id)).toEqual(["legacy"]);
  });
  it("requires confirmation before removing an incomplete source transaction", async () => {
    const [source, destination] = fixtures.kit.getSupportedChains();
    localStorage.setItem("nsb.history.v1", JSON.stringify([{ id: "saved", createdAt: 123, network: "mainnet", result: { state: "pending", provider: "CCTPXBridgingProvider", token: "EURC", amount: "100", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: true }, steps: [{ name: "transfer", state: "success", txHash: "0xburn" }] } }]));
    mount();
    fireEvent.keyDown(await screen.findByRole("button", { name: "More: 100 EURC" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from history" }));
    const dialog = screen.getByRole("dialog");
    expect(loadHistory()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));
    expect(loadHistory()).toHaveLength(1);
  });
  it("falls back to the estimate adapter after a wallet simulation failure without executing a transfer", async () => {
    fixtures.kit.estimate.mockRejectedValueOnce(new Error("Insufficient funds for simulation"));
    mount();
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("You send"), { target: { value: "600" } });
    await waitFor(() => expect(estimateWithoutWallet).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.getByRole("button", { name: "Not enough USDC" })).toBeDisabled();
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
  });
  it("marks unsupported saved retries unknown instead of reporting a failed transfer", async () => {
    const [source, destination] = fixtures.kit.getSupportedChains();
    localStorage.setItem("nsb.history.v1", JSON.stringify([{ id: "unsupported", createdAt: 123, network: "mainnet", result: { state: "pending", provider: "CCTPXBridgingProvider", token: "EURC", amount: "100", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: true }, steps: [{ name: "transfer", state: "success", txHash: "0xburn" }] } }]));
    mount();
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Resume transfer" }));
    await waitFor(() => expect(fixtures.transfers).toHaveLength(1));
    await act(async () => { fixtures.transfers[0]?.reject(new Error("RETRY_NOT_SUPPORTED: no source transaction hash")); });
    expect(loadHistory()[0]?.resumeUnsupported).toBe(true);
    expect(loadHistory()[0]?.result.state).toBe("pending");
    expect(screen.queryByRole("button", { name: "Resume transfer" })).not.toBeInTheDocument();
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
  });
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
    const balanceReads = vi.mocked(fetchBalances).mock.calls.length;
    await act(async () => { fixtures.transfers[0]?.resolve(final); });
    await waitFor(() => expect(vi.mocked(fetchBalances).mock.calls.length).toBeGreaterThan(balanceReads));
    expect(loadHistory().find((h) => h.id === first.id)?.result.state).toBe("success");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(loadHistory().find((h) => h.id === second.id)?.result.state).toBe("pending");
    const receipt = screen.getByLabelText("Receipt");
    expect(within(receipt).getByText("50 EURC")).toBeInTheDocument();
    expect(within(receipt).queryByText("Transfer complete")).not.toBeInTheDocument();
  });
  it("resumes saved EURC via retry with the existing entry trace ID", async () => {
    const [source, destination] = fixtures.kit.getSupportedChains();
    localStorage.setItem("nsb.history.v1", JSON.stringify([{ id: "saved", createdAt: 123, network: "mainnet", result: { state: "pending", provider: "CCTPXBridgingProvider", token: "EURC", amount: "100", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: false }, steps: [{ name: "approve", state: "success" }, { name: "transfer", state: "success", txHash: "0xoldburn" }] } }]));
    mount();
    await waitFor(() => expect(fixtures.provider.request).toHaveBeenCalledWith({ method: "eth_accounts" }));
    await waitFor(() => expect(screen.getByLabelText(/Test wallet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Resume transfer" }));
    await waitFor(() => expect(fixtures.kit.retry).toHaveBeenCalled());
    expect(fixtures.kit.retry.mock.calls[0]?.[2]).toEqual({ traceId: "saved" });
    expect(fixtures.kit.retry.mock.calls[0]?.[0].destination.useForwarder).toBe(true);
    expect(fixtures.kit.bridge).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Resume transfer" })).not.toBeInTheDocument();
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
    expect(loadHistory().find((h) => h.id === first.id)?.result.steps.find((s) => s.name === "transfer")).toMatchObject({ state: "success", txHash: "0xretained" });
    expect(loadHistory().find((h) => h.id === first.id)?.result.steps.find((s) => s.name === "fetchAttestation")?.state).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
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
  it("links to the public source repository from header, settings and footer", async () => {
    mount();
    const repo = "https://github.com/asluchevskiy/native-stablecoin-bridge";
    const header = screen.getByRole("link", { name: "Source code on GitHub" });
    expect(header).toHaveAttribute("href", repo);
    expect(header).toHaveAttribute("target", "_blank");
    expect(header).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(header).getByRole("presentation")).toBeInTheDocument();
    const footer = screen.getByRole("link", { name: "Open source on GitHub" });
    expect(footer).toHaveAttribute("href", repo);
    expect(footer).toHaveAttribute("rel", expect.stringContaining("noopener"));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const popover = await screen.findByRole("dialog");
    const row = within(popover).getByRole("link", { name: "Source code on GitHub" });
    expect(row).toHaveAttribute("href", repo);
    expect(row).toHaveAttribute("target", "_blank");
  });
});