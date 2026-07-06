# Reley examples

Sample scripts that talk to a Reley session via its JSON-RPC endpoint. Use as integration-test references.

| Example | What it shows |
|---------|---------------|
| [mint-usdc](./mint-usdc) | Patch USDC mint authority to a local keypair, then mint arbitrary USDC into any wallet through the session RPC. No mainnet SOL required. |

Each example is a standalone Node + TypeScript project. Install with `pnpm install` inside the example folder.

## Common prerequisites

- Reley desktop app running with a project + active session
- RPC server started (Inspector → Details → RPC endpoint → Start)
- Session URL copied — looks like `http://127.0.0.1:8899/session/<sessionId>`
- A funded payer keypair in the session (Workflows or Keypairs panel → Airdrop SOL)
