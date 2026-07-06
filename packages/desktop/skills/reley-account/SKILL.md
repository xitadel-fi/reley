---
name: reley-account
description: Clone accounts and programs from chain, derive PDAs, decode account data via IDL. Per-version IDL fallback so accounts decode correctly across upgrades.
---

# Programs and accounts

A Reley project tracks two kinds of programs: cloned (from RPC) and local
(loaded from a `.so` file). Each program owns zero or more accounts, and
each program may have multiple **versions** of the ELF.

## File layout

```
.reley/
  programs/<programId>.json                       # program metadata + versions[]
  programs/<programId>/accounts/<address>.json    # per-account metadata
  idls/<programId>.json                           # program-default IDL
  idls/<programId>__<versionId>.json              # per-version IDL (optional)
  blobs/<sha256>.bin                              # content-addressed blobs
```

### `programs/<programId>.json` (multi-version)

```json
{
  "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "label": "SPL Token",
  "activeVersionId": "v-2025-06-01",
  "versions": [
    {
      "id": "v-2025-06-01",
      "label": "mainnet @ slot 425000000",
      "elfBlobHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "source": { "kind": "cloned", "slot": "425000000" },
      "idlId": null,
      "createdAt": 1781000000000
    },
    {
      "id": "v-local-test",
      "label": "local build",
      "elfBlobHash": "8e6b6c...",
      "source": { "kind": "localFile", "path": "/abs/path/program.so" },
      "idlId": null,
      "createdAt": 1781050000000
    }
  ],
  "elfBlobHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "source": { "kind": "cloned", "slot": "425000000" },
  "clonedAtSlot": "425000000",
  "idlId": null,
  "upgradeAuthority": null
}
```

Top-level `elfBlobHash` / `source` / `clonedAtSlot` always mirror the **active**
version. Legacy single-version files (no `versions[]`) are upgraded to
multi-version on first read by `ProgramFolderSink`.

### `programs/<programId>/accounts/<address>.json`

```json
{
  "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "label": "USDC",
  "blobHash": "73f22a37...",
  "clonedAtSlot": "425454825",
  "source": "cloned"
}
```

Account bytes live at `.reley/blobs/<blobHash>.bin`.

## IDL resolution (for decoding)

When decoding an account or building an ix, Reley resolves the IDL in this
order:

1. `idls/<programId>__<versionId>.json` for the **effective** version
2. `idls/<programId>.json` (program-default)
3. None → decoder returns raw bytes

Effective version = explicit override → sandbox pin
(`session.programVersionOverrides[programId]`) → project active
(`program.activeVersionId`).

## Built-in programs

Some programs ship pre-installed in LiteSVM — no clone needed, no IDL needed
(they're native):

- System: `11111111111111111111111111111111`
- SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- Memo: `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- ATA: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
- Compute Budget: `ComputeBudget111111111111111111111111111111`

## Deriving accounts

PDAs and ATAs are derived inside the Tx Builder via the **Derive address**
dialog. The result is just a base58 string — there's no separate "PDA"
record. To reuse a PDA across templates, paste it into the template's
`accounts[].pubkey`.

## Cross-references

- `reley-tx-template` — how derived addresses get used in instructions.
- `reley-versions` — add / switch / pin versions; per-version IDL attach.
- `reley-patch` — how to mutate a cloned account's state.
