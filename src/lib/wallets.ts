export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, h: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, h: (...a: unknown[]) => void) => void;
}
export interface EvmWalletInfo { uuid: string; name: string; icon?: string; provider: Eip1193 }

export function discoverEvmWallets(onChange: (list: EvmWalletInfo[]) => void) {
  const map = new Map<string, EvmWalletInfo>();
  const handler = (ev: Event) => {
    const d = (ev as CustomEvent).detail as { info: { uuid: string; name: string; icon: string }; provider: Eip1193 };
    if (!d?.info?.uuid) return;
    map.set(d.info.uuid, { uuid: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
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
  connect: () => Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect?: () => Promise<void>;
  publicKey?: { toString(): string } | null;
}

export function getSolanaProvider(): SolProvider | null {
  const w = window as unknown as Record<string, { solana?: SolProvider } & SolProvider>;
  return (w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null) as SolProvider | null;
}
