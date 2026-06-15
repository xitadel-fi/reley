---
name: relay-workflow
description: How to author Relay workflow JSON files at .relay/workflows/<id>.json. Step kinds, ordering, tx-template link, per-step version pin + extra signers.
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
      "payerKeypairId": "kp-alice-id",
      "additionalSignerKeypairIds": ["kp-mint-authority-id"],
      "programVersionOverrides": {
        "AmmProg111111111111111111111111111111111111": "v-2025-06-01"
      }
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
| `tx`                  | Send a transaction; mirrors a tx-template's `ixs[]` |
| `airdrop`             | Fund a pubkey with lamports inside the session |
| `warpTime`            | Advance LiteSVM clock by `seconds` (slot + unix_timestamp) |
| `warpSlot`            | Jump to absolute `slot` (unix_timestamp scaled by 0.4s/slot) |
| `expireBlockhash`     | Force any pre-signed tx to need a new blockhash |
| `resetSession`        | Wipe sandbox state to project's initial clone |
| `setProgramVersion`   | Flip session-level version pin for one program (persistent) |

## `setProgramVersion` step fields

| Field | Meaning |
|---|---|
| `programId` | Base58 program id (must exist in project `.relay/programs/`) |
| `versionId` | UUID of the version to pin, or `null` to unpin (follow project active) |

Effect: calls `sessions.pinProgramVersion(sessionId, programId, versionId)`
then invalidates the runtime so the new ELF + IDL re-hydrate before the
next step. The flip survives until another `setProgramVersion` step or end
of run.

Difference vs `tx.programVersionOverrides`: the per-tx-step override is
applied + restored inside a single tx step's `finally`. `setProgramVersion`
is a *persistent* flip — the right tool when running V1 then V2 then V1
to exercise upgrade/downgrade paths back-to-back.

## Tx step fields

| Field | Meaning |
|---|---|
| `templateId` | Source template (used by Reload to re-sync `ixs`) |
| `ixs` | Frozen snapshot of the ixs run; **this is what executes** |
| `computeUnitLimit` | CU cap; `null` → LiteSVM default |
| `airdropPayerLamports` | Pre-fund the payer before sending |
| `payerKeypairId` | Dev keypair that pays the fee (= first signer). `null` → ephemeral keypair generated, must be funded via `airdropPayerLamports` |
| `additionalSignerKeypairIds` | Dev keypairs whose pubkeys match non-payer `isSigner: true` accounts. Backend dedupes payer from this list. Required for multi-sig ixs. |
| `programVersionOverrides` | Per-step `{ programId: versionId }` pin. Applied before the tx runs, restored in `finally` after (so a failed step still cleans up). Workflow-step pin beats session pin beats project active. |

## Tx step → template link

`tx` steps carry both `templateId` *and* a snapshot of `ixs[]`. The snapshot
is what actually runs. `templateId` only enables the "Reload" button to
re-sync `ixs` from the saved template if it was edited.

To rebuild a workflow tx step's ixs from its template:
1. Read `.relay/tx-templates/<templateId>.json`
2. Copy its `ixs[]` into the workflow step's `ixs[]`
3. Save

## Execution semantics

- Steps run top-to-bottom in the active session.
- **Halt-on-fail**: if a step throws or a tx step's send fails, no subsequent
  step runs. Results array returned so far. For assertion-driven runs that
  must not halt on failed tx, use `relay-tests` instead.
- Tx step pins are wrapped in try/finally — previous pins always restored,
  even on throw.
- The run result captures success/failure, duration, and (for `tx` steps)
  cu consumed + logs.

## Cross-references

- `relay-tx-template` — instruction format.
- `relay-tests` — assertion-driven multi-case sibling; no halt on tx fail.
- `relay-versions` — manage program versions before pinning.
- `relay-keypair` — add signer keypairs.
- `relay-troubleshooting` — debugging failed steps.
