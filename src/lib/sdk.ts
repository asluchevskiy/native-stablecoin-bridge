// Browser-only lazy loader for Circle's Bridge Kit. Never import SDK runtime code statically.
import type { BridgeKit, BridgeParams, ChainDefinition } from "@circle-fin/bridge-kit";

type SdkModule = typeof import("@circle-fin/bridge-kit");
let sdkPromise: Promise<{ sdk: SdkModule; kit: BridgeKit }> | null = null;

export function loadSdk() {
  if (import.meta.env.SSR || typeof window === "undefined") return Promise.reject(new Error("SDK is browser-only"));
  if (!sdkPromise) {
    sdkPromise = (async () => {
      await import("./polyfills");
      const sdk = await import("@circle-fin/bridge-kit");
      const kit = new sdk.BridgeKit({ disableErrorReporting: true });
      return { sdk, kit };
    })();
    sdkPromise.catch(() => (sdkPromise = null));
  }
  return sdkPromise;
}

export async function makeEvmAdapter(provider: unknown) {
  if (import.meta.env.SSR) throw new Error("browser-only");
  await import("./polyfills");
  const m = await import("@circle-fin/adapter-viem-v2");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return m.createViemAdapterFromProvider({ provider: provider as any });
}

export async function makeSolanaAdapter(provider: unknown) {
  if (import.meta.env.SSR) throw new Error("browser-only");
  await import("./polyfills");
  const m = await import("@circle-fin/adapter-solana");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return m.createSolanaAdapterFromProvider({ provider: provider as any });
}

let estimateAdapterPromise: Promise<Awaited<ReturnType<typeof makeEvmAdapter>>> | null = null;
const estimateOnlyAdapters = new WeakSet<object>();

export function assertTransferAdapter(adapter: object) {
  if (estimateOnlyAdapters.has(adapter)) throw new Error("Estimate-only adapter cannot bridge or retry");
}

/** Ephemeral signing-capable SDK adapter: stays private to this module and is ONLY used for estimate.
 * Never persist its key or return this adapter to a bridge/retry caller. */
export async function estimateWithoutWallet(input: { from: ChainDefinition; to: ChainDefinition; amount: string; token: string; fast: boolean; relayer: boolean; recipient?: string | undefined }) {
  if (import.meta.env.SSR || typeof window === "undefined") throw new Error("browser-only");
  if (input.from.type !== "evm") throw new Error("Estimate adapter requires an EVM source");
  if (!estimateAdapterPromise) {
    estimateAdapterPromise = (async () => {
      await import("./polyfills");
      const [{ createViemAdapterFromPrivateKey }, { generatePrivateKey }] = await Promise.all([
        import("@circle-fin/adapter-viem-v2"), import("viem/accounts"),
      ]);
      const adapter = createViemAdapterFromPrivateKey({ privateKey: generatePrivateKey() });
      estimateOnlyAdapters.add(adapter);
      return adapter;
    })();
    estimateAdapterPromise.catch(() => { estimateAdapterPromise = null; });
  }
  const adapter = await estimateAdapterPromise;
  const recipient = input.recipient || await adapter.getAddress(input.from);
  const { kit } = await loadSdk();
  return kit.estimate({
    from: { adapter, chain: input.from.chain },
    to: { adapter, chain: input.to.chain, recipientAddress: recipient, ...(input.relayer ? { useForwarder: true } : {}) },
    amount: input.amount, token: input.token, config: { transferSpeed: input.fast ? "FAST" : "SLOW" },
  } as BridgeParams);
}

export async function errMsg(e: unknown): Promise<string> {
  try {
    const { sdk } = await loadSdk();
    return sdk.getErrorMessage(e) || String(e);
  } catch {
    return e instanceof Error ? e.message : String(e);
  }
}

export function isUserRejection(e: unknown): boolean {
  const any = e as { code?: number; cause?: unknown; message?: string } | null;
  if (!any) return false;
  if (any.code === 4001) return true;
  const msg = String(any.message ?? e);
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(msg)) return true;
  return any.cause ? isUserRejection(any.cause) : false;
}
