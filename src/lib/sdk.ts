// Browser-only lazy loader for Circle's Bridge Kit. Never import SDK runtime code statically.
import type { BridgeKit } from "@circle-fin/bridge-kit";

type SdkModule = typeof import("@circle-fin/bridge-kit");
let sdkPromise: Promise<{ sdk: SdkModule; kit: BridgeKit }> | null = null;

export function loadSdk() {
  if (typeof window === "undefined") throw new Error("SDK is browser-only");
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
  await import("./polyfills");
  const m = await import("@circle-fin/adapter-viem-v2");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return m.createViemAdapterFromProvider({ provider: provider as any });
}

export async function makeSolanaAdapter(provider: unknown) {
  await import("./polyfills");
  const m = await import("@circle-fin/adapter-solana");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return m.createSolanaAdapterFromProvider({ provider: provider as any });
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
