import { useState } from "react";
import type { ChainDefinition } from "@circle-fin/bridge-kit";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, CircleX, Circle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { badgeHue, L } from "@/lib/chains";
import { stepLabel, useT } from "@/lib/i18n";
import type { BridgeResult } from "@circle-fin/bridge-kit";

export type Step = BridgeResult<string>["steps"][number];

export function ChainBadge({ name, size = 22 }: { name: string; size?: number }) {
  const h = badgeHue(name);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
      style={{ width: size, height: size, background: `oklch(0.42 0.08 ${h})`, color: `oklch(0.95 0.03 ${h})` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ChainSelect({
  chains,
  value,
  onChange,
  disabledReason,
  label,
}: {
  chains: ChainDefinition[];
  value?: ChainDefinition | undefined;
  onChange: (c: ChainDefinition) => void;
  disabledReason: (c: ChainDefinition) => string | null;
  label: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex w-full items-center gap-2.5 rounded-lg border bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? <ChainBadge name={L(value).name} /> : null}
          <span className="min-w-0 flex-1 truncate">{value ? L(value).name : t("selectChain")}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchChain")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            {chains.map((c) => {
              const reason = disabledReason(c);
              const item = (
                <CommandItem
                  key={L(c).chain}
                  value={L(c).name}
                  disabled={!!reason}
                  onSelect={() => {
                    if (reason) return;
                    onChange(c);
                    setOpen(false);
                  }}
                  className="gap-2.5"
                >
                  <ChainBadge name={L(c).name} size={20} />
                  <span className="flex-1 truncate">{L(c).name}</span>
                  {value && L(value).chain === L(c).chain ? <Check className="size-4 text-primary" /> : null}
                </CommandItem>
              );
              return reason ? (
                <Tooltip key={L(c).chain}>
                  <TooltipTrigger asChild>
                    <div>{item}</div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{reason}</TooltipContent>
                </Tooltip>
              ) : (
                item
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("copy")}
      title={ok ? t("copied") : t("copy")}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }).catch(() => {});
      }}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
    >
      {ok ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function StepList({ steps, explorerFor }: { steps: Step[]; explorerFor: (s: Step) => string | undefined }) {
  const { t } = useT();
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const url = explorerFor(s);
        return (
          <li key={`${s.name}-${i}`} className="flex items-start gap-3 rounded-lg border bg-surface px-3 py-2.5">
            <span className="mt-0.5">
              {s.state === "success" || s.state === "noop" ? (
                <Check className="size-4 text-success" />
              ) : s.state === "error" ? (
                <CircleX className="size-4 text-destructive" />
              ) : s.state === "pending" ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : (
                <Circle className="size-4 text-muted-foreground" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{stepLabel(t, s.name)}</div>
              {s.txHash ? (
                <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="truncate">{s.txHash.slice(0, 10)}…{s.txHash.slice(-6)}</span>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      {t("explorer")} <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              ) : null}
              {s.state === "error" && s.errorMessage ? (
                <div className="mt-1 break-words text-xs text-destructive">{s.errorMessage}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
