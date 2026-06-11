---
name: relay-workflow
description: How to author Relay workflow JSON files at .relay/workflows/<id>.json. Step kinds, ordering, and how tx steps reference tx-templates.
---

# Workflows

A workflow is a named sequence of steps run against a session. Steps include
tx submits, airdrops, time warps, blockhash expiry, and session reset. They
let you reproduce a deterministic chain of operations.

## File location

`<projectRoot>/.relay/workflows/<id>.json` — one per workflow.

## Shape

```json
{
  "id": "5a9c...",
  "name": "setup-and-swap",
  "description": "Mint USDC then swap to SOL via amm-program",
  "steps": [
    {
      "kind": "airdrop",
      "id": "...",
      "name": "fund the user",
      "pubkey": "<user-pubkey>",
      "lamports": "1000000000"
    },
    {
      "kind": "tx",
      "id": "...",
      "name": "mint setup",
      "templateId": "6b5f1339-b93f-4d22-bbd1-d67aae04f0aa",
      "ixs": [ /* mirror of templateId's ixs[] at time of last sync */ ],
      "computeUnitLimit": null,
      "airdropPayerLamports": "10000000000",
      "payerKeypairId": null
    },
    {
      "kind": "warpTime",
      "id": "...",
      "name": "+1 minute",
      "seconds": 60
    },
    {
      "kind": "expireBlockhash",
      "id": "...",
      "name": "force re-sign"
    },
    {
      "kind": "resetSession",
      "id": "...",
      "name": "clean slate"
    }
  ],
  "createdAt": ...,
  "updatedAt": ...
}
```

## Step kinds

| `kind`            | Meaning |
|-------------------|---------|
| `tx`              | Send a transaction; mirrors a tx-template's `ixs[]` |
| `airdrop`         | Fund a pubkey with lamports inside the session |
| `warpTime`        | Advance LiteSVM clock by `seconds` |
| `warpSlot`        | Jump to absolute `slot` |
| `expireBlockhash` | Force any pre-signed tx to need a new blockhash |
| `resetSession`    | Wipe sandbox state to project's initial clone |

## Tx step → template link

`tx` steps carry both `templateId` *and* a snapshot of `ixs[]`. The
snapshot is what actually runs. `templateId` only enables the "Reload"
button to re-sync `ixs` from the saved template if it was edited.

To rebuild a workflow tx step's ixs from its template:
1. Read `.relay/tx-templates/<templateId>.json`
2. Copy its `ixs[]` into the workflow step's `ixs[]`
3. Save

## Execution semantics

- Steps run top-to-bottom in the active session.
- Halt-on-fail: if a step fails, no subsequent step runs.
- The run result captures success/failure, duration, and (for `tx` steps)
  cu consumed + logs.

## Cross-references

- `relay-tx-template` — instruction format.
- `relay-troubleshooting` — debugging failed steps.
