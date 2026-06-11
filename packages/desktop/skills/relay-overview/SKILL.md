---
name: relay-overview
description: Orientation for an AI coding agent working inside a Relay project — what Relay is, where state lives on disk, and the read-paths for understanding the current sandbox state.
---

# Relay project — orientation

This folder is a **Relay** project: a Solana program sandbox backed by LiteSVM.
Relay clones programs + accounts from chain, lets you patch state, build
transactions, run workflows, and replay mainnet transactions — all locally.

## On-disk layout

```
<projectRoot>/
  .relay.json                              # thin manifest — meta only
  .relay/
    programs/<programId>.json              # one file per program (no inline accounts)
    programs/<programId>/accounts/<address>.json   # one file per account
    tx-templates/<id>.json                 # one file per saved tx template
    workflows/<id>.json                    # one file per workflow
    scripts/<id>.json                      # one file per script
    patches/<id>.json                      # one file per state patch
    sessions/<id>.json                     # one file per session (sandbox state)
    idls/<idlId>.json                      # one file per attached IDL
    keypairs/keypairs.json                 # dev keypairs (plain base58, project-local only)
    blobs/<sha256>.bin                     # content-addressed ELF / account-data blobs
```

The split is intentional: each entity is a separate file so two developers
editing different templates/workflows never conflict in git.

`.relay.json` is the **thin manifest** — only metadata (id, name, network,
rpcEndpointId, sessionIds, keypairRefs, createdAt, lastOpenedAt, pinned,
formatVersion). All sub-collections live in their per-entity folders above.

## When you should read what

- **"What is this project?"** → `.relay.json`
- **"Which programs are cloned?"** → list `.relay/programs/*.json`
- **"Which accounts under program X?"** → list `.relay/programs/<X>/accounts/*.json`
- **"What templates exist?"** → list + read `.relay/tx-templates/*.json`
- **"What sessions/state snapshots exist?"** → list `.relay/sessions/*.json`
- **"What's failing right now?"** → check `.relay/worker-fatal.log` (if present) and
  `~/Library/Application Support/Relay/logs/worker-*.log` (mac).

## Format versions

`formatVersion` on the manifest is an integer. Current = 2. If you see 1,
delete the file and let Relay recreate, or run the v1→v2 migration by
re-opening (Relay auto-migrates on load).

## Sibling skills

- `relay-tx-template` — build / edit a tx template
- `relay-workflow` — chain steps into a workflow
- `relay-patch` — write state patches
- `relay-account` — clone or derive accounts
- `relay-keypair` — manage dev keypairs
- `relay-troubleshooting` — common gotchas
