import type { BridgeResult } from "@circle-fin/bridge-kit";
import type { StepTimings } from "./transfers";

export interface HistoryEntry {
  id: string;
  network: "mainnet" | "testnet";
  createdAt: number;
  result: BridgeResult<string>;
  timings?: StepTimings;
  resumeUnsupported?: boolean;
}

export function sourceTransaction(result: BridgeResult<string>) {
  return result.steps.find((s) => ["burn", "transfer"].includes(s.name) && s.txHash);
}

export function destinationTransaction(result: BridgeResult<string>) {
  return result.steps.find((s) => ["mint", "forward"].includes(s.name) && s.txHash);
}

export function cannotResume(entry: HistoryEntry): boolean {
  return entry.result.state !== "success" && (!!entry.resumeUnsupported || entry.result.steps.some((s) => ["burn", "transfer"].includes(s.name) && !s.txHash));
}

export function isUnsupportedRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") return /RETRY_NOT_SUPPORTED|no source transaction hash/i.test(String(error));
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  return /RETRY_NOT_SUPPORTED|no source transaction hash/i.test(`${e.code ?? ""} ${e.message ?? ""}`) || (!!e.cause && e.cause !== error && isUnsupportedRetry(e.cause));
}

export function removalPolicy(entry: HistoryEntry, running: boolean): "blocked" | "confirm" | "immediate" {
  if (running) return "blocked";
  return entry.result.state !== "success" && sourceTransaction(entry.result) ? "confirm" : "immediate";
}

export function explorerAddress(entry: HistoryEntry): string | undefined {
  const { destination } = entry.result;
  const template = destination.chain.explorerUrl;
  const recipient = destination.recipientAddress || destination.address;
  return recipient && template.includes("/tx/{hash}") ? template.replace("/tx/{hash}", `/address/${encodeURIComponent(recipient)}`) : undefined;
}

export type RemovedEntry = { entry: HistoryEntry; index: number };
export function removeEntries(list: HistoryEntry[], ids: Set<string>): { remaining: HistoryEntry[]; removed: RemovedEntry[] } {
  return { remaining: list.filter((e) => !ids.has(e.id)), removed: list.flatMap((entry, index) => ids.has(entry.id) ? [{ entry, index }] : []) };
}

/** Merge Undo into the current list without discarding transfers added or updated since removal. */
export function restoreEntries(list: HistoryEntry[], removed: RemovedEntry[]): HistoryEntry[] {
  const restored = [...list];
  for (const { entry, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!restored.some((e) => e.id === entry.id)) restored.splice(Math.min(index, restored.length), 0, entry);
  }
  return restored;
}

const KEY = "nsb.history.v1";
const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: HistoryEntry[]) {
  try {
    // strip raw error objects which may be circular
    const safe = list.slice(0, 50).map((e) => ({
      ...e,
      result: { ...e.result, steps: e.result.steps.map(({ error: _e, ...s }) => s) },
    }));
    localStorage.setItem(KEY, JSON.stringify(safe, replacer));
  } catch {
    /* storage full or unavailable */
  }
}
