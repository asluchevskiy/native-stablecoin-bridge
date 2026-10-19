import type { ChainDefinition } from "@circle-fin/bridge-kit";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, type Address } from "viem";

export type Token = "USDC" | "EURC";

type Loose = {
  chain: string;
  name: string;
  type: string;
  chainId?: number;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerUrl: string;
  rpcEndpoints: string[];
  usdcAddress: string | null;
  eurcAddress?: string | null;
  cctp?: { domain?: number; forwarderSupported?: { source?: boolean; destination?: boolean } } | null;
  cctpx?: unknown;
};
export const L = (c: ChainDefinition) => c as unknown as Loose;

export const tokenAddress = (c: ChainDefinition, t: Token) =>
  t === "USDC" ? L(c).usdcAddress : (L(c).eurcAddress ?? null);

export const nativeIsUsdc = (c: ChainDefinition) => L(c).nativeCurrency?.symbol === "USDC";
export const forwarderDest = (c: ChainDefinition) => !!L(c).cctp?.forwarderSupported?.destination;
export const explorerTx = (c: ChainDefinition | undefined, hash?: string) =>
  c && hash && L(c).explorerUrl ? L(c).explorerUrl.replace("{hash}", hash) : undefined;

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isSolanaAddress(a: string) {
  if (!B58.test(a)) return false;
  // decode base58 length check (32 bytes)
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of a) n = n * 58n + BigInt(alphabet.indexOf(ch));
  let bytes = 0;
  while (n > 0n) { n >>= 8n; bytes++; }
  for (const ch of a) { if (ch === "1") bytes++; else break; }
  return bytes === 32;
}
export const isValidRecipient = (c: ChainDefinition, a: string) =>
  L(c).type === "solana" ? isSolanaAddress(a) : isAddress(a);

export interface Balances { token: string | null; native: string | null; nativeSymbol: string; decimals: number }

async function solRpc(url: string, method: string, params: unknown[]) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "RPC error");
  return j.result;
}

export async function fetchBalances(c: ChainDefinition, token: Token, owner: string): Promise<Balances> {
  const d = L(c);
  const rpc = d.rpcEndpoints?.[0];
  if (!rpc) throw new Error("No RPC");
  const addr = tokenAddress(c, token);
  if (d.type === "solana") {
    const [lamports, accts] = await Promise.all([
      solRpc(rpc, "getBalance", [owner]),
      addr ? solRpc(rpc, "getParsedTokenAccountsByOwner", [owner, { mint: addr }, { encoding: "jsonParsed" }]) : null,
    ]);
    let total = 0;
    let decimals = 6;
    for (const a of accts?.value ?? []) {
      const ta = a.account.data.parsed.info.tokenAmount;
      total += Number(ta.uiAmountString ?? ta.uiAmount ?? 0);
      decimals = ta.decimals;
    }
    return { token: addr ? String(total) : null, native: formatUnits(BigInt(lamports.value), 9), nativeSymbol: d.nativeCurrency.symbol, decimals };
  }
  const client = createPublicClient({ transport: http(rpc) });
  const [native, bal, decimals] = await Promise.all([
    client.getBalance({ address: owner as Address }),
    addr ? client.readContract({ address: addr as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] }) : null,
    addr ? client.readContract({ address: addr as Address, abi: erc20Abi, functionName: "decimals" }) : 6,
  ]);
  return {
    token: bal === null ? null : formatUnits(bal, Number(decimals)),
    native: formatUnits(native, d.nativeCurrency.decimals),
    nativeSymbol: d.nativeCurrency.symbol,
    decimals: Number(decimals),
  };
}

export function fmt(v: string | number | null | undefined, max = 6) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export function badgeHue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
