---
name: relay-troubleshooting
description: Common Relay failure modes — invalid account data on MintTo, mint authority mismatch on cloned mainnet mints, missing signers, multi-sig signer mismatch, version-pin desync, snapshot replay failure, blank screen after sandbox click, worker exit codes — and their fixes.
---

# Relay troubleshooting

Reference list of failure signatures and fixes.

---

## `InvalidAccountData` on MintTo (or any Token op)

```
Program log: Instruction: MintTo
Program log: Error: InvalidAccountData
Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: invalid account data for instruction
```

**Cause**: the destination token account doesn't exist yet at the moment
MintTo executes. SPL Token reads the destination expecting an
initialized TokenAccount layout; clone yields zeroed bytes; layout invalid.

**Fix**: ensure an ATA `CreateIdempotent` (or Token `InitializeAccount`)
runs **before** the MintTo / Transfer to that destination, in the same
template, in the right index.

Pre-flight rule `mintto-needs-initialized-destination` catches this — Submit
is blocked when it fires.

---

## Authority mismatch on cloned mainnet mint

`MintTo` against a real USDC / WSOL / etc. mint cloned from mainnet fails
because the real mint authority is a multisig you don't control.

**Fix**: write a project patch:

```json
{
  "target": "<mint address>",
  "op": { "kind": "setField", "fieldPath": "mintAuthority", "valueJson": "\"<your keypair pubkey>\"" }
}
```

See `relay-patch` for the setField op.

---

## "no keypair for required signer"

A tx instruction marks an account as `isSigner: true` but the pubkey isn't
in the project keypair store, or isn't selected in `additionalSignerKeypairIds`.

**Fix**: add the keypair (Keypairs panel → Import or Generate), then in
TxBuilder toggle its chip under **Additional signers** (or in a workflow tx
step's `additionalSignerKeypairIds`). If the row truly doesn't need to sign,
flip `isSigner: false` in the template.

---

## Signature verification failed / `MissingRequiredSignature`

Tx contains a signer account whose corresponding keypair wasn't supplied.

**Fix**: every account row with `isSigner: true` needs exactly one keypair
covering it. The first signer is the payer (`payerKeypairId`). All other
signer rows must appear in `additionalSignerKeypairIds`. Backend dedupes
duplicates against the payer, so listing the payer's keypair under
additional signers is harmless (it's filtered out).

---

## "Wrong" program logs after switching project active version

You switched a program's `activeVersionId` but a sandbox shows the old
behaviour.

**Fix**: the sandbox may have a sticky `programVersionOverrides[pid]`
pinning the old version (look for the pin badge next to the program in the
sidebar, or call `session.getVersionPins`). Clear with
`programVersion.pinForSession(sessionId, programId, null)` or via the
sidebar pin chip → Reset. Runtime is invalidated automatically on pin
change.

---

## Snapshot restore brings back old program ELFs

A v2 snapshot captures `programVersions` + `programVersionOverrides`. On
`snapshot.restore`, pass `{ restoreVersions: true }` to also restore the
captured project active versions + sandbox overrides (default is **false** →
restores only sandbox state, leaves program version selection untouched).

v1 snapshots have no version info — they're promoted to v2 on read but
`restoreVersions` is a no-op for them.

---

## "No project" in sidebar after open

Means the worker died during init or returned an empty project list.

Check:
1. `~/Library/Application Support/Relay/worker-trace.log` (macOS) — last
   trace line tells you where boot stopped.
2. `.relay.json` exists at the project root and has `formatVersion: 2`.
3. `.relay/programs/`, `.relay/tx-templates/`, etc. exist (Relay creates
   them on first save; missing dirs are auto-created).

If `formatVersion: 1`, Relay auto-migrates on load. If migration fails,
delete `.relay.json` and re-create the project from Welcome.

---

## Blank screen after clicking a sandbox

React hook order violation — rare. Was fixed in TxBuilderPanel by moving
all `useMemo` calls above the early-return for `!activeSessionId`. If you
see it again in dev tools, look for `Minified React error #310` and find the
component with a hook below an early `return`.

---

## CSP "Refused to load image data:..."

Renderer index.html CSP must include `img-src 'self' data:` so inline SVG
data-URIs (used by Select chevron) render.

---

## Lucide icons invisible / clipped

If you see buttons rendering without their icon, the global `button { padding,
background, border }` rule in styles.css is interfering. The reset at top of
the file should keep buttons transparent + zero padding so Tailwind owns
sizing.

---

## Worker exits with code 1 right after spawn

Open `~/Library/Application Support/Relay/worker-trace.log`. The last line
before the exit shows the failure point:

- `main:enter` only → import error
- `main:ctx-created` → manifest parse / migration failure
- `main:ctx-loaded` only → dispatcher or serve setup error

Race condition fix (already applied): RPC requests can arrive during
`ctx.load()`. Worker now buffers them on a dedicated listener and drains
once the dispatcher is built. If you see this regress, check that the
buffer listener is attached **before** the seal adapter.

---

## Cross-references

- `relay-tx-template` — instruction ordering + run-time signer params.
- `relay-workflow` — per-step pin / multi-signer fields.
- `relay-versions` — manage + diff program versions.
- `relay-snapshot` — capture / restore including version metadata.
- `relay-patch` — fixing cloned-state mismatches.
