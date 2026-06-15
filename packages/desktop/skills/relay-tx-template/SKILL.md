---
name: relay-tx-template
description: How to read, write, and edit Relay tx-template JSON files at .relay/tx-templates/<id>.json. Format, account-index ordering, multi-signer + version-pin at run time.
---

# Tx templates

A tx template is a saved sequence of one or more instructions that can be
loaded into the Tx Builder UI, run inside a workflow, or executed
programmatically via IPC.

## File location

`<projectRoot>/.relay/tx-templates/<id>.json` — one file per template.
`<id>` is a UUIDv4. Renaming the file is fine — Relay re-indexes by `id`
inside the JSON, not by filename.

## Shape

```json
{
  "id": "6b5f1339-b93f-4d22-bbd1-d67aae04f0aa",
  "name": "mint usdc mainnet",
  "description": "",
  "ixs": [
    {
      "programId": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "programLabel": "Associated Token Account",
      "instructionName": "CreateIdempotent",
      "summary": "6 accounts",
      "accounts": [
        { "pubkey": "<payer>",   "isSigner": true,  "isWritable": true  },   // #0
        { "pubkey": "<ata>",     "isSigner": false, "isWritable": true  },   // #1
        { "pubkey": "<owner>",   "isSigner": false, "isWritable": false },   // #2
        { "pubkey": "<mint>",    "isSigner": false, "isWritable": false },   // #3
        { "pubkey": "11111111111111111111111111111111", "isSigner": false, "isWritable": false },   // #4
        { "pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "isSigner": false, "isWritable": false }   // #5
      ],
      "dataBase64": "AQ=="
    },
    {
      "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "programLabel": "SPL Token",
      "instructionName": "MintTo",
      "summary": "amount=10000",
      "accounts": [
        { "pubkey": "<mint>",        "isSigner": false, "isWritable": true  },   // #0
        { "pubkey": "<destination>", "isSigner": false, "isWritable": true  },   // #1
        { "pubkey": "<authority>",   "isSigner": true,  "isWritable": false }    // #2
      ],
      "dataBase64": "BxAnAAAAAAAA"
    }
  ],
  "computeUnitLimit": null,
  "airdropLamports": "10000000000",
  "createdAt": 1781058811248,
  "updatedAt": 1781059020554
}
```

## Account ordering

Accounts are **positional** — index 0 is the first account passed to the
program, index 1 the second, etc. The TxBuilder UI surfaces an `#N` badge on
every row in both Instruction mode (IDL-named) and Raw mode. Don't reorder
unless the program contract permits it.

## Field semantics

- `ixs[]` — executed top-to-bottom. **Order matters.** Common bug: MintTo
  placed before the ATA `CreateIdempotent` — the destination token account
  doesn't exist yet, SPL Token returns `InvalidAccountData`. Create the
  destination ATA *before* invoking MintTo / Transfer to it.
- `dataBase64` — base64 of the encoded instruction-data bytes.
- `accounts[].isSigner` — every signer pubkey must either be the payer or be
  registered as a project keypair (`.relay/keypairs/keypairs.json`).
- `computeUnitLimit` — `null` = LiteSVM default (200_000). Set explicitly
  for budget-sensitive workloads.
- `airdropLamports` — pre-funds the ephemeral payer with this many lamports
  before each send. String, not number — JSON-safe for u64.

## Run-time params (NOT stored on the template)

These are passed at `tx.simulate` / `tx.send` time, not baked into the JSON:

- `payerKeypairId` — which dev keypair pays the fee (first signer)
- `additionalSignerKeypairIds: string[]` — extra dev keypairs whose pubkeys
  match `isSigner: true` accounts other than the payer. Backend dedupes the
  payer from the list before `signTransaction(tx, signers)`.
- `programVersionOverrides: { [programId]: versionId }` — pin a specific
  program version for this single run. Session pin restored after. Resolution
  order: explicit override → session pin → project active version.

## Common edits

- **Reorder ixs**: swap array elements.
- **Replace a placeholder pubkey**: search-replace within `accounts[].pubkey`.
- **Rename the template**: edit `name` (or double-click in the UI).

After any edit the Tx Builder reloads next time the template Select reopens;
the file watcher also triggers an auto-reload in the background.

## Cross-references

- Built-in programs: SPL Token `TokenkegQ...`, ATA `ATokenGP...`, System
  `11111111111111111111111111111111`, Compute Budget `ComputeBudget111...`.
- `summary` is a human-only hint; engines ignore it.
- See `relay-workflow` for chaining templates into multi-step runs (per-step
  version pins + additional-signers live there).
- See `relay-versions` for multi-version testing.
- See `relay-keypair` for adding signer keypairs.
- See `relay-troubleshooting` for diagnostics output meanings.
