import { describe, expect, it } from "vitest";
import { cannotResume, explorerAddress, isUnsupportedRetry, removalPolicy, removeEntries, restoreEntries, type HistoryEntry } from "./history";

const entry = (id: string, state = "pending", steps: object[] = []): HistoryEntry => ({ id, createdAt: 1, network: "mainnet", result: {
  state, amount: "100", token: "EURC", source: { chain: { explorerUrl: "https://source.example/tx/{hash}" } },
  destination: { address: "0xrecipient", chain: { explorerUrl: "https://base.example/tx/{hash}" }, useForwarder: true }, steps,
} } as HistoryEntry);

describe("history safety", () => {
  it("blocks removal while running even when completed", () => expect(removalPolicy(entry("a", "success"), true)).toBe("blocked"));
  it("removes completed transfers immediately", () => expect(removalPolicy(entry("a", "success", [{ name: "transfer", txHash: "0xburn" }]), false)).toBe("immediate"));
  it("removes entries with no transactions immediately", () => expect(removalPolicy(entry("a"), false)).toBe("immediate"));
  it("requires confirmation for incomplete source transactions", () => expect(removalPolicy(entry("a", "error", [{ name: "transfer", txHash: "0xburn" }]), false)).toBe("confirm"));
  it("restores multiple entries in their original positions", () => {
    const list = [entry("a"), entry("b"), entry("c"), entry("d")];
    const { remaining, removed } = removeEntries(list, new Set(["b", "d"]));
    expect(remaining.map((e) => e.id)).toEqual(["a", "c"]);
    expect(restoreEntries(remaining, removed).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("Undo retains concurrent updates and does not duplicate entries", () => {
    const a = entry("a"); const updated = entry("a", "success");
    const result = restoreEntries([updated, entry("new")], [{ entry: a, index: 0 }, { entry: entry("b"), index: 1 }]);
    expect(result.map((e) => e.id)).toEqual(["a", "b", "new"]);
    expect(result[0]?.result.state).toBe("success");
  });
  it("marks a legacy burn without its hash unresumable", () => expect(cannotResume(entry("a", "error", [{ name: "transfer", state: "pending" }]))).toBe(true));
  it("does not mark completed or hashed transfers unknown", () => {
    expect(cannotResume(entry("a", "success", [{ name: "burn" }]))).toBe(false);
    expect(cannotResume(entry("a", "pending", [{ name: "burn", txHash: "0xburn" }]))).toBe(false);
  });
  it("recognizes unsupported retry codes and nested missing-hash errors", () => {
    expect(isUnsupportedRetry({ code: "RETRY_NOT_SUPPORTED" })).toBe(true);
    expect(isUnsupportedRetry({ cause: new Error("no source transaction hash") })).toBe(true);
    expect(isUnsupportedRetry(new Error("RPC failed"))).toBe(false);
  });
  it("derives recipient address links only from supported explorer templates", () => {
    expect(explorerAddress(entry("a"))).toBe("https://base.example/address/0xrecipient");
    const e = entry("a"); e.result.destination.chain.explorerUrl = "https://explorer.example/transaction/{hash}";
    expect(explorerAddress(e)).toBeUndefined();
  });
});