import { describe, expect, it } from "vitest";
import type { ChainDefinition } from "@circle-fin/bridge-kit";
import { displaySteps, expectedStepNames, mergeTransferSteps, normalizeStepEvent, sourceComplete, transferProgress, updateStepTimings, type Result } from "./transfers";
import { loadHistory, saveHistory } from "./history";

const source = { chain: "Ethereum", name: "Ethereum", explorerUrl: "https://source.example/tx/{hash}" } as unknown as ChainDefinition;
const destination = { chain: "Base", name: "Base", explorerUrl: "https://destination.example/tx/{hash}" } as unknown as ChainDefinition;
const base = (token = "EURC", relayer = true): Result => ({ state: "pending", token, amount: "100", provider: token === "EURC" ? "CCTPXBridgingProvider" : "CCTPV2BridgingProvider", source: { address: "sender", chain: source }, destination: { address: "recipient", chain: destination, useForwarder: relayer }, steps: [] }) as Result;
const normalize = (method: string, values: object) => normalizeStepEvent({ protocol: "cctpx", traceId: "one", method, values }, "one", source, destination);

describe("provider event normalization", () => {
  it.each(["approve", "approveFee", "transfer"])("persists completed EURC %s with its source transaction link", (method) => {
    expect(normalize(method, { transactionHash: "0xabc" })).toMatchObject({ name: method, state: "success", txHash: "0xabc", explorerUrl: "https://source.example/tx/0xabc" });
  });
  it("stores a complete EURC attestation in retry data", () => {
    expect(normalize("fetchAttestation", { status: "complete", attestation: "0xsigned" })).toMatchObject({ state: "success", data: "0xsigned" });
    expect(normalize("fetchAttestation", { status: "pending" })?.state).toBe("pending");
  });
  it.each(["CONFIRMED", "COMPLETE"])("marks %s forward complete on the destination", (forwardState) => {
    expect(normalize("forward", { forwardState, transactionHash: "0xmint" })).toMatchObject({ state: "success", txHash: "0xmint", explorerUrl: "https://destination.example/tx/0xmint" });
  });
  it.each(["PENDING", "SENT"])("keeps %s forward pending", (forwardState) => {
    expect(normalize("forward", { forwardState })?.state).toBe("pending");
  });
  it("retains relayer failure details", () => {
    expect(normalize("forward", { forwardState: "FAILED", errorDetails: "Destination unavailable" })).toMatchObject({ state: "error", errorMessage: "Destination unavailable" });
  });
  it("keeps re-attestation pending", () => expect(normalize("reAttest", {})?.state).toBe("pending"));
  it("preserves USDC event fields", () => {
    expect(normalizeStepEvent({ protocol: "cctp", traceId: "one", values: { name: "burn", state: "success", txHash: "hash", explorerUrl: "url", data: { nonce: 1n } } }, "one", source, destination)).toMatchObject({ name: "burn", state: "success", txHash: "hash", explorerUrl: "url", data: { nonce: 1n } });
  });
  it("never mixes events between concurrent transfers or untraced estimates", () => {
    expect(normalizeStepEvent({ protocol: "cctpx", traceId: "other", method: "transfer" }, "one", source, destination)).toBeUndefined();
    expect(normalizeStepEvent({ protocol: "cctpx", method: "transfer" }, "one", source, destination)).toBeUndefined();
  });
  it("round-trips an in-flight burn hash and attestation through browser history", () => {
    const r = base();
    const transfer = normalize("transfer", { transactionHash: "0xburn" });
    const attestation = normalize("fetchAttestation", { status: "complete", attestation: "0xattestation" });
    if (!transfer || !attestation) throw new Error("Missing normalized steps");
    r.steps = [transfer, { ...attestation, data: { attestation: "0xattestation", nonce: 7n } }];
    saveHistory([{ id: "one", network: "mainnet", createdAt: 123, result: r }]);
    expect(loadHistory()[0]?.result.steps).toEqual([transfer, { ...attestation, data: { attestation: "0xattestation", nonce: "7" } }]);
  });
});

describe("expected progress", () => {
  it("renders four USDC steps from confirmation", () => expect(expectedStepNames(base("USDC"))).toEqual(["approve", "burn", "fetchAttestation", "mint"]));
  it("adds EURC approveFee only when emitted and chooses self mint", () => {
    const r = base("EURC", false);
    expect(expectedStepNames(r)).toEqual(["approve", "transfer", "fetchAttestation", "mint"]);
    r.steps = [{ name: "approveFee", state: "success" }];
    expect(expectedStepNames(r)).toEqual(["approve", "approveFee", "transfer", "fetchAttestation", "mint"]);
  });
  it("starts attestation immediately after transfer and scales by completed steps", () => {
    const r = base();
    r.steps = [{ name: "approve", state: "success" }, { name: "transfer", state: "success", txHash: "burn" }];
    expect(sourceComplete(r)).toBe(true);
    expect(displaySteps(r).filter((s) => !s.future && s.state === "pending").map((s) => s.name)).toEqual(["fetchAttestation"]);
    expect(transferProgress(r)).toBe(0.5);
  });
  it("stops completed timers and does not start future timers", () => {
    const r = base();
    const initial = updateStepTimings(r, {}, 1000);
    expect(initial).toEqual({ approve: { start: 1000 } });
    r.steps = [{ name: "approve", state: "success" }];
    const next = updateStepTimings(r, initial, 3000);
    const later = updateStepTimings(r, next, 9000);
    expect(later.approve).toEqual({ start: 1000, end: 3000 });
    expect(later.transfer).toEqual({ start: 3000 });
    expect(later.fetchAttestation).toBeUndefined();
  });
  it("does not regress successful steps on a later pending event", () => {
    expect(mergeTransferSteps([{ name: "transfer", state: "success", txHash: "burn" }], [{ name: "transfer", state: "pending" }])[0]).toMatchObject({ state: "success", txHash: "burn" });
  });
});