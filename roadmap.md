# Mainnet transfer fixes
- [x] Normalize and persist EURC events, transaction hashes and attestation data.
- [x] Show expected steps with stable durations and real route progress.
- [x] Isolate concurrent transfers by trace ID and keep background rows live.
- [x] Restore remembered wallets silently after reload.
- [x] Explain fee recipients and client-side USD estimates with a 60-second cache.
- [x] Refresh balances after completion; verify tests and desktop/mobile browser states.
- [x] Check automatic production validation signal (manual build commands are prohibited by the environment).
- [ ] Real wallet/mainnet execution check — blocked by absence of a wallet extension and user-authorized funds.

## Usage fixes
- [ ] History menus, protected removal, five-second Undo and clear completed.
- [ ] Neutral unknown status for saved transfers that cannot resume.
- [ ] Wallet-independent estimates, isolated estimate adapter and public USDC fee fallback.
- [ ] Route-specific arrival text; tests, browser checks and automatic build validation.