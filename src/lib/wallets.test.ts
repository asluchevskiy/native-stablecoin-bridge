import { afterEach, expect, it, vi } from "vitest";
import { discoverEvmWallets, getSolanaWallet, rememberWallet, rememberedWallet } from "./wallets";
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
it("discovers and remembers an EIP-6963 wallet by stable rdns rather than its UUID", () => {
  const onChange = vi.fn();
  const stop = discoverEvmWallets(onChange);
  const provider = { request: vi.fn() };
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "session-uuid", rdns: "io.metamask", name: "MetaMask", icon: "icon" }, provider } }));
  expect(onChange.mock.calls[0]?.[0]?.[0]?.rdns).toBe("io.metamask");
  rememberWallet("evm", "io.metamask");
  expect(rememberedWallet("evm")).toBe("io.metamask");
  rememberWallet("evm", null);
  expect(rememberedWallet("evm")).toBeNull();
  stop();
});
it("restores only the remembered Solana provider and clears its identity on disconnect", async () => {
  const phantom = { connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => "address" } }) };
  const solflare = { connect: vi.fn() };
  vi.stubGlobal("window", { phantom: { solana: phantom }, solflare });
  rememberWallet("solana", "phantom");
  const wallet = getSolanaWallet(rememberedWallet("solana") ?? undefined);
  await wallet?.provider.connect({ onlyIfTrusted: true });
  expect(phantom.connect).toHaveBeenCalledWith({ onlyIfTrusted: true });
  expect(solflare.connect).not.toHaveBeenCalled();
  rememberWallet("solana", null);
  expect(rememberedWallet("solana")).toBeNull();
});