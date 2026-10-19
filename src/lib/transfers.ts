import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";
import { explorerTx } from "./chains";

export type Result = BridgeResult<string>;
export type TransferStep = Result["steps"][number];
export type StepTiming = { start: number; end?: number };
export type StepTimings = Record<string, StepTiming>;
export type DisplayStep = TransferStep & { future?: boolean; timing?: StepTiming | undefined };

type EventPayload = {
  traceId?: string; protocol?: string; method?: string;
  values?: {
    name?: string; state?: TransferStep["state"]; txHash?: string; explorerUrl?: string; data?: unknown;
    transactionHash?: string; status?: string; attestation?: unknown; forwardState?: string; errorDetails?: unknown;
  };
};

/** Normalize the two protocol contracts without losing retry-critical attestation data. */
export function normalizeStepEvent(payload: unknown, id: string, source: ChainDefinition, destination: ChainDefinition): TransferStep | undefined {
  const p = payload as EventPayload;
  if (p.traceId !== id) return;
  const v = p.values ?? {};
  const name = p.protocol === "cctpx" ? p.method : v.name ?? p.method;
  if (!name) return;
  if (p.protocol !== "cctpx") {
    return { name, state: v.state ?? "pending", ...(v.txHash ? { txHash: v.txHash } : {}),
      ...(v.explorerUrl ? { explorerUrl: v.explorerUrl } : {}), ...(v.data !== undefined ? { data: v.data } : {}) };
  }
  let state: TransferStep["state"] = "pending";
  let data: unknown;
  let errorMessage: string | undefined;
  if (["approve", "approveFee", "transfer", "mint"].includes(name)) state = "success";
  else if (name === "fetchAttestation") {
    state = String(v.status).toLowerCase() === "complete" ? "success" : "pending";
    data = v.attestation;
  } else if (name === "forward") {
    const status = v.forwardState?.toUpperCase();
    if (status === "CONFIRMED" || status === "COMPLETE") state = "success";
    else if (status === "FAILED") {
      state = "error";
      errorMessage = typeof v.errorDetails === "string" ? v.errorDetails : JSON.stringify(v.errorDetails ?? "Relayer failed");
    }
  }
  const txHash = v.transactionHash;
  const explorerUrl = explorerTx(["forward", "mint"].includes(name) ? destination : source, txHash);
  return { name, state, ...(txHash ? { txHash } : {}), ...(explorerUrl ? { explorerUrl } : {}),
    ...(data !== undefined ? { data } : {}), ...(errorMessage ? { errorMessage, error: v.errorDetails } : {}) };
}

export const completedStep = (s: TransferStep) => s.state === "success" || s.state === "noop";

export function expectedStepNames(result: Result): string[] {
  const names = result.token === "EURC"
    ? ["approve", ...(result.steps.some((s) => s.name === "approveFee") ? ["approveFee"] : []), "transfer", "fetchAttestation", result.destination.useForwarder ? "forward" : "mint"]
    : ["approve", "burn", "fetchAttestation", "mint"];
  // Keep auxiliary and future SDK steps visible without replacing the known sequence.
  for (const s of result.steps) if (!names.includes(s.name)) names.splice(Math.max(0, names.length - 1), 0, s.name);
  return names;
}

export function mergeTransferSteps(previous: TransferStep[], incoming: TransferStep[]): TransferStep[] {
  const out = [...previous];
  for (const step of incoming) {
    const index = out.findIndex((s) => s.name === step.name);
    const old = out[index];
    if (old) out[index] = { ...old, ...step, state: completedStep(old) && step.state === "pending" ? old.state : step.state };
    else out.push(step);
  }
  return out;
}

export function displaySteps(result: Result, timings: StepTimings = {}): DisplayStep[] {
  const names = expectedStepNames(result);
  const lastCompleted = names.reduce((last, name, i) => result.steps.some((s) => s.name === name && completedStep(s)) ? i : last, -1);
  // Providers can skip an already-approved allowance without emitting an action.
  const steps = names.map((name, i) => result.steps.find((s) => s.name === name) ?? { name, state: i < lastCompleted || result.state === "success" ? "noop" as const : "pending" as const });
  const current = steps.findIndex((s) => !completedStep(s));
  return steps.map((s, i) => ({ ...s, future: i > current && !completedStep(s) && s.state !== "error", timing: timings[s.name] }));
}

export function updateStepTimings(result: Result, previous: StepTimings, now: number): StepTimings {
  const next = { ...previous };
  for (const s of displaySteps(result)) {
    if (s.future) continue;
    const old = next[s.name];
    const terminal = completedStep(s) || s.state === "error";
    if (old?.end !== undefined && !terminal) next[s.name] = { start: now };
    else next[s.name] = { start: old?.start ?? now, ...(terminal ? { end: old?.end ?? now } : {}) };
  }
  return next;
}

export function transferProgress(result: Result) {
  const steps = displaySteps(result);
  return steps.filter(completedStep).length / steps.length;
}

export function sourceComplete(result: Result) {
  return result.steps.some((s) => ["burn", "transfer"].includes(s.name) && completedStep(s));
}

export function receivedAmount(result: Result) {
  const fees = (result as Result & { fees?: { token: string; amount: string }[] }).fees ?? [];
  return Math.max(0, Number(result.amount) - fees.filter((f) => f.token === result.token).reduce((sum, f) => sum + Number(f.amount), 0));
}