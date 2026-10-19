import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BridgeKit, BridgeParams, BridgeResult, ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { ArrowDownUp, ExternalLink, Info, Loader2, LogOut, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChainBadge, ChainSelect, CopyButton, StepList, type Step } from "./bits";
import { useT, stepLabel, type TKey } from "@/lib/i18n";
import {
  L, explorerTx, fetchBalances, fmt, forwarderDest, isValidRecipient, nativeIsUsdc, shortAddr, tokenAddress,
  type Balances, type Token,
} from "@/lib/chains";
import { discoverEvmWallets, getSolanaProvider, type Eip1193, type EvmWalletInfo, type SolProvider } from "@/lib/wallets";
import { errMsg, isUserRejection, loadSdk, makeEvmAdapter, makeSolanaAdapter } from "@/lib/sdk";
import { loadHistory, saveHistory, type HistoryEntry } from "@/lib/history";

type Network = "mainnet" | "testnet";
type Adapter = Awaited<ReturnType<typeof makeEvmAdapter>> | Awaited<ReturnType<typeof makeSolanaAdapter>>;
type Est = EstimateResult<string, string>;
type Result = BridgeResult<string>;
type Phase =
  | { kind: "form" }
  | { kind: "running"; entryId: string | null; steps: Step[]; result?: Result; token: string; amount: string; from: ChainDefinition; to: ChainDefinition }
  | { kind: "done"; entryId: string; result: Result }
  | { kind: "failed"; entryId: string | null; result?: Result | undefined; message: string; rejected: boolean; retryable: boolean };

const eurcCache = new Map<Network, Set<string>>();
const pairKey = (a: ChainDefinition, b: ChainDefinition) => `${L(a).chain}>${L(b).chain}`;
const AMOUNT_RE = /^\d*\.?\d*$/;

async function ensureEvmChain(provider: Eip1193, c: ChainDefinition) {
  const d = L(c);
  if (!d.chainId) return;
  const hex = `0x${d.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
    if (code === 4902 || /unrecognized|unknown chain|not added/i.test(String((e as Error).message))) {
      let explorer: string[] = [];
      try { explorer = [new URL(d.explorerUrl.replace("{hash}", "x")).origin]; } catch { /* ignore */ }
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: d.name, nativeCurrency: d.nativeCurrency, rpcUrls: d.rpcEndpoints.slice(0, 3), blockExplorerUrls: explorer }],
      });
    } else throw e;
  }
}

function mergeSteps(prev: Step[], incoming: Step[]) {
  const out = [...prev];
  for (const s of incoming) {
    const i = out.findIndex((p) => p.name === s.name);
    if (i >= 0) out[i] = { ...out[i], ...s };
    else out.push(s);
  }
  return out;
}

export function BridgeApp() {
  const { t, lang, setLang } = useT();
  const [network, setNetwork] = useState<Network>("mainnet");
  const [token, setToken] = useState<Token>("USDC");
  const [chains, setChains] = useState<ChainDefinition[]>([]);
  const [sdkState, setSdkState] = useState<"loading" | "ready" | "error">("loading");
  const [sdkErr, setSdkErr] = useState("");
  const [fromId, setFromId] = useState<string>();
  const [toId, setToId] = useState<string>();
  const [amount, setAmount] = useState("");
  const [fast, setFast] = useState(true);
  const [relayer, setRelayer] = useState(true);
  const [custom, setCustom] = useState(false);
  const [customAddr, setCustomAddr] = useState("");
  const [evmWallets, setEvmWallets] = useState<EvmWalletInfo[]>([]);
  const [evm, setEvm] = useState<{ info: EvmWalletInfo; address: string } | null>(null);
  const [sol, setSol] = useState<{ provider: SolProvider; address: string } | null>(null);
  const evmAdapter = useRef<Adapter | null>(null);
  const solAdapter = useRef<Adapter | null>(null);
  const [walletErr, setWalletErr] = useState("");
  const [balances, setBalances] = useState<{ data?: Balances | undefined; loading: boolean; error?: string | undefined }>({ loading: false });
  const [eurc, setEurc] = useState<{ status: "idle" | "loading" | "ready" | "error"; pairs: Set<string>; error?: string }>({ status: "idle", pairs: new Set() });
  const [eurcNonce, setEurcNonce] = useState(0);
  const [est, setEst] = useState<{ data?: Est | undefined; loading: boolean; error?: string | undefined }>({ loading: false });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [balNonce, setBalNonce] = useState(0);

  useEffect(() => setHistory(loadHistory()), []);
  useEffect(() => discoverEvmWallets(setEvmWallets), []);

  // Load chains from SDK
  useEffect(() => {
    let off = false;
    setSdkState("loading");
    loadSdk()
      .then(({ kit }) => {
        if (off) return;
        const list = kit.getSupportedChains({ isTestnet: network === "testnet" }).filter((c) => !!L(c).usdcAddress);
        list.sort((a, b) => L(a).name.localeCompare(L(b).name));
        setChains(list);
        const pick = (re: RegExp, fb: number) => (list.find((c) => re.test(L(c).chain)) ?? list[fb])?.chain;
        setFromId(pick(/^Ethereum/, 0));
        setToId(pick(/^Base/, 1));
        setSdkState("ready");
      })
      .catch(async (e) => {
        if (off) return;
        setSdkErr(await errMsg(e));
        setSdkState("error");
      });
    return () => { off = true; };
  }, [network]);

  const from = chains.find((c) => L(c).chain === fromId);
  const to = chains.find((c) => L(c).chain === toId);

  // EURC live routes
  const eurcCandidates = useMemo(
    () => chains.filter((c) => L(c).type === "evm" && !!L(c).cctpx && !!L(c).eurcAddress),
    [chains],
  );
  useEffect(() => {
    if (token !== "EURC" || sdkState !== "ready") return;
    const cached = eurcCache.get(network);
    if (cached) { setEurc({ status: "ready", pairs: cached }); return; }
    let off = false;
    setEurc({ status: "loading", pairs: new Set() });
    (async () => {
      try {
        const { kit } = await loadSdk();
        const provider = (kit.providers as unknown as { name: string; supportsRoute: (a: ChainDefinition, b: ChainDefinition, t: string) => boolean | Promise<boolean> }[])
          .find((p) => p.name === "CCTPXBridgingProvider");
        if (!provider) throw new Error("CCTPXBridgingProvider not found");
        const pairs = new Set<string>();
        const jobs: Promise<void>[] = [];
        for (const a of eurcCandidates) for (const b of eurcCandidates) {
          if (a === b) continue;
          jobs.push(Promise.resolve(provider.supportsRoute(a, b, "EURC")).then((ok) => { if (ok) pairs.add(pairKey(a, b)); }));
        }
        await Promise.all(jobs);
        eurcCache.set(network, pairs);
        if (!off) setEurc({ status: "ready", pairs });
      } catch (e) {
        if (!off) setEurc({ status: "error", pairs: new Set(), error: await errMsg(e) });
      }
    })();
    return () => { off = true; };
  }, [token, network, sdkState, eurcCandidates, eurcNonce]);

  const hasOut = useCallback((c: ChainDefinition) => [...eurc.pairs].some((p) => p.startsWith(`${L(c).chain}>`)), [eurc.pairs]);
  const hasIn = useCallback((c: ChainDefinition) => [...eurc.pairs].some((p) => p.endsWith(`>${L(c).chain}`)), [eurc.pairs]);

  // Snap to valid EURC route
  useEffect(() => {
    if (token !== "EURC" || eurc.status !== "ready" || eurc.pairs.size === 0) return;
    if (from && to && eurc.pairs.has(pairKey(from, to))) return;
    const first = [...eurc.pairs][0]!.split(">") as [string, string];
    const keepFrom = from && hasOut(from) ? L(from).chain : first[0];
    const dest = [...eurc.pairs].find((p) => p.startsWith(`${keepFrom}>`))!.split(">")[1];
    setFromId(keepFrom);
    setToId(dest);
  }, [token, eurc, from, to, hasOut]);

  const fromList = token === "USDC" ? chains : eurcCandidates;
  const fromDisabled = (c: ChainDefinition) => (token === "EURC" && !hasOut(c) ? t("noEurcRoute") : null);
  const toDisabled = (c: ChainDefinition) => {
    if (token !== "EURC") return null;
    if (!hasIn(c) || (from && !eurc.pairs.has(pairKey(from, c)) && L(from).chain !== L(c).chain)) return t("noEurcRoute");
    return null;
  };

  // Relayer default
  const relayerAvailable = !!to && forwarderDest(to);
  useEffect(() => { setRelayer(relayerAvailable); }, [relayerAvailable, toId]);

  const srcAddress = from ? (L(from).type === "solana" ? sol?.address : evm?.address) : undefined;
  const destAddress = to ? (L(to).type === "solana" ? sol?.address : evm?.address) : undefined;
  const srcAdapter = from ? (L(from).type === "solana" ? (sol ? solAdapter.current : null) : (evm ? evmAdapter.current : null)) : null;
  const destAdapter = to ? (L(to).type === "solana" ? (sol ? solAdapter.current : null) : (evm ? evmAdapter.current : null)) : null;
  const useRelayer = relayer && relayerAvailable;
  const needPaste = !destAddress;
  const showRecipientInput = custom || needPaste;
  const recipient = showRecipientInput ? customAddr.trim() : destAddress ?? "";

  // Balances
  useEffect(() => {
    if (!from || !srcAddress) { setBalances({ loading: false }); return; }
    if (!tokenAddress(from, token)) { setBalances({ loading: false, error: t("errToken") }); return; }
    let off = false;
    setBalances({ loading: true });
    fetchBalances(from, token, srcAddress)
      .then((data) => !off && setBalances({ loading: false, data }))
      .catch((e) => !off && setBalances({ loading: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) }));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, srcAddress, token, network, balNonce]);

  // Validation
  const validation = useMemo<TKey | null>(() => {
    if (!from || !to) return "selectChain";
    if (L(from).chain === L(to).chain) return "errSame";
    if (!tokenAddress(from, token) || !tokenAddress(to, token)) return "errToken";
    if (token === "EURC" && !eurc.pairs.has(pairKey(from, to))) return "noEurcRoute";
    if (!amount || !(Number(amount) > 0)) return "errAmount";
    if ((amount.split(".")[1] ?? "").length > 6) return "errDecimals";
    if (balances.data?.token != null && Number(amount) > Number(balances.data.token)) return "errBalance";
    if (showRecipientInput) {
      if (!recipient) return L(to).type === "solana" ? "needSolAddress" : "invalidAddress";
      if (!isValidRecipient(to, recipient)) return "invalidAddress";
    }
    if (!useRelayer && !destAdapter) return "needDestWallet";
    return null;
  }, [from, to, token, eurc.pairs, amount, balances.data, showRecipientInput, recipient, useRelayer, destAdapter]);

  const buildParams = useCallback((): BridgeParams | null => {
    if (!from || !to || !srcAdapter) return null;
    const recip = showRecipientInput ? recipient : undefined;
    const toPart = useRelayer
      ? destAdapter
        ? { adapter: destAdapter, chain: L(to).chain, ...(recip ? { recipientAddress: recip } : {}), useForwarder: true }
        : { chain: L(to).chain, recipientAddress: recip, useForwarder: true }
      : { adapter: destAdapter, chain: L(to).chain, ...(recip ? { recipientAddress: recip } : {}) };
    return {
      from: { adapter: srcAdapter, chain: L(from).chain },
      to: toPart,
      amount,
      token,
      config: { transferSpeed: fast ? "FAST" : "SLOW" },
    } as unknown as BridgeParams;
  }, [from, to, srcAdapter, destAdapter, showRecipientInput, recipient, useRelayer, amount, token, fast]);

  // Debounced estimate
  useEffect(() => {
    if (validation || !srcAdapter) { setEst({ loading: false }); return; }
    const params = buildParams();
    if (!params) return;
    let off = false;
    setEst((s) => ({ ...s, loading: true, error: undefined }));
    const timer = setTimeout(async () => {
      try {
        const { kit } = await loadSdk();
        const data = (await kit.estimate(params)) as Est;
        if (!off) setEst({ loading: false, data });
      } catch (e) {
        const m = await errMsg(e);
        if (!off) setEst({ loading: false, error: m });
      }
    }, 600);
    return () => { off = true; clearTimeout(timer); };
  }, [validation, srcAdapter, buildParams]);

  // Wallet actions
  async function connectEvm(w: EvmWalletInfo) {
    setWalletErr("");
    try {
      const accts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accts?.[0]) return;
      evmAdapter.current = await makeEvmAdapter(w.provider);
      setEvm({ info: w, address: accts[0] });
      w.provider.on?.("accountsChanged", (a: unknown) => {
        const list = a as string[];
        if (!list?.[0]) { setEvm(null); evmAdapter.current = null; }
        else setEvm((cur) => (cur ? { ...cur, address: list[0]! } : cur));
      });
    } catch (e) {
      setWalletErr(isUserRejection(e) ? t("rejected") : await errMsg(e));
    }
  }
  async function connectSol() {
    setWalletErr("");
    const p = getSolanaProvider();
    if (!p) { setWalletErr(t("noSolWallet")); return; }
    try {
      const r = await p.connect();
      const pk = (r && "publicKey" in r ? r.publicKey : null) ?? p.publicKey;
      if (!pk) return;
      solAdapter.current = await makeSolanaAdapter(p);
      setSol({ provider: p, address: pk.toString() });
    } catch (e) {
      setWalletErr(isUserRejection(e) ? t("rejected") : await errMsg(e));
    }
  }

  // History helpers
  const upsertHistory = (entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((e) => e.id !== entry.id)];
      saveHistory(next);
      return next;
    });
  };

  async function run(exec: (kit: BridgeKit) => Promise<Result>, ctx: { entryId: string | null; token: string; amount: string; from: ChainDefinition; to: ChainDefinition; network: Network; createdAt?: number | undefined; initialSteps?: Step[] | undefined }) {
    setConfirmOpen(false);
    setPhase({ kind: "running", entryId: ctx.entryId, steps: ctx.initialSteps ?? [], token: ctx.token, amount: ctx.amount, from: ctx.from, to: ctx.to });
    const { kit, sdk } = await loadSdk();
    const handler = (p: unknown) => {
      const pl = p as { method?: string; values?: { name?: string; state?: Step["state"]; txHash?: string; explorerUrl?: string } };
      const v = pl.values ?? {};
      const name = v.name ?? pl.method;
      if (!name) return;
      setPhase((ph) =>
        ph.kind === "running"
          ? { ...ph, steps: mergeSteps(ph.steps, [{ name, state: v.state ?? "pending", ...(v.txHash ? { txHash: v.txHash } : {}), ...(v.explorerUrl ? { explorerUrl: v.explorerUrl } : {}) }]) }
          : ph,
      );
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (kit as any).on("*", handler);
    try {
      const result = await exec(kit);
      const id = ctx.entryId ?? crypto.randomUUID();
      upsertHistory({ id, network: ctx.network, createdAt: ctx.createdAt ?? Date.now(), result });
      if (result.state === "success") setPhase({ kind: "done", entryId: id, result });
      else {
        const bad = result.steps.find((s) => s.state === "error");
        const rejected = isUserRejection(bad?.error) || /reject|denied/i.test(bad?.errorMessage ?? "");
        setPhase({
          kind: "failed", entryId: id, result, rejected,
          retryable: true,
          message: rejected ? t("rejected") : `${t("failedAt")}: ${stepLabel(t, bad?.name ?? "?")}${bad?.errorMessage ? ` — ${bad.errorMessage}` : ""}`,
        });
      }
      setBalNonce((n) => n + 1);
    } catch (e) {
      const rejected = isUserRejection(e);
      setPhase((ph) => ({
        kind: "failed", entryId: ctx.entryId, rejected,
        result: ph.kind === "running" ? ph.result : undefined,
        retryable: sdk.isRetryableError(e),
        message: rejected ? t("rejected") : sdk.getErrorMessage(e) || String(e),
      }));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (kit as any).off("*", handler);
    }
  }

  async function startBridge() {
    const params = buildParams();
    if (!params || !from || !to) return;
    const snapshot = { from, to, token, amount };
    await run(async (kit) => {
      if (L(from).type === "evm" && evm) await ensureEvmChain(evm.info.provider, from);
      return (await kit.bridge(params)) as Result;
    }, { entryId: null, token: snapshot.token, amount: snapshot.amount, from: snapshot.from, to: snapshot.to, network });
  }

  async function retryResult(result: Result, entryId: string | null, createdAt?: number, net: Network = network) {
    const srcType = L(result.source.chain).type;
    const dstType = L(result.destination.chain).type;
    const fromA = srcType === "solana" ? (sol ? solAdapter.current : null) : (evm ? evmAdapter.current : null);
    const toA = dstType === "solana" ? (sol ? solAdapter.current : null) : (evm ? evmAdapter.current : null);
    const needsTo = !result.destination.useForwarder;
    if (!fromA || (needsTo && !toA)) { setWalletErr(t("resumeNeedsWallet")); return; }
    await run(async (kit) => {
      if (srcType === "evm" && evm) {
        const pending = result.steps.some((s) => ["approve", "approveFee", "burn", "transfer"].includes(s.name) && s.state !== "success");
        if (pending) await ensureEvmChain(evm.info.provider, result.source.chain);
      }
      const ctx = toA ? { from: fromA, to: toA } : { from: fromA };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await kit.retry(result, ctx as any)) as Result;
    }, { entryId, token: result.token, amount: result.amount, from: result.source.chain, to: result.destination.chain, network: net, createdAt, initialSteps: result.steps });
  }

  const reset = () => { setPhase({ kind: "form" }); setAmount(""); setChecked(false); };

  const explorerFor = (chainsPair: { from?: ChainDefinition; to?: ChainDefinition }) => (s: Step) => {
    if (s.explorerUrl) return s.explorerUrl;
    const onDest = ["mint", "forward"].includes(s.name);
    return explorerTx(onDest ? chainsPair.to : chainsPair.from, s.txHash);
  };

  // Estimate summaries
  const feeRows = (est.data?.fees ?? []).filter((f) => f.amount && Number(f.amount) > 0);
  const totalFee = feeRows.filter((f) => f.token === token).reduce((s, f) => s + Number(f.amount), 0);
  const receive = amount && Number(amount) > 0 ? Math.max(0, Number(amount) - totalFee) : 0;
  const feeLabel = (type: string) => (type === "provider" ? t("protocolFee") : type === "forwarder" ? t("relayFee") : t("kitFee"));
  const gasRows = (est.data?.gasFees ?? []).filter((g) => g.fees).map((g) => {
    const c = chains.find((x) => L(x).chain === String(g.blockchain));
    const dec = c ? L(c).nativeCurrency.decimals : 18;
    const raw = g.fees?.fee ?? "0";
    return { name: g.name, chain: c ? L(c).name : String(g.blockchain), val: Number(raw) / 10 ** dec, sym: g.token };
  });

  const canBridge = !validation && !!srcAdapter && !!est.data && !est.loading && phase.kind === "form";
  const tokenIsNativeGas = !!from && nativeIsUsdc(from) && token === "USDC";

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden />
            <h1 className="text-sm font-semibold tracking-tight sm:text-base">{t("appName")}</h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Seg value={network} options={[["mainnet", t("mainnet")], ["testnet", t("testnet")]]} onChange={(v) => { if (phase.kind !== "running") { setNetwork(v as Network); setPhase({ kind: "form" }); } }} />
            <Seg value={lang} options={[["en", "EN"], ["ru", "RU"]]} onChange={(v) => setLang(v as "en" | "ru")} />
            {evm ? (
              <ConnectedPill label={evm.info.name} icon={evm.info.icon} address={evm.address} onDisconnect={() => { setEvm(null); evmAdapter.current = null; }} />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><Wallet className="size-4" />{t("connectEvm")}</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>{t("chooseWallet")}</DropdownMenuLabel>
                  {evmWallets.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{t("noEvmWallet")}</div>
                  ) : evmWallets.map((w) => (
                    <DropdownMenuItem key={w.uuid} onSelect={() => connectEvm(w)} className="gap-2">
                      {w.icon ? <img src={w.icon} alt="" className="size-5 rounded" /> : <Wallet className="size-4" />}
                      {w.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {sol ? (
              <ConnectedPill label="Solana" address={sol.address} onDisconnect={() => { sol.provider.disconnect?.().catch(() => {}); setSol(null); solAdapter.current = null; }} />
            ) : (
              <Button variant="outline" size="sm" onClick={connectSol}><Wallet className="size-4" />{t("connectSol")}</Button>
            )}
          </div>
        </div>
        {walletErr ? <div className="mx-auto max-w-5xl px-4 pb-2 text-xs text-destructive">{walletErr}</div> : null}
      </header>

      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 py-8">
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <Seg value={token} options={[["USDC", "USDC"], ["EURC", "EURC"]]} onChange={(v) => { if (phase.kind === "form") setToken(v as Token); }} />
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Info className="size-3.5" />{t("howItWorks")}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 text-sm leading-relaxed">{t("howBody")}</PopoverContent>
            </Popover>
          </div>

          {network === "testnet" ? (
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="mb-4 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-accent px-3 py-2 text-xs text-primary hover:underline">
              {t("faucet")} <ExternalLink className="size-3" />
            </a>
          ) : null}

          {sdkState === "loading" ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center"><Loader2 className="size-4 animate-spin" />{t("loadingSdk")}</div>
          ) : sdkState === "error" ? (
            <div className="py-6 text-sm text-destructive">{t("sdkError")} {sdkErr}</div>
          ) : phase.kind === "form" ? (
            <div className="space-y-4">
              {token === "EURC" && eurc.status === "loading" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("eurcChecking")}</div>
              ) : null}
              {token === "EURC" && eurc.status === "error" ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <div className="flex-1 break-words">{t("eurcError")} {eurc.error}</div>
                  <Button size="sm" variant="outline" onClick={() => setEurcNonce((n) => n + 1)}>{t("retry")}</Button>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <FieldLabel>{t("from")}</FieldLabel>
                <ChainSelect label={t("from")} chains={fromList} value={from} onChange={(c) => { setFromId(L(c).chain); if (toId === L(c).chain) setToId(fromId); }} disabledReason={fromDisabled} />
              </div>
              <div className="flex justify-center">
                <button type="button" aria-label={t("swap")} title={t("swap")} onClick={() => { setFromId(toId); setToId(fromId); }}
                  className="-my-2 inline-flex size-8 items-center justify-center rounded-full border bg-surface text-muted-foreground hover:text-primary">
                  <ArrowDownUp className="size-4" />
                </button>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>{t("to")}</FieldLabel>
                <ChainSelect label={t("to")} chains={fromList} value={to} onChange={(c) => setToId(L(c).chain)} disabledReason={toDisabled} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("amount")}</FieldLabel>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t("balance")}: {balances.loading ? "…" : srcAddress ? `${fmt(balances.data?.token)} ${token}` : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-surface px-3 focus-within:ring-2 focus-within:ring-ring">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { const v = e.target.value.replace(",", "."); if (AMOUNT_RE.test(v)) setAmount(v); }}
                    className="min-w-0 flex-1 bg-transparent py-3 font-mono text-lg outline-none placeholder:text-muted-foreground"
                    aria-label={t("amount")}
                  />
                  <span className="font-mono text-sm text-muted-foreground">{token}</span>
                  <Button size="sm" variant="secondary" disabled={!balances.data?.token}
                    onClick={() => { const b = balances.data?.token; if (b) { const [i, d = ""] = b.split("."); setAmount(d ? `${i}.${d.slice(0, 6)}` : i); } }}>
                    {t("max")}
                  </Button>
                </div>
                {srcAddress && balances.data && !tokenIsNativeGas ? (
                  <div className="flex justify-between font-mono text-xs text-muted-foreground">
                    <span>{t("gasBalance")}</span>
                    <span>{fmt(balances.data.native)} {balances.data.nativeSymbol}</span>
                  </div>
                ) : null}
                {srcAddress && balances.data && Number(balances.data.native) === 0 ? (
                  <div className="flex items-center gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5" />{t("noGas")}</div>
                ) : null}
                {balances.error ? <div className="text-xs text-destructive break-words">{balances.error}</div> : null}
              </div>

              {/* Recipient */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>{t("recipient")}</FieldLabel>
                  {destAddress ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("differentAddress")}
                      <Switch checked={custom} onCheckedChange={setCustom} />
                    </label>
                  ) : null}
                </div>
                {showRecipientInput ? (
                  <>
                    <Input value={customAddr} onChange={(e) => setCustomAddr(e.target.value)} placeholder={t("recipientPlaceholder")} className="font-mono text-sm" spellCheck={false} />
                    {customAddr && to && !isValidRecipient(to, customAddr.trim()) ? <div className="text-xs text-destructive">{t("invalidAddress")}</div> : null}
                    {!customAddr && to && L(to).type === "solana" ? <div className="text-xs text-muted-foreground">{t("needSolAddress")}</div> : null}
                  </>
                ) : destAddress ? (
                  <div className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2 font-mono text-sm">
                    <span className="truncate">{destAddress}</span><CopyButton text={destAddress} />
                  </div>
                ) : null}
              </div>

              {/* Speed */}
              <div className="space-y-1.5">
                <FieldLabel>{t("speed")}</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {[true, false].map((f) => (
                    <button key={String(f)} type="button" onClick={() => setFast(f)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${fast === f ? "border-primary bg-accent" : "bg-surface hover:border-primary/40"}`}>
                      <div className="text-sm font-medium">{f ? t("fast") : t("standard")}</div>
                      <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{f ? t("fastDesc") : t("standardDesc")}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Relayer */}
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5">
                <div>
                  <div className="text-sm">{t("relayer")}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{!relayerAvailable ? t("relayerUnavailable") : useRelayer ? t("relayerOn") : t("relayerOff")}</div>
                </div>
                <Switch checked={useRelayer} disabled={!relayerAvailable} onCheckedChange={setRelayer} aria-label={t("relayer")} />
              </div>

              {/* Estimate */}
              <div className="rounded-lg border px-3 py-2.5 text-sm">
                {!srcAdapter ? (
                  <div className="text-xs text-muted-foreground">{t("connectToEstimate")}</div>
                ) : validation ? (
                  <div className="text-xs text-muted-foreground">{t(validation)}</div>
                ) : est.loading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("estimating")}</div>
                ) : est.error ? (
                  <div className="text-xs text-destructive break-words">{est.error}</div>
                ) : est.data ? (
                  <EstimateView feeRows={feeRows} feeLabel={feeLabel} gasRows={gasRows} receive={receive} token={token} t={t} />
                ) : null}
              </div>

              <Button className="w-full" size="lg" disabled={!canBridge} onClick={() => { setChecked(false); setConfirmOpen(true); }}>
                {t("bridge")}
              </Button>
            </div>
          ) : phase.kind === "running" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin text-primary" />{t("progress")}</div>
              <RouteLine token={phase.token} amount={phase.amount} from={phase.from} to={phase.to} />
              {phase.steps.length === 0 ? <div className="text-xs text-muted-foreground">{t("starting")}</div> : <StepList steps={phase.steps} explorerFor={explorerFor({ from: phase.from, to: phase.to })} />}
              <p className="text-xs text-muted-foreground">{t("keepOpen")}</p>
            </div>
          ) : phase.kind === "done" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-success/40 px-3 py-3">
                <div className="text-sm font-medium text-success">{t("success")}</div>
                <div className="mt-1 font-mono text-lg">{t("received")}: ≈ {fmt(receive || phase.result.amount)} {phase.result.token}</div>
              </div>
              <RouteLine token={phase.result.token} amount={phase.result.amount} from={phase.result.source.chain} to={phase.result.destination.chain} />
              <StepList steps={phase.result.steps} explorerFor={explorerFor({ from: phase.result.source.chain, to: phase.result.destination.chain })} />
              <Button className="w-full" onClick={reset}>{t("bridgeAgain")}</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`rounded-lg border px-3 py-3 ${phase.rejected ? "" : "border-destructive/40"}`}>
                <div className={`text-sm font-medium ${phase.rejected ? "text-foreground" : "text-destructive"}`}>{phase.rejected ? t("rejected") : t("failed")}</div>
                {!phase.rejected ? <div className="mt-1 break-words text-xs text-muted-foreground">{phase.message}</div> : null}
              </div>
              {phase.result ? <StepList steps={phase.result.steps} explorerFor={explorerFor({ from: phase.result.source.chain, to: phase.result.destination.chain })} /> : null}
              <div className="flex gap-2">
                {phase.result && phase.result.state !== "success" ? (
                  <Button className="flex-1" onClick={() => retryResult(phase.result!, phase.entryId)}>{t("retry")}</Button>
                ) : null}
                <Button variant="outline" className="flex-1" onClick={reset}>{t("close")}</Button>
              </div>
            </div>
          )}
        </section>

        {/* History */}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("history")}</h2>
          {history.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-center text-xs text-muted-foreground">{t("noHistory")}</div>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const r = h.result;
                const st = r.state;
                return (
                  <li key={h.id} className="rounded-xl border bg-card px-3 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{fmt(r.amount)} {r.token}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${st === "success" ? "bg-success/15 text-success" : st === "error" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>
                        {t(`status_${st}` as TKey)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <ChainBadge name={L(r.source.chain).name} size={16} />{L(r.source.chain).name}
                      <span>→</span>
                      <ChainBadge name={L(r.destination.chain).name} size={16} />{L(r.destination.chain).name}
                      <span className="ml-auto">{new Date(h.createdAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {r.steps.filter((s) => s.txHash).map((s, i) => {
                        const url = explorerFor({ from: r.source.chain, to: r.destination.chain })(s);
                        return url ? (
                          <a key={i} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            {stepLabel(t, s.name)} <ExternalLink className="size-3" />
                          </a>
                        ) : null;
                      })}
                    </div>
                    {st !== "success" ? (
                      <Button size="sm" variant="outline" className="mt-2" disabled={phase.kind === "running"} onClick={() => retryResult(r, h.id, h.createdAt, h.network)}>
                        {t("resume")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-[640px] px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          <p>{t("footer")}</p>
          <p className="mt-2 flex justify-center gap-4">
            <a className="hover:text-foreground underline underline-offset-2" href="https://developers.circle.com/cctp" target="_blank" rel="noreferrer">developers.circle.com/cctp</a>
            <a className="hover:text-foreground underline underline-offset-2" href="https://docs.arc.io/app-kit/bridge" target="_blank" rel="noreferrer">docs.arc.io/app-kit/bridge</a>
          </p>
        </div>
      </footer>

      {/* Confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("confirmTitle")}</DialogDescription>
          </DialogHeader>
          {from && to ? (
            <div className="space-y-3 text-sm">
              <Row k={t("amount")} v={<span className="font-mono">{amount} {token}</span>} />
              <Row k={t("from")} v={<span className="flex items-center gap-1.5"><ChainBadge name={L(from).name} size={16} />{L(from).name}</span>} />
              <AddrRow k={t("sender")} a={srcAddress ?? ""} />
              <Row k={t("to")} v={<span className="flex items-center gap-1.5"><ChainBadge name={L(to).name} size={16} />{L(to).name}</span>} />
              <AddrRow k={t("recipient")} a={recipient} />
              <Row k={t("speed")} v={fast ? t("fast") : t("standard")} />
              <Row k={t("relayer")} v={useRelayer ? t("on") : t("off")} />
              {feeRows.map((f, i) => <Row key={i} k={feeLabel(f.type)} v={<span className="font-mono">{fmt(f.amount)} {f.token}</span>} />)}
              <Row k={t("receive")} v={<span className="font-mono text-primary">{fmt(receive)} {token}</span>} />
              {network === "mainnet" ? (
                <div className="flex gap-2 rounded-lg border border-warning/40 px-3 py-2 text-xs text-warning"><TriangleAlert className="size-4 shrink-0" />{t("realFunds")}</div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
                {t("checkedRecipient")}
              </label>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>{t("cancel")}</Button>
                <Button className="flex-1" disabled={!checked} onClick={startBridge}>{t("confirm")}</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>;
}
function AddrRow({ k, a }: { k: string; a: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{k}</div>
      <div className="mt-0.5 flex items-center gap-1 break-all rounded-md bg-surface px-2 py-1.5 font-mono text-xs">{a}<CopyButton text={a} /></div>
    </div>
  );
}

function RouteLine({ token, amount, from, to }: { token: string; amount: string; from: ChainDefinition; to: ChainDefinition }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono">{amount} {token}</span>
      <span className="flex items-center gap-1.5 text-muted-foreground"><ChainBadge name={L(from).name} size={16} />{L(from).name} → <ChainBadge name={L(to).name} size={16} />{L(to).name}</span>
    </div>
  );
}

function EstimateView({ feeRows, feeLabel, gasRows, receive, token, t }: {
  feeRows: Est["fees"]; feeLabel: (s: string) => string; gasRows: { name: string; chain: string; val: number; sym: string }[]; receive: number; token: string; t: (k: TKey) => string;
}) {
  return (
    <div className="space-y-1.5 text-xs">
      {feeRows.length === 0 ? <Row k={t("fees")} v={<span className="font-mono">0</span>} /> : null}
      {feeRows.map((f, i) => <Row key={i} k={feeLabel(f.type)} v={<span className="font-mono">{fmt(f.amount)} {f.token}</span>} />)}
      {gasRows.map((g, i) => <Row key={i} k={`${t("gas")} · ${stepLabel(t, g.name)} · ${g.chain}`} v={<span className="font-mono">{fmt(g.val, 8)} {g.sym}</span>} />)}
      <div className="flex items-center justify-between border-t pt-2 text-sm">
        <span>{t("receive")}</span>
        <span className="font-mono text-primary">{fmt(receive)} {token}</span>
      </div>
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-surface p-0.5" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ConnectedPill({ label, icon, address, onDisconnect }: { label: string; icon?: string; address: string; onDisconnect: () => void }) {
  const { t } = useT();
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border bg-surface py-1 pl-2 pr-1 text-xs">
      {icon ? <img src={icon} alt="" className="size-4 rounded" /> : <span className="text-muted-foreground">{label}</span>}
      <span className="font-mono">{shortAddr(address)}</span>
      <CopyButton text={address} />
      <button type="button" onClick={onDisconnect} aria-label={t("disconnect")} title={t("disconnect")} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-destructive">
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
