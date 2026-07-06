# @reley/core

Headless engine for Reley — LiteSVM sandbox, RPC cloner, Anchor patcher, mainnet replayer, trace parser, snapshot store.

Used by:
- `@reley/core-cli` — terminal driver
- Reley Desktop — Electron app
- Reley Cloud — hosted SaaS

## Install

```sh
npm i @reley/core
```

## Use

```ts
import {
  bootSvm,
  cloneAccountsFromRpc,
  parseTrace,
  serializeSnapshot,
} from '@reley/core';

const svm = await bootSvm({ programs: ['...'] });
```

Full docs: https://github.com/relay-protocol/reley
