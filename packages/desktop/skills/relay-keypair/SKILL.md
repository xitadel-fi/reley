---
name: relay-keypair
description: Project-scoped dev keypairs. Storage location, format, how to register one for use as a signer in tx templates.
---

# Dev keypairs

Keypairs in Relay are **project-scoped** — they live under the project
folder, not globally. They travel with the project (copy folder = copy
keypairs).

## File location

`<projectRoot>/.relay/keypairs/keypairs.json`

```json
[
  {
    "id": "uuid",
    "label": "payer",
    "pubkey": "<base58>",
    "createdAt": 1781058811248,
    "sealed": false,
    "secret": "<base58 secret key>"
  }
]
```

## Why plaintext?

These are **dev wallets**. They sign sandbox transactions inside LiteSVM,
never real mainnet funds. Sealing them with `safeStorage` (was the original
design) added platform-dependent failure modes — wallets unsealable after
re-install, lockout when copying project across machines — for zero real
security gain in a sandbox.

Verdict: plain base58 on disk. Do not use these for mainnet.

## Operations

- **Generate** (UI Keypairs panel → Generate): creates a new pair, stores
  it, returns the pubkey.
- **Import** (UI → Import): paste a base58 secret OR Solana-CLI JSON
  (`[1,2,3,…,64]`).
- **Airdrop** (UI table → Airdrop): inject lamports into the active
  session for this pubkey.
- **Copy secret**: clipboard, base58.
- **Copy JSON**: clipboard, Solana-CLI format.
- **Delete**: removes from the file. Irreversible.

## Using as a signer

In a tx template, mark the row as a signer:

```json
{
  "pubkey": "<the keypair's pubkey>",
  "isSigner": true,
  "isWritable": false
}
```

At run time:

- **Payer** (first signer) is selected via `payerKeypairId` in the TxBuilder
  or in a workflow tx step's `payerKeypairId` field.
- **Additional signers** are selected via `additionalSignerKeypairIds: string[]`.
  Backend dedupes the payer's pubkey from this list before
  `signTransaction(tx, signers)`.

A tx that has N signer rows needs N distinct keypairs registered here, with
matching pubkeys. Pre-flight diagnostics flag missing signers as a blocking
error.

## Cross-references

- `relay-tx-template` — `isSigner` flags + run-time signer params.
- `relay-workflow` — `additionalSignerKeypairIds` on tx steps.
- `relay-patch` — `setField mintAuthority → <your keypair's pubkey>` so
  cloned mints can be minted from inside the sandbox.
