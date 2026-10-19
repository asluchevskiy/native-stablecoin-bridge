/** Informational CCTP attestation times, not transfer-speed configuration.
 * Source: https://developers.circle.com/cctp/concepts/finality-and-block-confirmations
 * Relayer/mint processing normally adds a few seconds.
 */
export type AttestationTime = { min: number; max?: number; unit: "second" | "minute" | "hour" };
type Timing = { standard: AttestationTime; fast?: AttestationTime };
const seconds = (min: number): AttestationTime => ({ min, unit: "second" });
const minutes = (min: number, max?: number): AttestationTime => ({ min, ...(max ? { max } : {}), unit: "minute" });
const rollup: Timing = { standard: minutes(15, 19), fast: seconds(8) };
const times: Record<string, Timing> = {
  Ethereum: { standard: minutes(15, 19), fast: seconds(20) },
  Arbitrum: rollup, Base: rollup, Codex: rollup, Optimism: rollup, Plume: rollup,
  Unichain: rollup, World_Chain: rollup, X_Layer: rollup,
  Edge: { standard: minutes(16, 21), fast: seconds(8) },
  Ink: { standard: minutes(30), fast: seconds(8) },
  Morph: { standard: minutes(20, 30), fast: seconds(8) },
  Linea: { standard: { min: 6, max: 32, unit: "hour" }, fast: seconds(8) },
  Arc: { standard: seconds(1) }, Avalanche: { standard: seconds(8) },
  Cronos: { standard: seconds(1) }, HyperEVM: { standard: seconds(5) },
  Injective: { standard: seconds(1) }, Monad: { standard: seconds(5) },
  Pharos: { standard: seconds(7) }, Plasma: { standard: seconds(1) },
  Polygon: { standard: seconds(8) }, Sei: { standard: seconds(5) },
  Solana: { standard: seconds(25), fast: seconds(8) },
  Sonic: { standard: seconds(8) }, XDC: { standard: seconds(10) },
};

export function mainnetTimingId(id: string): string {
  return id.replace(/_(?:Amoy_Testnet|Sepolia|Testnet|Fuji|Devnet|Apothem|Hoodi|Amoy)$/i, "");
}

export function arrivalInfo(id: string | undefined, fast: boolean) {
  const timing = id ? times[mainnetTimingId(id)] : undefined;
  return {
    time: fast ? timing?.fast ?? timing?.standard : timing?.standard,
    standardAlreadyFast: !!timing && !timing.fast,
    longStandard: timing?.standard.unit === "hour",
  };
}

/** SDK estimates/results use a warnings array; unknown payloads remain harmless. */
export function hasSpeedDowngrade(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const warnings = (value as { warnings?: unknown }).warnings;
  return Array.isArray(warnings) && warnings.some((w) =>
    w === "SPEED_DOWNGRADED" || (!!w && typeof w === "object" && (w as { code?: unknown }).code === "SPEED_DOWNGRADED"));
}