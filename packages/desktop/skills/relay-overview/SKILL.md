---
name: relay-overview
description: Orientation for an AI coding agent working inside a Relay project — what Relay is, where state lives on disk, the multi-version + multi-signer model, and the read-paths for understanding current sandbox state.
---

# Relay project — orientation

This folder is a **Relay** project: a Solana program sandbox backed by LiteSVM.
Relay clones programs + accounts from chain, lets you patch state, build
transactions, run workflows, replay mainnet transactions, and test multi-version
program upgrades — all locally.

## On-disk layout

```
<projectRoot>/
  .relay.json                                # thin manifest — meta only
  .relay/
    programs/<programId>.json                # program metadata (multi-version)
    programs/<programId>/accounts/<addr>.json
    tx-templates/<id>.json                   # tx templates
    workflows/<id>.json                      # workflows
    test-suites/<id>.json                    # test suites (multi-case, expectation-driven)
    scripts/<id>.json                        # scripts
    patches/<id>.json                        # state patches
    sandboxes/<id>.json                       # sandbox state (per-sandbox overrides)
    idls/<programId>.json                    # program-default IDL
    idls/<programId>__<versionId>.json       # OPTIONAL per-version IDL
    keypairs/keypairs.json                   # dev keypairs (plain base58)
    blobs/<sha256>.bin                       # content-addressed ELF / account blobs
```

`.relay.json` is the **thin manifest** — only meta (id, name, network,
rpcEndpointId, sessionIds, keypairRefs, createdAt, lastOpenedAt, pinned,
formatVersion). All sub-collections live in their per-entity folders above.

## Conceptual model

| Concept | Lives in | Notes |
|---|---|---|
| Program | `programs/<pid>.json` | Has `versions[]` + `activeVersionId`. Top-level `elfBlobHash` mirrors the active version. |
| Program version | inside `versions[]` | id, label, elfBlobHash, source, optional per-version idlId, createdAt |
| Sandbox | `sandboxes/<id>.json` | Sandbox state. `programVersionOverrides` pins ELFs per sandbox. |
| Tx template | `tx-templates/<id>.json` | Frozen ix bytes + accounts. Project-scoped. |
| Workflow | `workflows/<id>.json` | Ordered steps. Tx steps can pin versions + extra signers. Halts on first failed tx. |
| Test suite | `test-suites/<id>.json` | Multiple testcases + per-step expectations. Never halts on failed tx. |
| Patch | `patches/<id>.json` | Mutate cloned state (setField / setLamports / setOwner / rawSplice). |
| Snapshot | inside sandbox `snapshots[]` | Saves state + (since v2) captures `programVersions` + `programVersionOverrides`. |

Pin resolution order at tx-run time: **workflow step pin → sandbox override → project active**.

## When you should read what

- **"What is this project?"** → `.relay.json`
- **"Which programs are cloned, and which versions?"** → list `.relay/programs/*.json`, read `versions[]` + `activeVersionId`
- **"Which accounts under program X?"** → list `.relay/programs/<X>/accounts/*.json`
- **"What templates exist?"** → list + read `.relay/tx-templates/*.json`
- **"What test suites exist?"** → list + read `.relay/test-suites/*.json`
- **"Which sandboxes, and what versions are they pinned to?"** → list `.relay/sessions/*.json` → look at `programVersionOverrides`
- **"What's the IDL for version V of program P?"** → `.relay/idls/<P>__<V>.json` if it exists, else `.relay/idls/<P>.json`

## Format versions

- Manifest `formatVersion`: 2 (current). Loader auto-migrates v1 → v2.
- Snapshot `formatVersion`: 2 (since multi-version). v1 snapshots are auto-promoted on read (no version info captured).

## Sibling skills

- `relay-sandbox` — what a sandbox is, how state is isolated, when to reset
- `relay-tx-template` — build / edit tx templates (includes multi-signer)
- `relay-workflow` — chain steps; per-step version pin + extra signers
- `relay-tests` — multi-case test suites with expectations; never halts on failed tx
- `relay-versions` — multi-version program management (add/switch/pin/diff)
- `relay-patch` — write state patches (project-scope vs sandbox-scope)
- `relay-account` — clone or derive accounts; per-version decode
- `relay-keypair` — manage dev keypairs
- `relay-troubleshooting` — common gotchas

## UI walkthrough (current build)

The desktop app exposes the data model above through these surfaces:

**Left sidebar** (collapsible sections, top-to-bottom):
1. **Sandbox picker** — dropdown right under project name. Quick-switch between sandboxes for the current project. `+` creates a new one (inline prompt — no modal).
2. **Programs** — cloned programs + their accounts.
3. **Automations** — `Workflows` + `Test Suites` sub-sections.
4. **Tx Templates** — saved tx recipes.
5. **Patches** — two clickable rows: `Project` (re-applied on every sandbox) and `Sandbox` (scratch). Each opens the patches workspace focused on that scope.

By default only **Programs** + **Sandbox** are expanded on first launch to reduce decision fatigue. Sections persist their open/closed state per-user.

**Workspace (middle)**
- `Tx Builder` tab — single-tx authoring.
- `Automations` tab — lands on **Automations Home** showing recent runs + 2 big CTAs (`New workflow` / `New test suite`) when project is empty. Clicking a workflow/test-suite item opens a **read-only Detail view** (KPIs, last-run banner, step/case list). User must click **Edit** explicitly to enter the editor — sidebar clicks never dirty state.
- `Patches` tab — split into `Project patches` and `Sandbox patches` pages, picked from sidebar.

**Bottom console dock** (toggle with ⌘J or top-toolbar icon)
- Three tabs: `Tx History`, `Logs`, `Results`.
- Resizable via top-edge drag handle. Height persisted.
- Workflow / test-suite runs auto-push into the **Results** tab — no scrolling to find output. Tab badge flips to `PASS` (green) or `FAIL` (red).

**Right inspector** (toggle ⌘⌥B) — account inspector, ix inspector, help/skill docs.

**Command palette** (⌘K) — search projects, sandboxes, programs, templates + run commands (New workflow, New test suite, Open demo, Reset sandbox, Toggle history dock, Open glossary, etc.).

**First-launch onboarding** — 4-step modal (Sidebar / Workspace / Right pane / Bottom dock) one-shot via localStorage flag.
