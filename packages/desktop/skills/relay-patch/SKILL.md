---
name: relay-patch
description: How to write Relay state patches at .relay/patches/<id>.json. Op kinds (setField/setLamports/setOwner/rawSplice), scope semantics, and apply order.
---

# State patches

Patches mutate cloned account state inside a sandbox — useful for forcing
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
sandbox/project graph (not in the patch JSON itself):

- **Project scope**: applies to every sandbox.
- **Sandbox scope**: applies to one sandbox only.

Eval order on sandbox open: **project patches → sandbox patches**. Sandbox
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

## Two scopes: Project vs Sandbox

| Scope | Where it lives | When it applies |
|---|---|---|
| **Project** | `.relay/patches/<id>.json` | Re-applies on every sandbox open + every sandbox reset. Use for fixtures the whole project depends on. |
| **Sandbox** | inside sandbox state (`sessionPatches[]`) | Lives only in the active sandbox. Cleared on sandbox reset; never propagates to other sandboxes. Use for scratch experiments. |

Pick the scope at patch-creation time (Account Inspector → Patch fields →
scope dropdown). The two sets stack — both apply when present, and the
last-write-wins rule still holds (sandbox patches apply after project
patches, so they override conflicts).

## UI workflow (current desktop build)

- **Sidebar** — `Patches` section has two clickable sub-rows:
  - `Project` → workspace page listing project-scope patches.
  - `Sandbox` → workspace page listing sandbox-scope patches (requires an
    active sandbox).
- **Per-page** — institutional hero header + KPI tiles (Total / Active /
  Accounts / Disabled). Patches grouped by target account in collapsible
  cards. Each row shows op-kind icon (color-coded: amber = setLamports,
  blue = setField, violet = rawSplice, green = setOwner), friendlier op
  label ("Set balance", "Edit field", "Edit bytes", "Set owner"), and
  hover-revealed Eye toggle + Trash button.
- **Creation** — right-click an account in the sidebar → `Patch fields…`.
  The Account Inspector's Patches table also exposes inline new-patch.

## Cross-references

- `relay-account` — locate accounts to patch.
- `relay-tx-template` — re-test after patch by running a tx that depends on
  the changed field.
- `relay-sandbox` — sandbox-scope patches live here.
