import type { ComponentType } from "react";
import {
  NetworkEthereum, NetworkBase, NetworkArbitrumOne, NetworkOptimism, NetworkPolygon, NetworkAvalanche,
  NetworkSolana, NetworkLinea, NetworkUnichain, NetworkSonic, NetworkSeiNetwork, NetworkWorld, NetworkInk,
  NetworkPlume, NetworkMonad, NetworkHyperEvm, NetworkXdc, NetworkXLayer, NetworkCodex, NetworkCronos,
  NetworkInjective, NetworkPlasma, NetworkArc,
} from "@web3icons/react";

type IconC = ComponentType<{ size?: number | string; variant?: "branded" | "mono" | "background"; className?: string; style?: React.CSSProperties }>;

const MAP: Record<string, IconC> = {
  Ethereum: NetworkEthereum, Base: NetworkBase, Arbitrum: NetworkArbitrumOne, Optimism: NetworkOptimism,
  Polygon: NetworkPolygon, Avalanche: NetworkAvalanche, Solana: NetworkSolana, Linea: NetworkLinea,
  Unichain: NetworkUnichain, Sonic: NetworkSonic, Sei: NetworkSeiNetwork, World_Chain: NetworkWorld,
  Ink: NetworkInk, Plume: NetworkPlume, Monad: NetworkMonad, HyperEVM: NetworkHyperEvm, XDC: NetworkXdc,
  X_Layer: NetworkXLayer, Codex: NetworkCodex, Cronos: NetworkCronos, Injective: NetworkInjective,
  Plasma: NetworkPlasma, Arc: NetworkArc,
};

// Glyphs drawn as full squares: scale up so they fill the round medallion.
const FILL_SCALE: Record<string, number> = { Base: 1.42, X_Layer: 1.42 };

const SUFFIX = /_(Amoy_Testnet|Sepolia|Testnet|Fuji|Amoy|Devnet|Apothem|Hoodi)$/;
export const baseChainId = (id: string) => id.replace(SUFFIX, "");

export function ChainIcon({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const key = baseChainId(id);
  const Icon = MAP[key];
  const scale = FILL_SCALE[key] ?? 1;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sheet ring-1 ring-rule [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {Icon ? (
        <Icon size={size} variant="branded" className="shrink-0" {...(scale !== 1 ? { style: { transform: `scale(${scale})` } } : {})} />
      ) : (
        <span className="flex size-full items-center justify-center bg-tint font-display font-semibold text-ink-2" style={{ fontSize: Math.round(size * 0.42) }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
