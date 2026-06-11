---
name: relay-patch
description: How to write Relay state patches at .relay/patches/<id>.json. Op kinds (setField/setLamports/setOwner/rawSplice), scope semantics, and apply order.
---

# State patches

Patches mutate cloned account state inside a session — useful for forcing
specific conditions (e.g. set a mint authority to a keypair you control,
change pool balances, override a config flag).

## File location

`<projectRoot>/.relay/patches/<id>.json` — one per patch.

## Shape

```json
{
  "id": "patch-uuid",
  "target": "<base58 account address>",
  "op": { "kind": "setField", "fieldPath": "mintAuthority", "valueJson": "\"<payer-pubkey>\"" },
  "createdAt": 1781058811248,
  "enabled": true
}
```

## Op kinds

| `kind`        | Fields                                | Meaning |
|---------------|---------------------------------------|---------|
| `setField`    | `fieldPath` (dotted), `valueJson`     | IDL-aware field set; works on Anchor + native accounts (e.g. SPL Mint) |
| `setLamports` | `lamports` (bigint string or bigint)  | Replace account's lamports balance |
| `setOwner`    | `owner` (base58 program pubkey)       | Reassign account owner |
| `rawSplice`   | `offset` (number), `bytes` (Uint8Array bytes/base64) | Overwrite a byte range of `data` |

`valueJson` is JSON-encoded — `"\"foo\""` for string, `"42"` for number,
`"null"` for null, `"{\"x\":1}"` for nested objects. Don't pass raw values.

## Scope semantics

Patches have a scope determined by WHICH index file they sit under in the
session/project graph (not in the patch JSON itself):

- **Project scope**: applies to every session.
- **Session scope**: applies to one session only.

Eval order on session open: **project patches → session patches**. Session
patches win on conflict (last-write-wins on the same target).

`enabled: false` keeps the patch in storage but skips it during apply.

## Common patterns

- **"I cloned USDC from mainnet and need to mint to myself"**
  - Add a patch on the USDC mint address: `setField` `mintAuthority` →
    `"<your payer pubkey>"`. Then your `MintTo` ix using payer as authority
    will succeed.
- **"Drain an account to 0 lamports to test fee handling"**
  - `setLamports` with `0`.
- **"Reassign account ownership for cross-program tests"**
  - `setOwner` to the new program id.

## Cross-references

- `relay-account` — locate accounts to patch.
- `relay-tx-template` — re-test after patch by running a tx that depends on
  the changed field.
