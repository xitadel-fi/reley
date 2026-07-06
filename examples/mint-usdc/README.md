# Mint USDC against a Reley session

This example "mints" mainnet USDC into a fresh wallet by talking to a Reley-hosted LiteSVM session via its Solana JSON-RPC endpoint. No mainnet SOL needed.

The trick: USDC's real mint authority on mainnet is controlled by Circle. In your local Reley session, that account is just a cloned byte array — patch its `mintAuthority` field to a keypair you control and the SPL Token Program happily mints into any account.

## One-time setup in Reley

1. **Open Reley** → create a project with `network = mainnet-beta` and a public mainnet RPC URL.
2. **Add programs** (sidebar → Programs → + Add):
   - `SPL Token` (built-in, instant attach)
   - `Associated Token Account` (built-in)
3. **Add the USDC mint account** (sidebar → SPL Token → + Add account):
   - Address: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
   - Cloned from mainnet, persisted in project
4. **Generate two keypairs** (Keypairs view → Generate):
   - Label `payer` — fee payer
   - Label `mint-authority` — controls minting after the patch
5. **Export the keypairs to disk** (currently: from the vault, copy pubkey + paste secret into JSON files, see "Bootstrap keypairs" below for an alternative).
6. **Create a session** (sidebar → Sessions → + Add). Pick it as active.
7. **Airdrop SOL** to your payer (Workflows or Keypairs → Airdrop SOL, 5 SOL is plenty).
8. **Patch the USDC mint's `mintAuthority` field**:
   - Right-click the USDC account in the sidebar → **Patch fields…**
   - Scope: `session` (or `project` to make it sticky across sessions)
   - Patch type: `setField`
   - Field path: `mintAuthority`
   - Value: `"<base58 pubkey of your mint-authority keypair>"` (JSON-encoded string — quotes matter)
   - Save patch — the native SPL Token Mint layout is detected automatically.
9. **Start the RPC server** (Inspector right pane → Details → RPC endpoint → Start). Default port `8899`. Copy the **Session URL**.

## Bootstrap keypairs

If you don't want to copy secrets out of the Reley vault by hand:

```bash
# Generate two keypairs locally
solana-keygen new -o payer.json --no-bip39-passphrase
solana-keygen new -o mint-authority.json --no-bip39-passphrase

# Show their pubkeys (paste these into Reley)
solana-keygen pubkey payer.json
solana-keygen pubkey mint-authority.json
```

Then in Reley → Keypairs → **Import** → paste the JSON array from each file → label them. Use the mint-authority's pubkey when patching USDC.

## Run

```bash
# 1. install deps
pnpm install

# 2. (optional but recommended) generate local keypairs + print pubkeys to paste into Reley
pnpm setup

# 3. edit .env — fill in RELEY_SESSION_URL, RECIPIENT_PUBKEY, AMOUNT_USDC
$EDITOR .env

# 4. run
pnpm start
```

### Keypair env vars

`PAYER_KEYPAIR` and `MINT_AUTHORITY_KEYPAIR` accept any of:
- **base58 secret** (e.g. exported from Phantom / Solflare / Backpack) — easiest, just paste the 88-char string
- **filesystem path** to a Solana-CLI JSON keypair file
- **inline JSON array** literal like `[12,34,...]`

`pnpm setup` prints both pubkey and base58 secret for the generated keypairs so you can copy directly into `.env`.

`pnpm start` uses Node's built-in `--env-file=.env` flag — no extra dotenv dep, env vars get auto-loaded. Override per-run by passing them inline:

```bash
AMOUNT_USDC=42 pnpm start
```

Output:
```
session: http://127.0.0.1:8899/session/...
payer:           <pubkey>
mint-authority:  <pubkey>
recipient:       <pubkey>
ata:             <pubkey>
mint:            EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
balance before:  0 USDC
tx signature:    <signature>
balance after:   1000 USDC
done.
```

## What the script does

1. Resolves the recipient's USDC ATA via the ATA program seeds.
2. Builds a single transaction with three instructions:
   - `ComputeBudgetProgram.setComputeUnitLimit(200_000)`
   - `createAssociatedTokenAccountIdempotentInstruction` — creates the ATA if it doesn't already exist
   - `createMintToInstruction` — mints to the ATA signed by `mint-authority`
3. Sends via `Connection.sendTransaction` to your Reley session URL.
4. Calls `getTokenAccountBalance` to confirm.

## Common errors

| Error | Cause |
|-------|-------|
| `AccountNotFound` (mint) | Forgot step 3 — USDC mint isn't cloned into the project |
| `0x4 InvalidMintAuthority` | Skipped step 8 — patch didn't apply, or used a different keypair |
| `InsufficientFundsForFee` | Payer has no SOL — airdrop more |
| `AlreadyProcessed` | Reley auto-rotates blockhash; if you still hit this, the same tx may have been resent — randomize amount or wait a tick |
