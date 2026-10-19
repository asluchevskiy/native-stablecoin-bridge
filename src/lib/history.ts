import type { BridgeResult } from "@circle-fin/bridge-kit";

export interface HistoryEntry {
  id: string;
  network: "mainnet" | "testnet";
  createdAt: number;
  result: BridgeResult<string>;
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
