import type { ChainDefinition } from "@circle-fin/bridge-kit";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits, type Address } from "viem";
import { L, tokenAddress, type Token } from "./chains";

// Bridge Kit 1.15.3 EVM gas constants for USDC; EURC crossChainTransfer median
// observed on Ethereum (~338k, range 333k–355k), rounded to 340k; typical ERC20 approve.
export const GAS_UNITS = { eurcTransfer: 340_000, usdcBurn: 169_914, usdcForwardBurn: 201_525, usdcMint: 237_401, approval: 56_000 } as const;
export type GasEstimate = { amount: number; estimated: true; includesApproval: boolean };
export type GasFallbacks = Record<string, GasEstimate | undefined>;
export function typicalGasUnits(token: Token, source: boolean, relayer: boolean, approval: boolean): number {
  return (source ? token === "EURC" ? GAS_UNITS.eurcTransfer : relayer ? GAS_UNITS.usdcForwardBurn : GAS_UNITS.usdcBurn : GAS_UNITS.usdcMint)
    + (source && approval ? GAS_UNITS.approval : 0);
}

const gasPrices = new Map<string, { expires: number; price: Promise<bigint> }>();
type Deployment = { domainId: number; tokenAddress: string; tokenManagerAddress: string; enabled: boolean };
type RegistryToken = { symbol: string; deployments: Deployment[] };
const registries = new Map<boolean, Promise<RegistryToken[]>>();
async function eurcSpender(chain: ChainDefinition, testnet: boolean): Promise<Address | undefined> {
  let registry = registries.get(testnet);
  if (!registry) {
    registry = (async () => {
      const iris = testnet ? "https://iris-api-sandbox.circle.com" : "https://iris-api.circle.com";
      const tokens: RegistryToken[] = [];
      let cursor: string | undefined;
      do {
        const response = await fetch(`${iris}/v2/cctpx/tokens${cursor ? `?pageAfter=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("Circle token registry unavailable");
        const page = await response.json() as { data: RegistryToken[]; nextPageAfter?: string };
        if (!Array.isArray(page.data)) throw new Error("Invalid Circle token registry");
        tokens.push(...page.data);
        cursor = page.nextPageAfter || undefined;
      } while (cursor);
      return tokens;
    })();
    registries.set(testnet, registry);
    registry.catch(() => registries.delete(testnet));
  }
  const tokens = await registry;
  return tokens.find((t) => t.symbol === "EURC")?.deployments.find((d) => d.enabled && Number(d.domainId) === L(chain).cctp?.domain)?.tokenManagerAddress as Address | undefined;
}

/** Read-only, client-side fallback; no simulation, wallet request, or signing. */
export async function estimateGasFallback(input: { chain: ChainDefinition; token: Token; amount: string; source: boolean; relayer: boolean; owner?: string; testnet: boolean }): Promise<GasEstimate | undefined> {
  const { chain, token, source, owner, testnet } = input;
  const d = L(chain);
  const rpc = d.rpcEndpoints[0];
  if (d.type !== "evm" || !rpc) return undefined;
  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 0 }) });
  const key = `${d.chain}:${rpc}`;
  let saved = gasPrices.get(key);
  if (!saved || saved.expires <= Date.now()) {
    const price = client.getGasPrice();
    saved = { expires: Date.now() + 30_000, price };
    gasPrices.set(key, saved);
    price.catch(() => gasPrices.delete(key));
  }
  let gasPrice: bigint;
  try { gasPrice = await saved.price; } catch { return undefined; }
  let approval = source;
  if (source && owner) {
    try {
      const spender = token === "EURC" ? await eurcSpender(chain, testnet) : d.cctp?.contracts?.v2?.tokenMessenger;
      const address = tokenAddress(chain, token);
      if (spender && address) {
        const allowance = await client.readContract({ address: address as Address, abi: erc20Abi, functionName: "allowance", args: [owner as Address, spender as Address] });
        approval = allowance < parseUnits(input.amount, 6);
      }
    } catch { /* Conservatively include approval when allowance cannot be read. */ }
  }
  const units = typicalGasUnits(token, source, input.relayer, approval);
  return { amount: Number(formatUnits(BigInt(units) * gasPrice, d.nativeCurrency.decimals)), estimated: true, includesApproval: approval };
}