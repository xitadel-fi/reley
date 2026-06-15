---
name: relay-versions
description: Multi-version program management in Relay — adding versions (clone / local .so / blob hash), switching project active, pinning per session, pinning per workflow step, comparing IDLs + tx behaviour across versions.
---

# Program versions

Relay tracks many versions of each program so you can test forward / backward
compatibility (upgrade, rollback, A/B) without re-cloning. Each version has
its own ELF blob and (optionally) its own IDL.

## On disk

```
.relay/programs/<programId>.json
  versions: [
    { id, label, elfBlobHash, source, idlId?, createdAt },
    ...
  ]
  activeVersionId: <id of the version that "is" this program by default>
  elfBlobHash / source / clonedAtSlot: mirror the active version (legacy field compat)
```

Per-version IDLs live at `.relay/idls/<programId>__<versionId>.json` (the
default `.relay/idls/<programId>.json` is the fallback when no per-version
IDL is attached).

## Adding a version

UI: Programs → pick program → Versions menu → **Add version…** opens a tabbed dialog.

| Tab | Field | Source kind |
|---|---|---|
| Clone from RPC | network + slot (optional) | `{ kind: 'cloned', slot }` |
| Local .so file | path (Browse… opens native picker) | `{ kind: 'localFile', path }` |
| Existing blob hash | blob sha256 | `{ kind: 'existing', blobHash }` |

Every Add writes a new `versions[]` entry; `activeVersionId` stays where it
was. Switch active with **Set active**.

IPC equivalents (see `@relay/shared/src/ipc/methods.ts`):

```ts
programVersion.list({ projectId, programId })
programVersion.add({ projectId, programId, label, source })
programVersion.remove({ projectId, programId, versionId })
programVersion.setActive({ projectId, programId, versionId })
programVersion.setLabel({ projectId, programId, versionId, label })
programVersion.pinForSession({ projectId, sessionId, programId, versionId | null })
```

`setActive` invalidates every session in the project. `pinForSession`
invalidates only that one session.

## Resolution order at run time

When a session loads a program's ELF, or when an ix decoder picks an IDL:

1. Explicit run-time override (`programVersionOverrides` on `tx.simulate` /
   `tx.send` / `tx.compareVersions`, or on a workflow tx step).
2. Session pin (`session.programVersionOverrides[programId]`).
3. Project active (`program.activeVersionId`).

Session-level pin is sticky across runs until you clear it. Workflow-step
pin is applied around that one step only — restored in `finally` after.

## Pinning a session

UI: sidebar row of the program → click the version badge → pick a version.
A pin badge appears next to the program label whenever the session
overrides project active.

IPC:
```ts
await api.programVersion.pinForSession({
  projectId, sessionId, programId, versionId: 'v-local-test',
});
// clear:
await api.programVersion.pinForSession({
  projectId, sessionId, programId, versionId: null,
});
```

Inspect current pins:
```ts
const pins = await api.session.getVersionPins({ sessionId });
// → { [programId]: versionId }
```

## Pinning per workflow step

In a workflow tx step JSON:

```json
{
  "kind": "tx",
  "programVersionOverrides": {
    "AmmProg111111111111111111111111111111111111": "v-2025-06-01"
  }
}
```

Step pin wraps in try/finally — previous session pin is restored after the
step, even on throw. See `relay-workflow`.

## Persistent flip mid-run (`setProgramVersion` step)

For comparative scenarios that need to run **the same** session across
multiple versions (upgrade, then exercise V2, then downgrade), use the
`setProgramVersion` step kind in workflows / test suites:

```json
{ "kind": "setProgramVersion", "programId": "Prog...", "versionId": "<id>" }
```

Unlike a tx step's `programVersionOverrides` (restored after one step),
`setProgramVersion` is **persistent** — flips the session-level pin and
re-hydrates the SVM so every subsequent step uses the new ELF + IDL until
another `setProgramVersion` step (or end of run). `versionId: null` clears
the pin. See `relay-tests` for full upgrade/downgrade testcase shape.

## Comparing versions

Two purpose-built panels:

- **Run-compare panel**: pick program + left/right versions + a tx template,
  Relay pins left, runs, pins right, runs, returns side-by-side
  `TxResultView`. IPC: `tx.compareVersions({ ...build, leftVersionId,
  rightVersionId })`. Session pin restored after.
- **IDL diff panel**: pick two IDLs (program-default vs versioned, or
  any two), render structural diff per section (instructions / accounts /
  types / events / errors). IPC: `idl.diff(left, right)` / `idl.diffPrograms(...)`.

## Per-version IDL

Attach: `idl.attach({ projectId, programId, idl, versionId? })` — writes to
`idls/<pid>__<vid>.json` if `versionId` is set, else `idls/<pid>.json`.
Detach: `idl.detach({ projectId, programId, versionId? })`.

`account.decode` resolves the version automatically; pass an explicit
`versionId` to override.

## Removing a version

`programVersion.remove` refuses to remove the last version. If you remove
the active one, Relay picks the most-recently created remaining version as
the new active.

## Cross-references

- `relay-snapshot` — snapshot v2 captures + optionally restores version pins.
- `relay-workflow` — per-step pin field + `setProgramVersion` persistent flip.
- `relay-tests` — multi-case test suites; canonical upgrade/downgrade testcase.
- `relay-tx-template` — `programVersionOverrides` at run time.
- `relay-account` — IDL fallback chain for decoding.
