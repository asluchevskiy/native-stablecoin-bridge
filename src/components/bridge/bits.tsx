import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { L } from "@/lib/chains";
import { stepLabel, useT } from "@/lib/i18n";
import type { DisplayStep } from "@/lib/transfers";
import { ChainIcon, baseChainId } from "./ChainIcon";

export type Step = BridgeResult<string>["steps"][number];

export function ChainMark({ chain, size = 28 }: { chain: ChainDefinition; size?: number }) {
  return <ChainIcon id={L(chain).chain} name={L(chain).name} size={size} />;
}

const POPULAR = ["Ethereum", "Base", "Arbitrum", "Solana", "Optimism", "Polygon", "Avalanche", "Arc"];

export function ChainField({
  label, chains, value, onChange, disabledReason,
}: {
  label: string;
  chains: ChainDefinition[];
  value?: ChainDefinition | undefined;
  onChange: (c: ChainDefinition) => void;
  disabledReason: (c: ChainDefinition) => string | null;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sorted = useMemo(() => {
    const rank = (c: ChainDefinition) => {
      const i = POPULAR.indexOf(baseChainId(L(c).chain));
      return i < 0 ? 99 : i;
    };
    return [...chains]
      .sort((a, b) => rank(a) - rank(b) || L(a).name.localeCompare(L(b).name))
      .filter((c) => L(c).name.toLowerCase().includes(q.trim().toLowerCase()));
  }, [chains, q]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setQ(""); setOpen(true); }}
        className="group flex w-full items-center gap-3 rounded-[12px] border border-rule bg-sheet px-3 py-2.5 text-left text-ink transition-colors hover:border-ink-2/40"
      >
        <span className="w-12 shrink-0 text-sm font-medium text-ink-2">{label}</span>
        {value ? <ChainMark chain={value} size={28} /> : null}
        <span className="min-w-0 flex-1 truncate text-base font-medium">{value ? L(value).name : t("selectChain")}</span>
        <ChevronDown className="size-4 text-ink-2" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 rounded-[20px] border-rule bg-sheet p-0 sm:max-w-[560px] max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:max-w-full">
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-lg font-semibold">{label}</DialogTitle>
            <DialogDescription className="sr-only">{t("selectChain")}</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-3">
            <label className="flex items-center gap-2 rounded-[12px] border border-rule px-3 focus-within:outline-2 focus-within:outline-primary focus-within:outline-offset-2">
              <Search className="size-4 text-ink-2" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("searchChain")}
                className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-2 focus-visible:outline-none"
              />
            </label>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-3 pb-4">
            {sorted.length === 0 ? <div className="px-2 py-6 text-center text-sm text-ink-2">{t("noResults")}</div> : null}
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {sorted.map((c) => {
                const reason = disabledReason(c);
                const selected = value && L(value).chain === L(c).chain;
                const btn = (
                  <button
                    type="button"
                    aria-disabled={!!reason}
                    onClick={() => { if (reason) return; onChange(c); setOpen(false); }}
                    className={`flex w-full items-center gap-2.5 rounded-[12px] border bg-sheet px-2.5 py-2.5 text-left text-sm text-ink transition-colors ${
                      selected ? "border-primary" : "border-transparent hover:bg-tint"
                    } ${reason ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    <ChainMark chain={c} size={28} />
                    <span className="min-w-0 flex-1 truncate font-medium">{L(c).name}</span>
                    {selected ? <Check className="size-4 text-primary" /> : null}
                  </button>
                );
                return reason ? (
                  <Tooltip key={L(c).chain}>
                    <TooltipTrigger asChild><div>{btn}</div></TooltipTrigger>
                    <TooltipContent>{reason}</TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={L(c).chain}>{btn}</div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={label ?? t("copy")}
      title={ok ? t("copied") : t("copy")}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }).catch(() => {});
      }}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-tint hover:text-ink"
    >
      {ok ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function Seg<T extends string>({
  value, options, onChange, disabled = false, label,
}: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="inline-flex rounded-[10px] border border-rule bg-sheet p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, node]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            value === v ? "bg-primary/12 text-ink ring-1 ring-primary/50" : "bg-transparent text-ink-2 hover:text-ink"
          }`}
        >
          {node}
        </button>
      ))}
    </div>
  );
}

export function RouteStrip({
  from, to, progress, active, error, label,
}: { from?: ChainDefinition | undefined; to?: ChainDefinition | undefined; progress: number; active: boolean; error?: boolean; label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        {from ? <ChainMark chain={from} size={44} /> : <span className="size-11 rounded-full bg-tint" />}
      </div>
      <div className="relative flex flex-1 items-center">
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-primary/25">
        <div
          className={`route-fill absolute inset-0 rounded-full ${error ? "bg-err" : "bg-primary"}`}
          style={{ transform: `scaleX(${progress})` }}
        />
        {active ? (
          <div className="route-pulse absolute top-0 h-full w-6 rounded-full bg-primary" style={{ left: `calc(${progress * 100}% - 12px)` }} />
        ) : null}
      </div>
      {label ? (
        <span className="num absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-rule bg-sheet px-2 py-0.5 text-xs font-semibold text-ink">
          {label}
        </span>
      ) : null}
      </div>
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        {to ? <ChainMark chain={to} size={44} /> : <span className="size-11 rounded-full bg-tint" />}
      </div>
    </div>
  );
}

function useStepClock(steps: DisplayStep[]) {
  const [, tick] = useState(0);
  const anyPending = steps.some((s) => !s.future && s.state === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyPending]);
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

export function StepTracker({ steps, explorerFor, showTimes = true, attestationHint }: { steps: DisplayStep[]; explorerFor: (s: Step) => string | undefined; showTimes?: boolean; attestationHint?: string }) {
  const { t } = useT();
  useStepClock(steps);
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const url = explorerFor(s);
        const tm = s.timing;
        const ok = s.state === "success" || s.state === "noop";
        const err = s.state === "error";
        const last = i === steps.length - 1;
        return (
          <li key={`${s.name}-${i}`} className="relative flex gap-3 pb-4">
            {!last ? <span className={`absolute left-[13px] top-7 bottom-0 w-px ${ok ? "bg-primary" : "bg-rule"}`} aria-hidden /> : null}
            <span
              className={`num relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                ok ? "border-primary bg-primary text-primary-foreground" : err ? "border-err text-err" : !s.future && s.state === "pending" ? "border-primary text-primary" : "border-rule text-ink-2"
              }`}
            >
              {ok ? <Check className="size-3.5" /> : !s.future && s.state === "pending" ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${s.future ? "text-ink-2" : ""}`}>{stepLabel(t, s.name)}</span>
                <span className="num ml-auto text-xs text-ink-2">{showTimes && tm ? fmtElapsed((tm.end ?? Date.now()) - tm.start) : ""}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" aria-label={`${stepLabel(t, s.name)}: ${t("explorer")}`} title={t("explorer")}
                    className="inline-flex size-7 items-center justify-center rounded-[8px] text-ink-2 hover:bg-tint hover:text-primary">
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
              {s.txHash ? <div className="num truncate text-xs text-ink-2">{s.txHash.slice(0, 10)}…{s.txHash.slice(-6)}</div> : null}
              {s.name === "fetchAttestation" && !s.future && !ok && !err && attestationHint ? <p className="mt-1 text-xs text-ink-2">{attestationHint}</p> : null}
              {err && s.errorMessage ? <div className="mt-1 break-words text-xs text-err">{s.errorMessage}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function BrandMark() {
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-ink" />
      <circle cx="18" cy="10" r="8" className="fill-primary" opacity="0.9" />
    </svg>
  );
}
