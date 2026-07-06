---
name: reley-tests
description: Group multiple test cases with expectations on tx outcome, error/log substrings, CU range, and account state. Failed tx never halts the suite — each case keeps running so you get full pass/fail coverage.
---

# Test Suites

A **test suite** groups multiple **testcases**. Each testcase is an ordered
list of steps (same kinds as workflow: tx, airdrop, warp, expire, reset),
plus optional **expectations** that assert observed behavior. Unlike
workflows, the runner **never halts on failed tx** — every step runs, every
expectation is evaluated, and pass/fail is recorded per step + per case.

## File location

`<projectRoot>/.reley/test-suites/<id>.json` — one file per suite.

## Shape

```json
{
  "id": "5a9c...",
  "name": "amm-swap-suite",
  "description": "Happy path + access control + insufficient funds",
  "cases": [
    {
      "id": "case-1",
      "name": "happy path: alice swaps 100 USDC for SOL",
      "description": "Successful swap, balances move, CU under budget",
      "resetBefore": true,
      "steps": [
        {
          "kind": "airdrop",
          "id": "...",
          "name": "fund alice",
          "pubkey": "Ai1ceeee...",
          "lamports": "10000000000"
        },
        {
          "kind": "tx",
          "id": "...",
          "name": "swap",
          "templateId": "tpl-swap-id",
          "ixs": [ /* mirrored from template */ ],
          "computeUnitLimit": 200000,
          "payerKeypairId": "kp-alice-id",
          "additionalSignerKeypairIds": [],
          "txExpectations": [
            { "kind": "shouldSucceed", "value": true },
            { "kind": "cuRange", "min": 50000, "max": 180000 },
            { "kind": "logContains", "substring": "Program log: swap ok" }
          ],
          "accountExpectations": [
            {
              "kind": "tokenBalance",
              "ata": "Ai1ce-usdc-ata...",
              "op": "eq",
              "value": "0"
            },
            {
              "kind": "lamports",
              "address": "Ai1ceeee...",
              "op": "ge",
              "value": "100000000"
            },
            {
              "kind": "fieldEquals",
              "address": "PoolState111...",
              "path": "reserveUsdc",
              "op": "gt",
              "value": "100"
            }
          ]
        }
      ]
    },
    {
      "id": "case-2",
      "name": "access control: wrong authority rejected",
      "description": "Tx must fail with custom error",
      "resetBefore": true,
      "steps": [
        {
          "kind": "tx",
          "id": "...",
          "name": "swap with wrong signer",
          "templateId": "tpl-swap-id",
          "ixs": [ /* … */ ],
          "payerKeypairId": "kp-mallory-id",
          "txExpectations": [
            { "kind": "shouldSucceed", "value": false },
            { "kind": "errorMessageContains", "substring": "Unauthorized" }
          ]
        }
      ]
    }
  ],
  "createdAt": 1718000000000,
  "updatedAt": 1718000000000
}
```

## TestCase fields

| Field | Meaning |
|---|---|
| `id` | UUID |
| `name` | Human label |
| `description` | What this case verifies |
| `steps` | Ordered step list (same step kinds as workflows) |
| `resetBefore` | If `true`, runner resets sandbox state before this case |

## Step kinds

Same as workflows: `tx`, `airdrop`, `warpTime`, `warpSlot`,
`expireBlockhash`, `resetSession`, `setProgramVersion`. Tx steps support
the same fields (`templateId`, `ixs`, `computeUnitLimit`,
`airdropPayerLamports`, `payerKeypairId`, `additionalSignerKeypairIds`,
`programVersionOverrides`). See `reley-workflow`.

### `setProgramVersion` — persistent version flip

Switches the sandbox-level program-version pin **for the rest of the
run** (unlike `programVersionOverrides` on a tx step, which restores
after the step). Use this to test program upgrade/downgrade flows:

```json
{ "kind": "setProgramVersion", "id": "...", "name": "upgrade to V2",
  "programId": "Prog11111...", "versionId": "<v2-version-id>" }
```

- `versionId: null` → unpin, fall back to project active version.
- Forces SVM re-hydration so the new ELF + IDL load before the next step.
- IDL-driven account decoding (`fieldEquals`) automatically uses
  whichever version is pinned at evaluation time.

Canonical upgrade/downgrade testcase:
1. `setProgramVersion` → V1
2. `tx` init / seed state
3. `setProgramVersion` → V2 (upgrade)
4. `tx` exercise V2 logic — assert new behavior
5. `setProgramVersion` → V1 (downgrade)
6. `tx` verify V1 still works against V2-written state

## Expectations

Every step may carry `txExpectations[]` (only meaningful for `tx` kind)
and/or `accountExpectations[]` (run after the step regardless of kind).

### `txExpectations[]`

| `kind` | Fields | Pass when |
|---|---|---|
| `shouldSucceed` | `value: boolean` | tx outcome === `value` |
| `errorMessageContains` | `substring: string` | tx errorMessage + logs joined contains substring |
| `logContains` | `substring: string` | any log line contains substring |
| `cuRange` | `min?: number\|null`, `max?: number\|null` | cuConsumed inside `[min,max]` (null = unbounded that side) |

### `accountExpectations[]`

Evaluated against post-step SVM state. Decoding for `fieldEquals` uses
Anchor IDL of the owning program (sandbox pin honored) → native SPL
layout fallback.

| `kind` | Fields | Pass when |
|---|---|---|
| `accountExists` | `address`, `exists: boolean` | account presence in SVM === `exists` (treat `lamports == 0` as missing) |
| `lamports` | `address`, `op`, `value` (string) | `lamports(address) {op} BigInt(value)` |
| `tokenBalance` | `ata`, `op`, `value` (string) | decode SPL Token / Token-2022 layout, compare `amount` |
| `fieldEquals` | `address`, `path` (dot path), `op`, `value` (string) | decode account, walk path, compare. Tries BigInt; falls back to string for `eq`/`neq` |

`op` is one of `eq`, `neq`, `ge`, `le`, `gt`, `lt`. `path` examples:
`amount`, `data.bumps.0`, `mint`, `state.reserveSol`.

## Execution semantics

- Suite runs all cases in order. Cases are independent only if you set
  `resetBefore: true` (otherwise they share sandbox state).
- Within a case, **all steps run** — failed tx never halts.
- Per step: tx outcome captured, then `txExpectations[]` evaluated, then
  `accountExpectations[]` evaluated. Step passes iff every expectation
  passes.
- Per case: passes iff every step passes.
- Suite: passes iff every case passes.
- Tx history entries are still appended (so you can debug in the Tx
  History tab afterwards).
- Per-step `programVersionOverrides` are restored in `finally`, same as
  workflows.

## When to use Tests vs Workflows

- **Workflow**: deterministic ordered sequence; halts on first failure;
  good for "set up the world", "reproduce this bug", or pre-flight
  scenarios.
- **Test suite**: assertion-driven; never halts; multiple scenarios
  grouped; good for regression coverage of program logic across
  upgrades.

## RPC methods

| Method | Params | Returns |
|---|---|---|
| `testSuite.list` | `{ projectId }` | `TestSuite[]` |
| `testSuite.save` | `{ projectId, id?, name, description?, cases }` | saved `TestSuite` |
| `testSuite.delete` | `{ projectId, id }` | `{ ok: true }` |
| `testSuite.run` | `{ sessionId, suiteId? | cases? }` | `TestSuiteRunResult` |

## UI workflow (current desktop build)

1. **Land on Automations Home** — recent-runs grid combines workflows +
   test suites. Empty project → 2 big CTAs.
2. **Open or create** — sidebar `Automations → Test Suites`. Clicking a
   suite row opens a **read-only Detail view** first: hero header, KPI
   tiles (Cases / Steps / Expectations / Last-run pass-rate %), last-run
   banner, case cards (per-case PASS/FAIL pill, step count, expectation
   count, reset-before indicator).
3. **Edit** — explicit `Edit` button on the detail toolbar. Sticky toolbar
   with Back / Save / Run. Headline name + description inputs. Case list
   with per-case step editor.
4. **Per-step controls** — color-coded kind icon, idx pill, name, Move
   up/down, Duplicate, Remove. Expectations attach inline per step.
5. **Run** — results push to the **bottom console dock** `Results` tab.
   PASS/FAIL pill in banner. CaseResultView shows per-case nested step
   results with expectation outcomes (description + actual/expected meta).

## First-run guide

Banner above the editor on first creation (`id === ''`) lists the 4-step
flow: name the suite → add a case → attach expectations → save + run.
Persisted via `relay:guide-testSuite-done`.

## Cross-references

- `reley-workflow` — same step kinds, halt-on-fail semantics
- `reley-tx-template` — instruction definitions
- `reley-versions` — version pins
- `reley-account` — account decoding (used by `fieldEquals`)
- `reley-sandbox` — sandbox isolation for case state
- `reley-troubleshooting` — debug failed expectations
