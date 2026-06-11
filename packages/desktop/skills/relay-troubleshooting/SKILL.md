---
name: relay-troubleshooting
description: Common Relay failure modes — invalid account data on MintTo, mint authority mismatch on cloned mainnet mints, missing signers, blank screen after session click, worker exit codes — and their fixes.
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
in the project keypair store.

**Fix**: either add the keypair (Keypairs panel → Import) or change the
account to `isSigner: false` in the template if it doesn't actually need
to sign.

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

## Blank screen after clicking a session

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

- `relay-tx-template` — instruction ordering rules.
- `relay-patch` — fixing cloned-state mismatches.
