# Contributing to Reley

Thanks for considering a contribution. This document tells you how to get a working dev setup, the conventions the codebase follows, and what makes a PR easy to merge.

## Code of Conduct

Be respectful. Disagreements about code are normal; disagreements about people are not. Maintainers may close issues or PRs that violate this.

## Quick start

```bash
git clone git@github.com:hoangtuanictvn/reley.git reley
cd reley
pnpm install
pnpm build
pnpm test
```

Requirements:
- Node **≥ 20** (see `.nvmrc`)
- pnpm **11**
- macOS / Linux / Windows (Electron supports all three; CI primarily exercises macOS)

To run the desktop app in dev:

```bash
pnpm --filter @reley/desktop dev
```

To run only one package's tests during iteration:

```bash
pnpm --filter @reley/core test
```

## Project layout

See **[README.md → Layout](README.md#layout)**. Briefly:

- `packages/shared` — shared types, zod schemas, IPC method names. **No runtime deps on Electron or Node-only modules.**
- `packages/core` — engine (LiteSVM wrapper, patch engine, replayer, RPC server). Runs in the Electron worker thread. **No DOM, no Electron imports.**
- `packages/core-cli` — Node CLI driver over the same dispatcher the desktop app uses.
- `packages/desktop` — Electron main + preload + React renderer.
- `examples/` — standalone projects (each with their own `package.json` + `pnpm-workspace.yaml`) that demonstrate talking to a Reley session via JSON-RPC. Not part of the monorepo workspace.

## Branching + PRs

1. Fork the repo.
2. Branch from `main`: `git checkout -b feat/short-description` (or `fix/`, `docs/`, `refactor/`, `test/`).
3. Commit early, commit often. Small atomic commits >> one huge dump.
4. Push and open a PR against `main`.
5. Describe **what** changed and **why**. Include screenshots / GIFs for UI changes.
6. Link related issues (`Fixes #123`).
7. Be ready for review comments — none are personal.

## Commit messages

Follow this shape (loosely [Conventional Commits](https://www.conventionalcommits.org/)):

```
<area>: <imperative one-liner>

<optional longer explanation of why, not what>
```

Examples:

```
core/replayer: hydrate ProgramData accounts for upgradeable loader
desktop/tx-builder: keep selected instruction args after edit click
docs: expand the JSON-RPC endpoint section
```

`area` is usually a package or feature name (`core`, `desktop`, `cli`, `examples/mint-usdc`, `core/snapshot`, etc.).

## Coding conventions

- **TypeScript strict** everywhere. Use precise types; don't `as any` unless you leave a `// why:` comment.
- **No new abstractions for hypothetical futures.** Add code for the feature in front of you. Refactor when the third caller arrives.
- **Default to no comments.** Code + good names should explain *what*. Comments are reserved for *why* — non-obvious invariants, workarounds for a specific upstream bug, performance subtleties.
- **Don't add error handling for cases that can't happen.** Validate at boundaries (user input, network, file I/O). Trust internal calls.
- **No `console.log` left behind.** CLI tools may print to stdout; engine code should `log()` via the dispatcher's log stream.
- **Format + lint** with Biome:
  ```bash
  pnpm lint
  pnpm format
  ```

## Tests

- Engine changes (anything in `packages/core`) **require tests**. The bar is "the bug you fixed has a test that catches it next time."
- Use `vitest`. Tests live next to the code or under `packages/<name>/test/`.
- UI changes don't need unit tests, but please verify the change manually in `pnpm --filter @reley/desktop dev` and mention what you did in the PR.

```bash
pnpm test                 # all packages
pnpm --filter @reley/core test
```

## When you change…

- **Add an IPC method** → declare it in `packages/shared/src/ipc/methods.ts`, add the request/response zod schema, implement in `packages/core/src/rpc/handlers.ts`. Renderer calls via `api.call('your.method', {...})`.
- **Add a native instruction decoder** → edit `packages/core/src/instructions/native-ix.ts`. Add a round-trip test.
- **Add a patch op type** → `packages/core/src/store/patch-engine.ts` + matching renderer form. Round-trip test in `packages/core/test/patch-engine.test.ts`.
- **Add a JSON-RPC method to the server** → `packages/core/src/rpc-server/solana-rpc-server.ts`. Mirror Solana's response shape exactly — clients (`@solana/web3.js`) are picky.
- **Touch the patch / snapshot / replay determinism** → run `pnpm test` and double-check the canonical-JSON sort order isn't disturbed. Snapshot hashes are part of the public API.

## What we will (and won't) merge

We **will** merge:
- Bug fixes with a regression test.
- New native instruction decoders (SPL programs, well-known ecosystem programs).
- IDL ergonomics, account suggestion improvements, Tx Builder UX.
- New examples in `examples/` (with their own README).
- JSON-RPC method coverage (anything `@solana/web3.js` actually calls and we don't support).
- Performance work with before/after numbers.

We **probably won't** merge:
- Rewrites without a concrete problem statement.
- New abstractions justified only by "future flexibility."
- Style-only / pure-comment PRs (we run Biome in CI).
- Changes that pull in heavy runtime deps for marginal features.
- Anything that touches snapshot hashing without a determinism justification.

## Security

If you find a security issue (e.g. the keypair vault leaks secrets, the JSON-RPC server lets a remote caller escape the session, the worker bridge fails open), **don't open a public issue**. Email the maintainer (see GitHub profile) or open a private security advisory on GitHub.

## License

Reley is [PolyForm Noncommercial 1.0.0](LICENSE). By contributing, you agree your contribution is licensed under the same terms. If your employer claims ownership of your code, get clearance first.

## Recognition

Contributors are credited via git history. Thanks for helping make this thing better.
