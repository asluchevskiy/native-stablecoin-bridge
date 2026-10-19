<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Circle Bridge Kit SDK and adapters load only via dynamic import in `src/lib/sdk.ts` (with `src/lib/polyfills.ts` first) — they must never run during SSR; each loader is guarded by `import.meta.env.SSR` so the server build never bundles the SDK (its Solana deps fail to resolve for the Worker target).
- Chains, token addresses, RPCs and explorers come from `kit.getSupportedChains()`; never hardcode them — the SDK is the source of truth.
- Partial transfers are continued with `kit.retry(result, ...)`, never a fresh `kit.bridge()` — re-bridging would burn twice.
- Transfer history lives in localStorage (`src/lib/history.ts`) — the app has no backend by design.
- Normalize provider-specific actions and derive expected progress in `src/lib/transfers.ts`; persist retry data and timing independently of the focused receipt so concurrent transfers remain isolated by invocation trace ID.
- Wallet restoration uses remembered provider identity and silent authorization checks only; never request permissions on mount.
- Fee interpretation lives in `src/lib/fees.ts` and public client-side USD quotes in `src/lib/prices.ts`; missing gas or price data must remain unknown rather than create misleading totals.
- Missing EVM gas is estimated read-only in `src/lib/gas.ts` from cached SDK-chain RPC gas prices and typical units, with allowance checks using SDK USDC contracts or Circle's EURC registry; keep fallback provenance through shared fee totals so receipt and confirmation agree.
- The session-only estimate adapter is private to `src/lib/sdk.ts` and only exposed through an estimation operation; bridge and retry guard against estimate adapters because their ephemeral keys must never sign user transfers.
- History safety and Undo merging are pure helpers in `src/lib/history.ts`; current in-tab activity gates removal so history controls cannot destroy a running transfer's recovery data.
- Informational source-chain attestation times and SDK speed-warning detection live in `src/lib/arrival.ts`; they never modify bridge configuration or SDK chain definitions.
- Locale selection uses browser-safe pure helpers in `src/lib/languages.ts` and hydrates/persists in I18nProvider; formatting follows the active locale without touching browser globals during SSR.
