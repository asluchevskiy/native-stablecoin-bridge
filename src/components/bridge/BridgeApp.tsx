import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BridgeKit, BridgeParams, BridgeResult, ChainDefinition, EstimateResult } from "@circle-fin/bridge-kit";
import { ArrowDownUp, ChevronDown, Copy, ExternalLink, Info, Loader2, LogOut, Moon, Settings2, Sun, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BrandMark, ChainField, ChainMark, CopyButton, RouteStrip, Seg, StepTracker, type Step } from "./bits";
import { fill, useT, stepLabel, type TKey } from "@/lib/i18n";
import {
  L, explorerTx, fetchBalances, fmt, forwarderDest, isValidRecipient, nativeIsUsdc, shortAddr, tokenAddress,
  type Balances, type Token,
} from "@/lib/chains";
import { discoverEvmWallets, getSolanaWallet, rememberWallet, rememberedWallet, type Eip1193, type EvmWalletInfo, type SolProvider } from "@/lib/wallets";
import { errMsg, isUserRejection, loadSdk, makeEvmAdapter, makeSolanaAdapter } from "@/lib/sdk";
import { loadHistory, saveHistory, type HistoryEntry } from "@/lib/history";
import { displaySteps, mergeTransferSteps, normalizeStepEvent, receivedAmount, sourceComplete, transferProgress, updateStepTimings } from "@/lib/transfers";
import { spotPrice, usdCost } from "@/lib/prices";

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

export function BridgeApp() {
  const { t, lang, setLang } = useT();
  const [network, setNetwork] = useState<Network>("mainnet");
  const [token, setToken] = useState<Token>("USDC");
  const [chains, setChains] = useState<ChainDefinition[]>([]);
  const [sdkState, setSdkState] = useState<"loading" | "ready" | "error">("loading");
  const [sdkErr, setSdkErr] = useState("");
  const [fromId, setFromId] = useState<string>();
  const [toId, setToId] = useState<string>();
  const [amount, setAmount] = useState<string>("");
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

  const historyRef = useRef<HistoryEntry[]>([]);
  const activeIds = useRef(new Set<string>());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const focusedId = useRef<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number | undefined>>({ USDC: 1 });
  useEffect(() => { historyRef.current = loadHistory(); setHistory(historyRef.current); }, []);
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
    const firstPair = [...eurc.pairs][0];
    if (!firstPair) return;
    const first = firstPair.split(">") as [string, string];
    const keepFrom = from && hasOut(from) ? L(from).chain : first[0];
    const dest = [...eurc.pairs].find((p) => p.startsWith(`${keepFrom}>`))?.split(">")[1];
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
  const evmListeners = useRef<{ provider: Eip1193; accounts: (...a: unknown[]) => void; chain: (...a: unknown[]) => void } | null>(null);
  function detachEvmListeners() {
    const l = evmListeners.current;
    if (!l) return;
    l.provider.removeListener?.("accountsChanged", l.accounts);
    l.provider.removeListener?.("chainChanged", l.chain);
    evmListeners.current = null;
  }
  function disconnectEvm() {
    detachEvmListeners();
    rememberWallet("evm", null);
    setEvm(null);
    evmAdapter.current = null;
  }
  useEffect(() => () => detachEvmListeners(), []);
  async function connectEvm(w: EvmWalletInfo, silent = false) {
    if (!silent) setWalletErr("");
    try {
      const accts = (await w.provider.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" })) as string[];
      if (!accts?.[0]) return;
      evmAdapter.current = await makeEvmAdapter(w.provider);
      setEvm({ info: w, address: accts[0] });
      rememberWallet("evm", w.rdns ?? w.uuid);
      if (evmListeners.current?.provider !== w.provider) {
        detachEvmListeners();
        const accounts = (a: unknown) => {
          const list = a as string[];
          const address = list?.[0];
          if (!address) disconnectEvm();
          else setEvm((cur) => (cur ? { ...cur, address } : cur));
        };
        // Chain switches are expected (we switch for source/mint); just refresh balances.
        const chain = () => setBalNonce((n) => n + 1);
        w.provider.on?.("accountsChanged", accounts);
        w.provider.on?.("chainChanged", chain);
        evmListeners.current = { provider: w.provider, accounts, chain };
      }
    } catch (e) {
      if (!silent) setWalletErr(isUserRejection(e) ? t("rejected") : await errMsg(e));
    }
  }
  function disconnectSol() {
    rememberWallet("solana", null);
    sol?.provider.disconnect?.().catch(() => {});
    setSol(null);
    solAdapter.current = null;
  }
  async function connectSol(silent = false, remembered?: string) {
    if (!silent) setWalletErr("");
    const wallet = getSolanaWallet(remembered);
    if (!wallet) { if (!silent) setWalletErr(t("noSolWallet")); return; }
    const p = wallet.provider;
    try {
      const r = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
      const pk = (r && "publicKey" in r ? r.publicKey : null) ?? p.publicKey;
      if (!pk) return;
      solAdapter.current = await makeSolanaAdapter(p);
      setSol({ provider: p, address: pk.toString() });
      rememberWallet("solana", wallet.name);
    } catch (e) {
      if (!silent) setWalletErr(isUserRejection(e) ? t("rejected") : await errMsg(e));
    }
  }
  const restoreAttempted = useRef(new Set<string>());
  useEffect(() => {
    const saved = rememberedWallet("evm");
    if (!saved || evm || restoreAttempted.current.has(saved)) return;
    const wallet = evmWallets.find((w) => (w.rdns ?? w.uuid) === saved);
    if (!wallet) return;
    restoreAttempted.current.add(saved);
    void connectEvm(wallet, true);
    // Discovery may arrive asynchronously; no permission requests during restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmWallets]);
  useEffect(() => {
    const saved = rememberedWallet("solana");
    if (saved) void connectSol(true, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist synchronously, outside React updater replay, so every SDK event survives reload.
  const upsertHistory = (entry: HistoryEntry) => {
    const prev = historyRef.current;
    const next = prev.some((e) => e.id === entry.id) ? prev.map((e) => e.id === entry.id ? entry : e) : [entry, ...prev];
    historyRef.current = next;
    saveHistory(next);
    setHistory(next);
  };
  const removeHistory = (id: string) => {
    historyRef.current = historyRef.current.filter((e) => e.id !== id);
    saveHistory(historyRef.current);
    setHistory(historyRef.current);
  };

  async function run(
    exec: (kit: BridgeKit) => Promise<Result>,
    ctx: { entryId: string; base: Result; network: Network; createdAt: number; fresh: boolean },
  ) {
    if (activeIds.current.has(ctx.entryId)) return;
    activeIds.current.add(ctx.entryId);
    setRunningIds(new Set(activeIds.current));
    focusedId.current = ctx.entryId;
    setConfirmOpen(false);
    let live: Result = { ...ctx.base, steps: [...ctx.base.steps] };
    let timings = updateStepTimings(live, historyRef.current.find((e) => e.id === ctx.entryId)?.timings ?? {}, Date.now());
    const persist = () => upsertHistory({ id: ctx.entryId, network: ctx.network, createdAt: ctx.createdAt, result: live, timings });
    persist();
    const source = ctx.base.source.chain;
    const destination = ctx.base.destination.chain;
    setPhase({ kind: "running", entryId: ctx.entryId, steps: live.steps, result: live, token: live.token, amount: live.amount, from: source, to: destination });
    let kit: BridgeKit | undefined;
    const handler = (p: unknown) => {
      const step = normalizeStepEvent(p, ctx.entryId, source, destination);
      if (!step) return;
      live = { ...live, steps: mergeTransferSteps(live.steps, [step]) };
      timings = updateStepTimings(live, timings, Date.now());
      persist();
      const snap = live;
      setPhase((ph) => ph.kind === "running" && ph.entryId === ctx.entryId ? { ...ph, steps: snap.steps, result: snap } : ph);
    };
    try {
      const loaded = await loadSdk();
      kit = loaded.kit;
      kit.on("*", handler);
      const result = await exec(kit);
      live = result;
      timings = updateStepTimings(live, timings, Date.now());
      persist();
      if (focusedId.current === ctx.entryId) {
        if (result.state === "success") setPhase({ kind: "done", entryId: ctx.entryId, result });
        else {
          const bad = result.steps.find((s) => s.state === "error");
          const rejected = isUserRejection(bad?.error) || /reject|denied/i.test(bad?.errorMessage ?? "");
          setPhase({ kind: "failed", entryId: ctx.entryId, result, rejected, retryable: true,
            message: rejected ? t("rejected") : `${t("failedAt")}: ${stepLabel(t, bad?.name ?? "?")}${bad?.errorMessage ? ` — ${bad.errorMessage}` : ""}` });
        }
      }
    } catch (e) {
      const rejected = isUserRejection(e);
      const anyTx = live.steps.some((s) => !!s.txHash);
      const kept = anyTx || !ctx.fresh ? { ...live, state: "error" as const } : undefined;
      if (!kept) removeHistory(ctx.entryId);
      else { live = kept; persist(); }
      if (focusedId.current === ctx.entryId) setPhase({ kind: "failed", entryId: kept ? ctx.entryId : null,
        rejected, result: kept, retryable: !!kept, message: rejected ? t("rejected") : await errMsg(e) });
    } finally {
      kit?.off("*", handler);
      activeIds.current.delete(ctx.entryId);
      setRunningIds(new Set(activeIds.current));
      setBalNonce((n) => n + 1);
    }
  }

  async function startBridge() {
    const params = buildParams();
    if (!params || !from || !to || !srcAddress) return;
    const base = {
      state: "pending",
      provider: token === "USDC" ? "CCTPV2BridgingProvider" : "CCTPXBridgingProvider",
      amount,
      token,
      config: { transferSpeed: fast ? "FAST" : "SLOW" },
      source: { address: srcAddress, chain: from },
      destination: {
        address: recipient,
        chain: to,
        ...(showRecipientInput ? { recipientAddress: recipient } : {}),
        useForwarder: useRelayer,
      },
      steps: [],
    } as unknown as Result;
    const fromDef = from;
    const entryId = crypto.randomUUID();
    await run(async (kit) => {
      if (L(fromDef).type === "evm" && evm) await ensureEvmChain(evm.info.provider, fromDef);
      return (await kit.bridge({ ...params, invocationMeta: { traceId: entryId } })) as Result;
    }, { entryId, base, network, createdAt: Date.now(), fresh: true });
  }

  async function retryResult(result: Result, entryId: string | null, createdAt?: number, net: Network = network) {
    if (entryId && activeIds.current.has(entryId)) return;
    const traceId = entryId ?? crypto.randomUUID();
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
      return (await kit.retry(result, ctx as any, { traceId })) as Result;
    }, { entryId: traceId, base: result, network: net, createdAt: createdAt ?? Date.now(), fresh: false });
  }
  const reset = () => { focusedId.current = null; setPhase({ kind: "form" }); setAmount(""); setChecked(false); };

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
  const gasByChain = Object.values(
    gasRows.reduce<Record<string, { chain: string; val: number; sym: string }>>((acc, g) => {
      const k = `${g.chain}|${g.sym}`;
      acc[k] = { chain: g.chain, sym: g.sym, val: (acc[k]?.val ?? 0) + g.val };
      return acc;
    }, {}),
  );

  const running = phase.kind === "running";
  const walletsLocked = runningIds.size > 0;
  const foregroundResult = phase.kind === "running" ? phase.result : undefined;
  const foregroundTimings = history.find((h) => h.id === (phase.kind === "running" ? phase.entryId : null))?.timings;
  const attestationHint = (r: Result) => /^Ethereum/.test(L(r.source.chain).chain) ? t("waitingFinality") : t("waitingFinalityOther");
  const canBridge = !validation && !!srcAdapter && !!est.data && !est.loading && phase.kind === "form";
  const tokenIsNativeGas = !!from && nativeIsUsdc(from) && token === "USDC";
  const noGas = !!srcAddress && !!balances.data && Number(balances.data.native) === 0;

  // Presentation-only state
  const [evmMenuOpen, setEvmMenuOpen] = useState(false);
  const [mobileWalletOpen, setMobileWalletOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [swapTurns, setSwapTurns] = useState(0);
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem("nsb.theme") === "dark"; } catch { /* ignore */ }
    document.documentElement.classList.toggle("dark", saved);
    setDark(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset["token"] = token.toLowerCase();
  }, [token]);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("nsb.theme", next ? "dark" : "light"); } catch { /* ignore */ }
  };

  const ctaLabel = (() => {
    if (!srcAdapter) return t("ctaConnect");
    if (!to || validation === "errSame") return t("ctaDest");
    if (validation === "errAmount") return t("ctaAmount");
    if (validation === "errBalance") return fill(t("ctaNotEnough"), { token });
    if (validation) return t(validation);
    if (est.loading) return t("estimating");
    if (est.error) return t("bridge");
    return fill(t("ctaBridge"), { amount: fmt(amount), token, chain: L(to).name });
  })();
  const onCta = () => {
    if (!srcAdapter) {
      if (from && L(from).type === "solana") void connectSol();
      else if (window.matchMedia("(max-width: 639px)").matches) setMobileWalletOpen(true);
      else setEvmMenuOpen(true);
      return;
    }
    if (canBridge) { setChecked(false); setConfirmOpen(true); }
  };
  const ctaEnabled = !srcAdapter ? sdkState === "ready" : canBridge;

  // Route strip state
  const stripFrom = phase.kind === "running" ? phase.from : phase.kind === "done" ? phase.result.source.chain : phase.kind === "failed" && phase.result ? phase.result.source.chain : from;
  const stripTo = phase.kind === "running" ? phase.to : phase.kind === "done" ? phase.result.destination.chain : phase.kind === "failed" && phase.result ? phase.result.destination.chain : to;
  const stripProgress =
    phase.kind === "running" ? phase.result ? transferProgress(phase.result) : 0
    : phase.kind === "done" ? 1
    : phase.kind === "failed" && phase.result ? transferProgress(phase.result)
    : 0;

  const locale = lang === "ru" ? "ru-RU" : "en-US";

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header>
        <div className="mx-auto grid max-w-[912px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-4 sm:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0"><BrandMark /></span>
            <h1 className="truncate font-display text-base font-semibold tracking-tight">
              <span className="max-[400px]:hidden">Native </span>Stablecoin Bridge
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t("settings")} title={t("settings")}
                  className="inline-flex size-9 items-center justify-center rounded-[10px] border border-rule bg-sheet text-ink-2 hover:text-ink">
                  <Settings2 className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3 rounded-[12px] border-rule bg-sheet text-ink">
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-ink-2">{t("network")}</span>
                  <Seg label={t("network")} value={network} options={[["mainnet", t("mainnet")], ["testnet", t("testnet")]]} disabled={running}
                    onChange={(v) => { if (!running) { setNetwork(v); setPhase({ kind: "form" }); } }} /></div>
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-ink-2">{t("language")}</span>
                  <Seg label={t("language")} value={lang} options={[["en", "EN"], ["ru", "RU"]]} onChange={(v) => setLang(v)} /></div>
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-ink-2">{t("theme")}</span>
                  <button type="button" onClick={toggleTheme} aria-label={t("theme")}
                    className="inline-flex size-9 items-center justify-center rounded-[10px] border border-rule bg-sheet text-ink-2 hover:text-ink">
                    {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  </button></div>
              </PopoverContent>
            </Popover>
            <DropdownMenu open={mobileWalletOpen} onOpenChange={setMobileWalletOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-rule bg-sheet px-2.5 text-sm font-medium text-ink">
                  {evm?.info.icon ? <img src={evm.info.icon} alt="" className="size-5 rounded-[6px]" /> : <Wallet className="size-4 text-ink-2" />}
                  <span className="num">{evm ? shortAddr(evm.address) : sol ? shortAddr(sol.address) : t("connectShort")}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-[12px] border-rule bg-sheet text-ink">
                <DropdownMenuLabel className="font-medium text-ink-2">{t("connectEvm")}</DropdownMenuLabel>
                {evm ? (
                  <>
                    <DropdownMenuItem onSelect={() => { navigator.clipboard?.writeText(evm.address).catch(() => {}); }} className="gap-2"><Copy className="size-4" /><span className="num">{shortAddr(evm.address)}</span></DropdownMenuItem>
                    <DropdownMenuItem disabled={walletsLocked} onSelect={disconnectEvm} className="gap-2 text-err focus:text-err"><LogOut className="size-4" />{t("disconnect")}</DropdownMenuItem>
                  </>
                ) : evmWallets.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-ink-2">{t("noEvmWallet")}</div>
                ) : evmWallets.map((w) => (
                  <DropdownMenuItem key={w.uuid} disabled={walletsLocked} onSelect={() => connectEvm(w)} className="gap-2.5 py-2">
                    {w.icon ? <img src={w.icon} alt="" className="size-5 rounded-[6px]" /> : <Wallet className="size-4" />}{w.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-rule" />
                <DropdownMenuLabel className="font-medium text-ink-2">{t("connectSol")}</DropdownMenuLabel>
                {sol ? (
                  <>
                    <DropdownMenuItem onSelect={() => { navigator.clipboard?.writeText(sol.address).catch(() => {}); }} className="gap-2"><Copy className="size-4" /><span className="num">{shortAddr(sol.address)}</span></DropdownMenuItem>
                    <DropdownMenuItem disabled={walletsLocked} onSelect={disconnectSol} className="gap-2 text-err focus:text-err"><LogOut className="size-4" />{t("disconnect")}</DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem disabled={walletsLocked} onSelect={() => { void connectSol(); }} className="gap-2.5 py-2"><Wallet className="size-4" />Phantom / Solflare / Backpack</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mx-auto hidden max-w-[912px] flex-wrap items-center gap-x-3 gap-y-3 px-4 py-5 sm:flex">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <h1 className="font-display text-lg font-semibold tracking-tight">{t("appName")}</h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Seg label={t("network")} value={network} options={[["mainnet", t("mainnet")], ["testnet", t("testnet")]]} disabled={running}
              onChange={(v) => { if (!running) { setNetwork(v); setPhase({ kind: "form" }); } }} />
            <Seg label={t("language")} value={lang} options={[["en", "EN"], ["ru", "RU"]]} onChange={(v) => setLang(v)} />
            <button type="button" onClick={toggleTheme} aria-label={t("theme")} title={t("theme")}
              className="inline-flex size-9 items-center justify-center rounded-[10px] border border-rule bg-sheet text-ink-2 hover:text-ink">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            {evm ? (
              <WalletChip icon={evm.info.icon} label={evm.info.name} address={evm.address} disabled={walletsLocked} onDisconnect={disconnectEvm} />
            ) : (
              <DropdownMenu open={evmMenuOpen} onOpenChange={setEvmMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-9 rounded-[10px] border-rule bg-sheet text-ink hover:bg-tint hover:text-ink"><Wallet className="size-4" />{t("connectEvm")}</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 rounded-[12px] border-rule bg-sheet">
                  <DropdownMenuLabel className="text-ink-2 font-medium">{t("chooseWallet")}</DropdownMenuLabel>
                  {evmWallets.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-ink-2">{t("noEvmWallet")}</div>
                  ) : evmWallets.map((w) => (
                    <DropdownMenuItem key={w.uuid} disabled={walletsLocked} onSelect={() => connectEvm(w)} className="gap-2.5 py-2">
                      {w.icon ? <img src={w.icon} alt="" className="size-5 rounded-[6px]" /> : <Wallet className="size-4" />}
                      {w.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {sol ? (
              <WalletChip label="Solana" address={sol.address} disabled={walletsLocked}
                onDisconnect={disconnectSol} />
            ) : (
              <Button variant="outline" disabled={walletsLocked} className="h-9 rounded-[10px] border-rule bg-sheet text-ink hover:bg-tint hover:text-ink" onClick={() => void connectSol()}><Wallet className="size-4" />{t("connectSol")}</Button>
            )}
          </div>
        </div>
        {walletErr ? <div className="mx-auto max-w-[880px] px-4 pb-2 text-sm text-err">{walletErr}</div> : null}
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pb-10 pt-2">
        <div className="grid gap-5 min-[960px]:grid-cols-[480px_minmax(0,1fr)] min-[960px]:items-start">
          {/* SLIP */}
          <section className="min-w-0 rounded-[20px] bg-sheet p-5 shadow-slip sm:p-6">
            <RouteStrip from={stripFrom} to={stripTo} progress={stripProgress} active={running}
              label={phase.kind === "running" ? `${fmt(phase.amount)} ${phase.token}` : phase.kind === "done" ? `${fmt(phase.result.amount)} ${phase.result.token}` : amount && Number(amount) > 0 ? `${fmt(amount)} ${token}` : token}
              error={phase.kind === "failed" && !phase.rejected} />
            <div className="mt-2 flex justify-between gap-3 text-sm text-ink">
              <span className="truncate">{stripFrom ? L(stripFrom).name : ""}</span>
              <span className="truncate text-right">{stripTo ? L(stripTo).name : ""}</span>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <Seg label={t("token")} value={token} disabled={phase.kind !== "form"}
                options={[
                  ["USDC", <><span className="size-2 rounded-full bg-usdc" aria-hidden />USDC</>],
                  ["EURC", <><span className="size-2 rounded-full bg-eurc" aria-hidden />EURC</>],
                ]}
                onChange={(v) => { if (phase.kind === "form") setToken(v); }} />
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-sm text-ink-2 hover:text-ink">
                    <Info className="size-4" />{t("howItWorks")}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 rounded-[12px] border-rule bg-sheet text-sm leading-relaxed">{t("howBody")}</PopoverContent>
              </Popover>
            </div>

            {network === "testnet" ? (
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                {t("faucet")} <ExternalLink className="size-3.5" />
              </a>
            ) : null}

            {sdkState === "loading" ? (
              <div className="space-y-3 pt-6" aria-busy>
                <div className="skeleton h-12" /><div className="skeleton h-12" /><div className="skeleton h-20" />
                <span className="sr-only">{t("loadingSdk")}</span>
              </div>
            ) : sdkState === "error" ? (
              <div className="pt-6 text-sm text-err">{t("sdkError")} {sdkErr}</div>
            ) : (
              <fieldset disabled={phase.kind !== "form"} className="mt-5 min-w-0 space-y-5 disabled:opacity-60">
                {token === "EURC" && eurc.status === "loading" ? (
                  <div className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />{t("eurcChecking")}</div>
                ) : null}
                {token === "EURC" && eurc.status === "error" ? (
                  <div className="flex items-start gap-3 rounded-[12px] bg-tint px-3 py-2.5 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-err" />
                    <div className="flex-1 break-words">{t("eurcError")} <span className="text-ink-2">{eurc.error}</span></div>
                    <Button size="sm" variant="outline" className="rounded-[8px]" onClick={() => setEurcNonce((n) => n + 1)}>{t("retry")}</Button>
                  </div>
                ) : null}

                <div className="relative space-y-2">
                  <ChainField label={t("from")} chains={fromList} value={from} disabledReason={fromDisabled}
                    onChange={(c) => { setFromId(L(c).chain); if (toId === L(c).chain) setToId(fromId); }} />
                  <button type="button" aria-label={t("swap")} title={t("swap")}
                    onClick={() => { setFromId(toId); setToId(fromId); setSwapTurns((n) => n + 1); }}
                    className="absolute right-12 top-1/2 z-10 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-rule bg-sheet text-ink-2 hover:text-primary">
                    <ArrowDownUp className="swap-rot size-4" style={{ transform: `rotate(${swapTurns * 180}deg)` }} />
                  </button>
                  <ChainField label={t("to")} chains={fromList} value={to} disabledReason={toDisabled} onChange={(c) => setToId(L(c).chain)} />
                </div>

                <div>
                  <label htmlFor="amount" className="text-sm font-medium">{t("youSend")}</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      id="amount"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => { const v = e.target.value.replace(",", "."); if (AMOUNT_RE.test(v)) setAmount(v); }}
                      className="font-display-amount min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-rule focus-visible:outline-none"
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-tint px-2.5 py-1.5 text-sm font-semibold">
                      <span className={`size-2 rounded-full ${token === "USDC" ? "bg-usdc" : "bg-eurc"}`} aria-hidden />{token}
                    </span>
                  </div>
                  <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
                    {!srcAddress ? <span>{t("connectForBalance")}</span> : <span className="num">
                      {t("balance")}{" "}
                      {balances.loading ? <span className="skeleton inline-block h-3 w-16 align-middle" /> : `${fmt(balances.data?.token)} ${token}`}
                    </span>}
                    <button type="button" disabled={!balances.data?.token} className="font-medium text-primary hover:underline disabled:text-ink-2 disabled:no-underline"
                      onClick={() => { const b = balances.data?.token; if (b) { const [i = "0", d = ""] = b.split("."); setAmount(d ? `${i}.${d.slice(0, 6)}` : i); } }}>
                      {t("max")}
                    </button>
                    {srcAddress && balances.data && !tokenIsNativeGas && !noGas ? (
                      <span className="num ml-auto">{t("gasLabel")} {fmt(balances.data.native)} {balances.data.nativeSymbol}</span>
                    ) : null}
                  </div>
                  {noGas && from && balances.data ? (
                    <p className="mt-2 text-sm text-warn">{fill(t("gasShort"), { sym: balances.data.nativeSymbol, chain: L(from).name })}</p>
                  ) : null}
                  {balances.error ? <p className="mt-2 break-words text-sm text-err">{balances.error}</p> : null}
                </div>

                {/* Recipient */}
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{t("recipient")}</span>
                    {destAddress ? (
                      <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setCustom((c) => !c)}>
                        {custom ? t("useMyWallet") : t("edit")}
                      </button>
                    ) : null}
                  </div>
                  {showRecipientInput ? (
                    <div className="mt-2">
                      <input value={customAddr} onChange={(e) => setCustomAddr(e.target.value)} placeholder={destAddress ? t("recipientPlaceholder") : t("recipientConnectOrPaste")} spellCheck={false}
                        aria-label={t("recipient")}
                        className="h-11 w-full rounded-[12px] border border-rule bg-sheet px-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-sm placeholder:text-ink-2" />
                      {customAddr && to && !isValidRecipient(to, customAddr.trim()) ? <p className="mt-1.5 text-sm text-err">{t("invalidAddress")}</p> : null}
                      {!customAddr && to && L(to).type === "solana" ? <p className="mt-1.5 text-sm text-ink-2">{t("needSolAddress")}</p> : null}
                    </div>
                  ) : destAddress ? (
                    <div className="mt-1 flex items-center gap-2 text-base">
                      {to ? <ChainMark chain={to} size={20} /> : null}
                      <span className="num">{shortAddr(destAddress)}</span>
                      <span className="text-sm text-ink-2">({t("you")})</span>
                      <CopyButton text={destAddress} label={t("copyAddress")} />
                    </div>
                  ) : null}
                </div>

                {/* Speed */}
                <div>
                  <span className="text-sm font-medium">{t("speed")}</span>
                  <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("speed")}>
                    {[true, false].map((f) => (
                      <button key={String(f)} type="button" role="radio" aria-checked={fast === f} onClick={() => setFast(f)}
                        className={`flex h-full flex-col items-start justify-start rounded-[12px] border bg-sheet px-3 py-2.5 text-left text-ink transition-colors ${fast === f ? "border-primary ring-1 ring-primary" : "border-rule hover:border-ink-2/40"}`}>
                        <div className="text-sm font-semibold">{f ? t("fast") : t("standard")}</div>
                        <div className="mt-0.5 text-xs leading-snug text-ink-2">{f ? t("fastDesc") : t("standardDesc")}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Relayer */}
                <div className="flex items-start justify-between gap-4 border-t border-rule pt-4">
                  <div>
                    <div className="text-sm font-medium">{t("relayer")}</div>
                    <div className="mt-0.5 text-sm text-ink-2">{!relayerAvailable ? t("relayerUnavailable") : useRelayer ? t("relayerOn") : t("relayerOff")}</div>
                    {relayerAvailable && to ? <p className="mt-2 text-xs text-ink-2">{fill(t("relayOptOut"), { chain: L(to).name, sym: L(to).nativeCurrency.symbol })}</p> : null}
                  </div>
                  <Switch checked={useRelayer} disabled={!relayerAvailable} onCheckedChange={setRelayer} aria-label={t("relayer")} />
                </div>
              </fieldset>
            )}
          </section>

          {/* RECEIPT */}
          <aside className="min-w-0 rounded-[20px] min-[960px]:sticky min-[960px]:top-6 border border-rule bg-sheet p-5 sm:p-6" aria-label={t("receipt")} aria-live="polite">
            {phase.kind === "form" ? (
              <>
                <ReceiptRow k={t("youSend")} v={amount && Number(amount) > 0 ? `${fmt(amount)} ${token}` : `0 ${token}`} strong />
                <div className="mt-3 min-h-[100px] space-y-2.5">
                  {!srcAdapter || validation ? (
                    <>
                      <ReceiptRow k={t("protocolFee")} v={<span className="skeleton inline-block h-3.5 w-14 align-middle opacity-70" />} />
                      {useRelayer ? <ReceiptRow k={t("relayFee")} v={<span className="skeleton inline-block h-3.5 w-14 align-middle opacity-70" />} /> : null}
                      <ReceiptRow k={fill(t("networkGas"), { chain: from ? L(from).name : "" })} v={<span className="skeleton inline-block h-3.5 w-16 align-middle opacity-70" />} />
                      <p className="pt-1 text-xs text-ink-2">{!srcAdapter ? t("connectToEstimate") : t("estimateHint")}</p>
                    </>
                  ) : est.loading ? (
                    <><SkelRow /><SkelRow /><SkelRow /></>
                  ) : est.error ? (
                    <p className="break-words text-sm text-err">{est.error}</p>
                  ) : est.data ? (
                    <>
                      {feeRows.length === 0 ? <ReceiptRow k={t("fees")} v={`0 ${token}`} /> : null}
                      {feeRows.map((f, i) => <ReceiptRow key={i} k={feeLabel(f.type)} v={`${fmt(f.amount)} ${f.token}`} />)}
                      {gasByChain.map((g, i) => <ReceiptRow key={i} k={fill(t("networkGas"), { chain: g.chain })} v={`${fmt(g.val, 6)} ${g.sym}`} />)}
                    </>
                  ) : null}
                </div>
                <div className="tear my-4" aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{t("youReceive")}</span>
                  <span className="num font-display text-xl font-semibold">
                    {est.loading ? <span className="skeleton inline-block h-6 w-24 align-middle" /> : est.data && !validation ? `≈ ${fmt(receive)}` : "—"}
                    <span className="ml-1.5 text-base text-ink-2">{token}</span>
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sm text-ink-2">
                  <span>{t("arrivesIn")}</span>
                  <span>{fast ? t("arrivalFast") : t("arrivalStandard")}</span>
                </div>
                <PrimaryButton className="mt-6" disabled={!ctaEnabled} onClick={onCta}>{ctaLabel}</PrimaryButton>
              </>
            ) : phase.kind === "running" ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold">{t("progress")}</h2>
                  <span className="num text-sm text-ink-2">{fmt(phase.amount)} {phase.token}</span>
                </div>
                <div className="mt-5">
                  {foregroundResult ? <StepTracker steps={displaySteps(foregroundResult, foregroundTimings)} attestationHint={attestationHint(foregroundResult)} explorerFor={explorerFor({ from: phase.from, to: phase.to })} /> : null}
                </div>
                <div className="tear my-4" aria-hidden />
                <p className="text-sm text-ink-2">{t("keepOpen")}</p>
                {foregroundResult && sourceComplete(foregroundResult) ? <>
                  {!foregroundResult.destination.useForwarder ? <p className="mt-3 text-sm text-warn">{t("backgroundMint")}</p> : null}
                  <Button variant="outline" className="mt-4 w-full rounded-[12px]" onClick={reset}>{foregroundResult.destination.useForwarder ? t("startAnother") : t("backToForm")}</Button>
                </> : null}
              </>
            ) : phase.kind === "done" ? (
              <>
                <div className="flex items-center gap-3">
                  <ChainMark chain={phase.result.destination.chain} size={44} />
                  <div>
                    <div className="text-sm font-medium text-ok">{t("success")}</div>
                    <div className="num font-display text-lg font-semibold leading-snug">
                      {fill(t("receivedOn"), { amount: fmt(receivedAmount(phase.result)), token: phase.result.token, chain: L(phase.result.destination.chain).name })}
                    </div>
                  </div>
                </div>
                <div className="tear my-5" aria-hidden />
                <StepTracker steps={displaySteps(phase.result, history.find((h) => h.id === phase.entryId)?.timings)} explorerFor={explorerFor({ from: phase.result.source.chain, to: phase.result.destination.chain })} />
                <PrimaryButton className="mt-4" onClick={reset}>{t("bridgeAgain")}</PrimaryButton>
              </>
            ) : (
              <>
                <h2 className={`font-display text-lg font-semibold ${phase.rejected ? "" : "text-err"}`}>{phase.rejected ? t("rejected") : t("failed")}</h2>
                {!phase.rejected ? <p className="mt-1 break-words text-sm text-ink-2">{phase.message}</p> : null}
                {phase.result ? (
                  <div className="mt-5">
                    <StepTracker steps={displaySteps(phase.result, history.find((h) => h.id === phase.entryId)?.timings)} explorerFor={explorerFor({ from: phase.result.source.chain, to: phase.result.destination.chain })} />
                  </div>
                ) : null}
                <div className="mt-4 space-y-2">
                  {phase.result && phase.result.state !== "success" ? (
                    <PrimaryButton disabled={running} onClick={() => { if (phase.result) void retryResult(phase.result, phase.entryId); }}>{t("retry")}</PrimaryButton>
                  ) : null}
                  <Button variant="ghost" className="h-11 w-full rounded-[12px]" onClick={reset}>{t("close")}</Button>
                </div>
              </>
            )}
          </aside>
        </div>

        {/* History */}
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">{t("history")}</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">{t("noHistory")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule rounded-[16px] border border-rule bg-sheet">
              {history.map((h) => {
                const r = h.result;
                const st = r.state;
                const liveInTab = runningIds.has(h.id);
                const currentStep = displaySteps(r, h.timings).find((s) => !s.future && s.state === "pending");
                const inProgress = st === "pending" && r.steps.some((s) => (s.name === "burn" || s.name === "transfer") && !!s.txHash);
                const tone = st === "success" ? "text-ok bg-ok/10" : st === "error" ? "text-err bg-err/10" : "text-warn bg-warn/10";
                return (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="flex items-center -space-x-2">
                      <ChainMark chain={r.source.chain} size={28} />
                      <ChainMark chain={r.destination.chain} size={28} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="num text-base font-semibold">{fmt(r.amount)} {r.token}</div>
                      <div className="truncate text-sm text-ink-2">
                        {L(r.source.chain).name} {lang === "ru" ? "в" : "to"} {L(r.destination.chain).name}
                        <span className="num ml-2">{new Date(h.createdAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                      </div>
                    </div>
                    <span className={`rounded-[8px] px-2 py-0.5 text-xs font-medium ${tone}`}>
                      {liveInTab ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 motion-safe:animate-spin" />{currentStep ? stepLabel(t, currentStep.name) : t("progress")}</span> : inProgress ? t("status_inprogress") : t(`status_${st}` as TKey)}
                    </span>
                    <div className="flex items-center">
                      {r.steps.filter((s) => s.txHash).map((s, i) => {
                        const url = explorerFor({ from: r.source.chain, to: r.destination.chain })(s);
                        return url ? (
                          <a key={i} href={url} target="_blank" rel="noreferrer" title={stepLabel(t, s.name)} aria-label={`${stepLabel(t, s.name)}: ${t("explorer")}`}
                            className="inline-flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-tint hover:text-primary">
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null;
                      })}
                    </div>
                    {st !== "success" && !liveInTab ? (
                      <Button size="sm" variant="outline" className="rounded-[8px] border-rule bg-sheet text-ink hover:bg-tint" onClick={() => retryResult(r, h.id, h.createdAt, h.network)}>
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

      <footer>
        <div className="mx-auto max-w-[64ch] px-4 pb-10 text-center text-xs leading-relaxed text-ink-2">
          <p>{t("footer")}</p>
          <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            <a className="underline underline-offset-2 hover:text-ink" href="https://developers.circle.com/cctp" target="_blank" rel="noreferrer">developers.circle.com/cctp</a>
            <a className="underline underline-offset-2 hover:text-ink" href="https://docs.arc.io/app-kit/bridge" target="_blank" rel="noreferrer">docs.arc.io/app-kit/bridge</a>
          </p>
        </div>
      </footer>

      {/* Confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="gap-0 rounded-[20px] border-rule bg-sheet p-0 sm:max-w-[460px] max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-b-none">
          <DialogHeader className="px-6 pt-6 text-left">
            <DialogTitle className="text-sm font-medium text-ink-2">{t("confirmTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("confirmTitle")}</DialogDescription>
          </DialogHeader>
          {from && to ? (
            <div className="max-h-[80vh] overflow-y-auto px-6 pb-6">
              <div className="font-display-amount mt-1">{fmt(amount)} <span className="text-xl text-ink-2">{token}</span></div>
              <div className="mt-5"><RouteStrip from={from} to={to} progress={0} active={false} label={`${fmt(amount)} ${token}`} /></div>
              <div className="mt-2 flex justify-between text-sm text-ink"><span>{L(from).name}</span><span>{L(to).name}</span></div>

              <div className="mt-5 space-y-3">
                <AddrBlock k={t("sender")} a={srcAddress ?? ""} />
                <AddrBlock k={t("recipient")} a={recipient} />
              </div>

              <div className="mt-5 space-y-2.5">
                <ReceiptRow k={t("speed")} v={fast ? t("fast") : t("standard")} />
                <ReceiptRow k={t("relayer")} v={useRelayer ? t("on") : t("off")} />
                {feeRows.map((f, i) => <ReceiptRow key={i} k={feeLabel(f.type)} v={`${fmt(f.amount)} ${f.token}`} />)}
              </div>
              <div className="tear my-4" aria-hidden />
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{t("youReceive")}</span>
                <span className="num font-display text-xl font-semibold">≈ {fmt(receive)} <span className="text-base text-ink-2">{token}</span></span>
              </div>

              {network === "mainnet" ? (
                <div className="mt-5 flex gap-2.5 rounded-[12px] bg-warn/10 px-3 py-2.5 text-sm text-warn">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />{t("realFunds")}
                </div>
              ) : null}
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
                {t("checkedRecipient")}
              </label>
              <div className="mt-5 flex gap-2">
                <Button variant="ghost" className="h-[52px] flex-1 rounded-[12px]" onClick={() => setConfirmOpen(false)}>{t("cancel")}</Button>
                <PrimaryButton className="flex-[2]" disabled={!checked} onClick={startBridge}>{t("confirm")}</PrimaryButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReceiptRow({ k, v, strong = false }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={strong ? "font-medium" : "text-ink-2"}>{k}</span>
      <span className={`num text-right ${strong ? "text-base font-semibold" : ""}`}>{v}</span>
    </div>
  );
}
function SkelRow() {
  return <div className="flex items-center justify-between"><span className="skeleton h-3.5 w-28" /><span className="skeleton h-3.5 w-16" /></div>;
}
function AddrBlock({ k, a }: { k: string; a: string }) {
  return (
    <div>
      <div className="text-sm text-ink-2">{k}</div>
      <div className="mt-1 flex items-start gap-1 rounded-[12px] bg-tint px-3 py-2.5 font-mono text-[13px] leading-relaxed break-all">
        <span className="flex-1">{a}</span><CopyButton text={a} />
      </div>
    </div>
  );
}

function PrimaryButton({ className = "", disabled, onClick, children }: { className?: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`inline-flex h-[52px] w-full items-center justify-center rounded-[12px] bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-tint disabled:text-ink-2 disabled:opacity-100 ${className}`}>
      {children}
    </button>
  );
}

function WalletChip({ label, icon, address, onDisconnect, disabled = false }: { label: string; icon?: string | undefined; address: string; onDisconnect: () => void; disabled?: boolean }) {
  const { t } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-rule bg-sheet px-2.5 text-sm font-medium text-ink" aria-label={`${label} ${address}`}>
          {icon ? <img src={icon} alt="" className="size-5 rounded-[6px]" /> : <Wallet className="size-4 text-ink-2" />}
          <span className="num">{shortAddr(address)}</span>
          <ChevronDown className="size-3.5 text-ink-2" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-[12px] border-rule bg-sheet">
        <DropdownMenuLabel className="font-medium text-ink-2">{label}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => { navigator.clipboard?.writeText(address).catch(() => {}); }} className="gap-2"><Copy className="size-4" />{t("copyAddress")}</DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onDisconnect} className="gap-2 text-err focus:text-err"><LogOut className="size-4" />{t("disconnect")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
