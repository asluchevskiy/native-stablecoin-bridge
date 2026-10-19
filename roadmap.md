# Mainnet transfer fixes
## EURC totals
- [x] Force EURC forwarding and preserve USDC relayer preference.
- [x] Add cached RPC gas fallback, allowance checks, estimated row notes and USD totals in receipt/confirmation.
- [x] Add and run tests, check automatic production validation and both wallet-free browser routes.

- [x] Normalize and persist EURC events, transaction hashes and attestation data.
- [x] Show expected steps with stable durations and real route progress.
- [x] Isolate concurrent transfers by trace ID and keep background rows live.
- [x] Restore remembered wallets silently after reload.
- [x] Explain fee recipients and client-side USD estimates with a 60-second cache.
- [x] Refresh balances after completion; verify tests and desktop/mobile browser states.
- [x] Check automatic production validation signal (manual build commands are prohibited by the environment).
- [ ] Real wallet/mainnet execution check — blocked by absence of a wallet extension and user-authorized funds.

## Usage fixes
- [x] History menus, protected removal, five-second Undo and clear completed.
- [x] Neutral unknown status for saved transfers that cannot resume.
- [x] Wallet-independent estimates, isolated estimate adapter and public USDC fee fallback.
- [x] Route-specific arrival text; 53 tests passed, live wallet-free estimates and history interactions verified, automatic build validation passed.

## Localization and timing
- [x] Add complete Ukrainian translations, persisted browser-language selection and locale formatting.
- [x] Use Circle source-chain attestation times and display downgrade/Linea notices.
- [x] Update README live link and language list; 108 tests and automatic build checks passed; browser language persistence, mobile settings and Linea/Arc timing verified.

## Source code link
- [x] Add the public repository link to the desktop header, the mobile settings popover and the footer in EN/RU/UA; 122 tests and automatic build checks passed; header, footer and popover verified in both themes and on mobile.