# Native Stablecoin Bridge

Native Stablecoin Bridge is an independent, client-side web interface for moving USDC and EURC between blockchains using Circle's native burn-and-mint protocol (CCTP). Burned on the source chain, natively minted on the destination by Circle's attestation — no wrapped tokens, no liquidity pools, no counterparty. All bridging logic runs in your browser through Circle's official [Bridge Kit](https://docs.circle.io/) SDK: there is no backend, no database and no account system, and the site adds no fee of its own — you pay only the protocol and gas costs Circle's SDK reports.

**Live site:** <https://native-stablecoin-bridge.lovable.app>

## Features

- **Chains are read from the SDK at runtime** — the supported network list comes from `kit.getSupportedChains()`, so the app never hardcodes chain IDs, token addresses, RPCs or explorers. Mainnet and Testnet are both available.
- **EURC routes checked live** — every EURC source/destination pair is verified against Circle's `CCTPXBridgingProvider.supportsRoute()` before you can pick it, so unsupported routes are never offered.
- **Fast or Standard transfer speed** — Fast arrives in seconds for a small protocol fee; Standard pays no protocol fee and waits for source finality (~15–20 minutes from Ethereum).
- **Optional Circle relayer mint** — where the destination supports it, the mint transaction is covered and broadcast for you, so you don't need gas on the destination chain.
- **Confirmation before signing** — a dialog shows the full route, amount, fees, speed and full recipient address before anything is signed. On mainnet this is required.
- **Transfer history and Resume** — every transfer is written to `localStorage` the moment you confirm and again on each SDK event. A tab that is closed or reloaded mid-transfer can be picked up again with **Resume**, which continues the existing transfer rather than starting a new one.
- **English and Russian** interface, **light and dark** themes, both persisted between visits.
- Wallets are discovered over EIP-6963 (any injected EVM wallet) plus Solana wallets such as Phantom, Solflare or Backpack.

## Tech stack

| | |
| --- | --- |
| Framework | TanStack Start (React 19) with Vite |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4, Radix UI primitives |
| Bridging | `@circle-fin/bridge-kit` 1.15.3, `@circle-fin/adapter-viem-v2` 1.19.1, `@circle-fin/adapter-solana` 1.7.5, `viem` 2 |
| Chain icons | `@web3icons/react` |

## How it works

1. **Approve** — you authorize the CCTP token messenger to spend the amount you're bridging (EURC also approves the burn fee).
2. **Burn** — your USDC or EURC is burned on the source chain by Circle's protocol contract; you receive a transaction hash.
3. **Circle attestation** — Circle observes the burn, waits for source finality, and signs an attestation proving the burn happened.
4. **Mint or relay** — the attestation is redeemed for a native mint on the destination chain, either by your wallet or by Circle's relayer if you enabled it.

## Local development

You need [Bun](https://bun.sh). From the repository root:

```sh
bun install
bun run dev      # start the dev server
bun run build    # production build
```

No environment variables, API keys or backend services are required — the app talks to public chain RPCs and Circle's infrastructure directly from the browser.

## Project structure

```
src/
├── routes/
│   ├── __root.tsx       # app shell: theme, fonts, toaster, head metadata
│   └── index.tsx        # the single "/" page
├── components/bridge/
│   ├── BridgeApp.tsx    # the whole bridge flow: form, estimate, confirm, progress, resume
│   ├── bits.tsx         # presentational pieces: route strip, step tracker, medallions, skeleton rows
│   └── ChainIcon.tsx    # chain logos from @web3icons/react, with a letter-medallion fallback
└── lib/
    ├── sdk.ts           # browser-only lazy loader for Bridge Kit and the viem / Solana adapters
    ├── polyfills.ts     # Buffer / process shims the Solana dependency tree expects
    ├── chains.ts        # chain + token helpers, balance fetching, formatting — all derived from SDK data
    ├── wallets.ts       # EIP-6963 EVM wallet discovery and Solana provider detection
    ├── history.ts       # localStorage transfer log: save, load, resume-safe serialization
    └── i18n.tsx         # English and Russian strings, and the useT() hook
```

## Security notes

- **The SDK runs only in the browser.** Bridge Kit and its adapters are loaded through dynamic imports behind an SSR guard, so nothing bridging-related is bundled into or executed by the server build, and no code of yours is ever sent to a server of ours.
- **No private keys, seed phrases, RPC credentials or secrets live in this repository.** The app holds only public addresses and the results returned by the SDK. Signing always happens inside your own wallet.
- **Never re-run a transfer that stopped part-way.** A partial transfer is continued with `kit.retry()` via **Resume** — calling `bridge()` again for the same transfer would burn funds a second time.
- **Test on testnet first.** Switch to Testnet, take funds from the faucet and bridge a small amount before using real money, and keep the tab open through a Standard transfer if you don't intend to use Resume.
- The SDK's own error reporting is disabled (`disableErrorReporting: true`), so no transfer data is sent to Circle's telemetry from this interface.

## Disclaimer

This project is **not affiliated with, endorsed by, or sponsored by Circle**. "Circle", "USDC", "EURC" and "CCTP" are the property of their respective owners and are used here descriptively. The code is **unaudited** and provided as-is; moving stablecoin value between chains is irreversible and carries the risk of total loss through bugs, user error, protocol changes or chain outages. **Use at your own risk**, and only with funds you can afford to lose.

## Built with

Built with [Lovable](https://lovable.dev).
