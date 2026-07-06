#!/usr/bin/env bash
# Bootstraps a payer + mint-authority keypair locally so you can paste their
# pubkeys into Reley (vault + USDC patch). Idempotent — won't clobber existing keys.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v solana-keygen >/dev/null 2>&1; then
  echo "solana-keygen not found. Install Solana CLI:"
  echo "  sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
  exit 1
fi

generate() {
  local name="$1"
  if [[ -f "$name.json" ]]; then
    echo "$name.json already exists — keeping."
  else
    solana-keygen new --silent --no-bip39-passphrase -o "$name.json"
    echo "generated $name.json"
  fi
}

generate payer
generate mint-authority

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example — edit it before running."
fi

b58() {
  # Convert Solana-CLI JSON array to base58 secret using Node + bs58
  node -e "const fs=require('fs');const bs58=require('bs58');const a=JSON.parse(fs.readFileSync('$1','utf8'));process.stdout.write((bs58.default??bs58).encode(Uint8Array.from(a)));"
}

echo ""
echo "── Paste these pubkeys into Reley ────────────────────────────"
echo "payer:           $(solana-keygen pubkey payer.json)"
echo "mint-authority:  $(solana-keygen pubkey mint-authority.json)"
echo ""
echo "── Base58 secrets (paste into .env) ──────────────────────────"
echo "payer secret:           $(b58 payer.json)"
echo "mint-authority secret:  $(b58 mint-authority.json)"
echo ""
echo "1. Open Reley → Keypairs → Import each JSON file (paste the array)"
echo "2. Sidebar → SPL Token → + Add account: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
echo "3. Right-click USDC account → Patch fields…"
echo "     scope:        session (or project)"
echo "     type:         setField"
echo "     field path:   mintAuthority"
echo "     value:        \"$(solana-keygen pubkey mint-authority.json)\""
echo "4. Workflows or Keypairs → airdrop SOL to payer"
echo "5. Inspector → Details → RPC endpoint → Start, copy session URL"
echo "6. Edit .env to paste the session URL + recipient pubkey"
echo "7. pnpm start"
