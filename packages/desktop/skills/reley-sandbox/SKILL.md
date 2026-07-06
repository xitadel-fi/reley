---
name: reley-sandbox
description: Isolated local Solana environments for testing. When to create, reset, or fork. Run scenarios side by side without cross-contamination.
---

# Reley sandbox

A **sandbox** is an isolated Solana environment running locally via LiteSVM.
Every project has one or more sandboxes; each owns its own clock, slot,
accounts, tx history, and (optionally) program-version pins. State in one
sandbox never leaks into another.

> Internally still called `session.*` on IPC + disk for backward compat
> with older projects. The UI says "sandbox" everywhere.

## When to create a new sandbox

- **Multi-scenario testing**: one sandbox per scenario (`happy-path`,
  `out-of-liquidity`, `flash-loan-attack`). Switch via the sandbox dropdown
  at the top of the sidebar.
- **Version comparison**: a sandbox with `programVersionOverrides` pointing to
  v1 and a sibling sandbox pointing to v2. Run the same tx in each, diff.
- **Snapshots & forks**: take a snapshot of a setup-heavy state, then `Fork`
  into a fresh sandbox to run multiple experiments from the same baseline.

## What a sandbox holds

| Field | Meaning |
|---|---|
| `accounts` | All cloned + mutated accounts. |
| `currentSlot` | Sandbox slot. Time-warps update both this and unix_timestamp. |
| `sessionPatches` | Sandbox-scope patches (in addition to project patches). |
| `txHistory` | Per-sandbox tx record list (powers the bottom dock `Tx History` tab). |
| `snapshots` | Saved states; restorable or forkable. |
| `programVersionOverrides` | Per-program ELF pin override. Empty = follow project active. |

## Reset semantics

`Reset sandbox` (sidebar → sandbox context menu, or `⌘K → Reset sandbox`):
- Wipes mutated accounts back to clone baseline.
- Clears tx history.
- Re-applies **project patches** (sandbox-scope patches are dropped — they
  were the scratch pad).
- Keeps the sandbox metadata (id, name, version pins) intact.

For a harder reset, delete the sandbox + create a new one.

## UI surfaces

- **Sandbox picker** — top of left sidebar, right below project name. Quick
  switch. `+` button = inline name prompt → create.
- **Empty state** — when project has no sandboxes, picker shows a single
  `+ Create` CTA.
- **Status chips** — next to each sandbox name: `dirty` (has uncommitted
  mutations), `default` (auto-selected on project open).
- **Snapshots panel** — workspace view for saving + restoring sandbox state.
- **Patches sidebar (Sandbox sub-row)** — scratch patches scoped to the
  active sandbox only.

## Common workflows

1. **Quick scratch testing** — default sandbox + patch values inline.
2. **Reproducible test suite** — name a sandbox per test, snapshot the
   pre-condition state, fork to run individual cases.
3. **Version compare** — two sandboxes (`v1`, `v2`), each with
   `programVersionOverrides[programId] = versionId`. Run identical tx in
   each. Compare CU + logs via the Tx History tab (Compare mode).
