import { IpcMethod } from '@reley/shared';
import { createHost } from '../host.js';
import { printJson } from './print.js';

export async function accountAddCmd(
  address: string,
  opts: { project: string; program: string; label?: string; rpcUrl?: string; slot?: string },
): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(
    await dispatcher.call(IpcMethod.AccountAdd, {
      projectId: opts.project,
      programId: opts.program,
      address,
      ...(opts.label !== undefined && { label: opts.label }),
      ...(opts.rpcUrl !== undefined && { rpcUrl: opts.rpcUrl }),
      ...(opts.slot !== undefined && { slot: opts.slot }),
    }),
  );
}

export async function accountListCmd(opts: {
  project: string;
  program?: string;
}): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(
    await dispatcher.call(IpcMethod.AccountList, {
      projectId: opts.project,
      ...(opts.program !== undefined && { programId: opts.program }),
    }),
  );
}

export async function accountRemoveCmd(address: string, opts: { project: string }): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(
    await dispatcher.call(IpcMethod.AccountRemove, {
      projectId: opts.project,
      address,
    }),
  );
}
