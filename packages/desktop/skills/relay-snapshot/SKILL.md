---
name: relay-snapshot
description: Relay sandbox snapshots — what gets captured, the v1 → v2 format bump for multi-version program metadata, and how to restore with or without the captured version pins.
---

# Snapshots

A snapshot freezes a sandbox's full sandbox state so you can re-run a tx,
diff outcomes, or share a repro.

## Where they live

Inline inside the owning sandbox file:

```
.relay/sessions/<id>.json
  snapshots: [
    { id, label, capturedAt, formatVersion, payload, programVersions, programVersionOverrides }
  ]
```

The payload is the LiteSVM raw state (accounts, slot, clock, sysvars). The
version metadata sits next to it so a snapshot taken under ELF v1 can be
identified as such after you've already upgraded the project to v2.

## Format versions

- **v1** (legacy): only `payload`. No knowledge of program versions.
- **v2** (current, `SNAPSHOT_FORMAT_VERSION = 2`): adds
  `programVersions: { [programId]: versionId }` (project active at capture
  time) and `programVersionOverrides: { [programId]: versionId }` (sandbox
  pins at capture time).

v1 snapshots are auto-promoted to v2 on read: their version arrays are left
empty, so `restoreVersions` is a no-op for them.

## Capturing

UI: Sandbox → Snapshots → **Capture**.

IPC:
```ts
await api.snapshot.save({ sessionId, label });
```

`captureFromSession` automatically inspects the sandbox's runtime + the
project store to fill `programVersions` (active version per project program)
and `programVersionOverrides` (current sandbox pins).

## Restoring

```ts
await api.snapshot.restore({ sessionId, snapshotId, restoreVersions });
```

| `restoreVersions` | Behaviour |
|---|---|
| `false` (default) | Restore only the LiteSVM payload. Program version selection (project active + sandbox pins) untouched. |
| `true` | Restore payload **and** apply the captured `programVersions` to `program.activeVersionId` for each program, then apply `programVersionOverrides` to the sandbox. Runtime invalidated after. |

Use `restoreVersions: true` when reproducing a bug that's bound to a specific
ELF combination. Use the default when you just want to rewind sandbox state
under your current versions.

## Diff / replay

A snapshot pairs nicely with `tx.compareVersions`: restore an old snapshot
(`restoreVersions: true`), then re-run the failing tx against the current
active version to see what's diverged.

## Cross-references

- `relay-versions` — managing the underlying program versions.
- `relay-tx-template` — re-running a frozen ix against restored state.
- `relay-troubleshooting` — "Snapshot restore brings back old program ELFs".
