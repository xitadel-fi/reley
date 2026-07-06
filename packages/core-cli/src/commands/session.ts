import { IpcMethod } from '@reley/shared';
import { createHost } from '../host.js';
import { printJson } from './print.js';

export async function sessionCreateCmd(name: string, opts: { project: string }): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.SessionCreate, { projectId: opts.project, name }));
}

export async function sessionListCmd(opts: { project?: string }): Promise<void> {
  const { dispatcher } = await createHost();
  const params = opts.project ? { projectId: opts.project } : {};
  printJson(await dispatcher.call(IpcMethod.SessionList, params));
}

export async function sessionDeleteCmd(id: string): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.SessionDelete, { id }));
}

export async function sessionResetCmd(id: string): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.SessionReset, { id }));
}
