# @reley/core-cli

Reley command-line tool — clone Solana programs into a LiteSVM sandbox, replay mainnet transactions locally, simulate tx templates, run workflows + test suites.

## Install

```sh
npm i -g @reley/core-cli
# binary lands as `reley` (also `relay` alias)
```

## Quick start

```sh
reley project init my-amm
reley program add Stake11111111111111111111111111111111111111
reley sandbox spawn dev
reley sim tx ./fee-update.json
reley replay 4z3v…hgw1
```

Full docs: https://github.com/relay-protocol/reley
