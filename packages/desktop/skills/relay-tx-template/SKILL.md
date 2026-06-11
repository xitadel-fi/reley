---
name: relay-tx-template
description: How to read, write, and edit Relay tx-template JSON files at .relay/tx-templates/<id>.json. Format reference + common edits.
---

# Tx templates

A tx template is a saved sequence of one or more instructions that can be
loaded into the Tx Builder UI, run inside a workflow, or executed
programmatically via the IPC RPC.

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
        { "pubkey": "<payer>",   "isSigner": true,  "isWritable": true  },
        { "pubkey": "<ata>",     "isSigner": false, "isWritable": true  },
        { "pubkey": "<owner>",   "isSigner": false, "isWritable": false },
        { "pubkey": "<mint>",    "isSigner": false, "isWritable": false },
        { "pubkey": "11111111111111111111111111111111", "isSigner": false, "isWritable": false },
        { "pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "isSigner": false, "isWritable": false }
      ],
      "dataBase64": "AQ=="
    },
    {
      "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "programLabel": "SPL Token",
      "instructionName": "MintTo",
      "summary": "amount=10000",
      "accounts": [
        { "pubkey": "<mint>",        "isSigner": false, "isWritable": true  },
        { "pubkey": "<destination>", "isSigner": false, "isWritable": true  },
        { "pubkey": "<authority>",   "isSigner": true,  "isWritable": false }
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

## Field semantics

- `ixs[]` — executed top-to-bottom. **Order matters.** Common bug: MintTo
  placed before the ATA `CreateIdempotent` — the destination token account
  doesn't exist yet, SPL Token returns `InvalidAccountData`. Always create
  the destination ATA *before* invoking MintTo / Transfer to it.
- `dataBase64` — base64 of the encoded instruction-data bytes.
- `accounts[].isSigner` — every signer pubkey must either be the payer or be
  registered as a project keypair (`.relay/keypairs/keypairs.json`); otherwise
  the send aborts with "no keypair for required signer".
- `computeUnitLimit` — `null` = LiteSVM default (200_000). Set explicitly
  for budget-sensitive workloads.
- `airdropLamports` — pre-funds the ephemeral payer with this many lamports
  before each send. String, not number — JSON-safe for u64.

## Common edits

- **Reorder ixs**: just swap array elements.
- **Replace a placeholder pubkey**: search-replace within `accounts[].pubkey`.
- **Rename the template**: edit `name`.

After any edit the Tx Builder reloads next time the template Select reopens,
or you can refresh manually from the UI.

## Cross-references

- Built-in programs: SPL Token `TokenkegQ...`, ATA `ATokenGP...`, System
  `11111111111111111111111111111111`, Compute Budget `ComputeBudget111...`.
- `summary` is a human-only hint; engines ignore it.
- See `relay-workflow` for chaining templates into multi-step runs.
- See `relay-troubleshooting` for diagnostics output meanings.
