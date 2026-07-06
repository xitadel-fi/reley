import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CoreContext, Dispatcher, buildHandlers } from '@reley/core';

export interface HostOptions {
  projectRoot?: string;
}

const LEGACY_CLI_ROOT = '.relay-cli-project';
const CLI_ROOT = '.reley-cli-project';

export function defaultProjectRoot(): string {
  const explicit = process.env.RELEY_PROJECT_ROOT ?? process.env.RELAY_PROJECT_ROOT;
  if (explicit) return explicit;
  // Prefer the new default. Fall back to the legacy folder if only it exists
  // so installs done before the rename keep working.
  const next = join(homedir(), CLI_ROOT);
  if (existsSync(next)) return next;
  const legacy = join(homedir(), LEGACY_CLI_ROOT);
  if (existsSync(legacy)) return legacy;
  return next;
}

export async function createHost(opts: HostOptions = {}): Promise<{
  ctx: CoreContext;
  dispatcher: Dispatcher;
}> {
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();
  const ctx = new CoreContext({ projectRoot });
  await ctx.load();

  const dispatcher = new Dispatcher(
    buildHandlers({
      ctx,
      resolveRpcUrl: (endpointId) => {
        const envUrl = process.env.RELEY_RPC_URL ?? process.env.RELAY_RPC_URL;
        if (envUrl) return envUrl;
        if (endpointId.startsWith('http://') || endpointId.startsWith('https://')) {
          return endpointId;
        }
        return 'https://api.mainnet-beta.solana.com';
      },
      persist: () => ctx.save(),
    }),
  );

  return { ctx, dispatcher };
}
