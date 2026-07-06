import { IpcMethod } from '@reley/shared';
import { createHost } from '../host.js';
import { printJson } from './print.js';

export async function programAddCmd(
  programId: string,
  opts: { project: string; rpcUrl?: string; slot?: string },
): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(
    await dispatcher.call(IpcMethod.ProgramAdd, {
      projectId: opts.project,
      programId,
      ...(opts.rpcUrl !== undefined && { rpcUrl: opts.rpcUrl }),
      ...(opts.slot !== undefined && { slot: opts.slot }),
    }),
  );
}

export async function programListCmd(opts: { project: string }): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.ProgramList, { projectId: opts.project }));
}

export async function programRemoveCmd(
  programId: string,
  opts: { project: string },
): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(
    await dispatcher.call(IpcMethod.ProgramRemove, {
      projectId: opts.project,
      programId,
    }),
  );
}
