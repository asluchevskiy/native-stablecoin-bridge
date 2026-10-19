export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, h: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, h: (...a: unknown[]) => void) => void;
}
export interface EvmWalletInfo { uuid: string; rdns?: string; name: string; icon?: string; provider: Eip1193 }

export function discoverEvmWallets(onChange: (list: EvmWalletInfo[]) => void) {
  const map = new Map<string, EvmWalletInfo>();
  const handler = (ev: Event) => {
    const d = (ev as CustomEvent).detail as { info: { uuid: string; rdns?: string; name: string; icon: string }; provider: Eip1193 };
    if (!d?.info?.uuid) return;
    map.set(d.info.uuid, { uuid: d.info.uuid, rdns: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
    onChange([...map.values()]);
  };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const t = setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (map.size === 0 && eth) {
      map.set("injected", { uuid: "injected", name: "Browser wallet", provider: eth });
      onChange([...map.values()]);
    }
  }, 400);
  return () => {
    clearTimeout(t);
    window.removeEventListener("eip6963:announceProvider", handler);
  };
}

export interface SolProvider {
  connect: (options?: { onlyIfTrusted: boolean }) => Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect?: () => Promise<void>;
  publicKey?: { toString(): string } | null;
}

export type SolWalletName = "phantom" | "solflare" | "backpack" | "solana";
export function getSolanaWallet(name?: string): { name: SolWalletName; provider: SolProvider } | null {
  const w = window as unknown as { phantom?: { solana?: SolProvider }; solflare?: SolProvider; backpack?: SolProvider; solana?: SolProvider };
  const providers: [SolWalletName, SolProvider | undefined][] = [["phantom", w.phantom?.solana], ["solflare", w.solflare], ["backpack", w.backpack], ["solana", w.solana]];
  const match = providers.find(([key, provider]) => !!provider && (!name || key === name));
  return match?.[1] ? { name: match[0], provider: match[1] } : null;
}

export function rememberedWallet(ecosystem: "evm" | "solana") {
  try { return localStorage.getItem(`nsb.wallet.${ecosystem}`); } catch { return null; }
}
export function rememberWallet(ecosystem: "evm" | "solana", name: string | null) {
  try {
    if (name) localStorage.setItem(`nsb.wallet.${ecosystem}`, name);
    else localStorage.removeItem(`nsb.wallet.${ecosystem}`);
  } catch { /* unavailable storage must not affect connection */ }
}
