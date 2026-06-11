---
name: relay-account
description: How accounts are stored, cloned, and derived inside a Relay project. File layout for programs/<X>/accounts/<addr>.json and the on-disk blob store.
---

# Programs and accounts

A Relay project tracks two kinds of programs: cloned (from RPC) and local
(loaded from a `.so` file). Each program owns zero or more accounts.

## File layout

```
.relay/
  programs/<programId>.json                       # program metadata
  programs/<programId>/accounts/<address>.json    # per-account metadata
  blobs/<sha256>.bin                              # content-addressed blob storage
```

### `programs/<programId>.json`

```json
{
  "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "label": "SPL Token",
  "elfBlobHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "source": { "kind": "cloned", "slot": "0" },
  "idlId": null,
  "upgradeAuthority": null,
  "clonedAtSlot": "0"
}
```

`source.kind` is `"cloned"` (from chain) or `"localFile"` (from disk path).
The ELF bytes live at `.relay/blobs/<elfBlobHash>.bin`.

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

Account bytes live at `.relay/blobs/<blobHash>.bin`.

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
record. If you want to reuse a PDA across templates, paste it into the
template's `accounts[].pubkey`.

## Cross-references

- `relay-tx-template` — how derived addresses get used in instructions.
- `relay-patch` — how to mutate a cloned account's state.
