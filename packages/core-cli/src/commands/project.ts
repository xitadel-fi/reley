import { IpcMethod, type NetworkId } from '@reley/shared';
import { createHost } from '../host.js';
import { printJson } from './print.js';

export async function projectCreateCmd(
  name: string,
  opts: { description?: string; network: string; rpc: string },
): Promise<void> {
  const { dispatcher } = await createHost();
  const project = await dispatcher.call(IpcMethod.ProjectCreate, {
    name,
    ...(opts.description !== undefined && { description: opts.description }),
    network: opts.network as NetworkId,
    rpcEndpointId: opts.rpc,
  });
  printJson(project);
}

export async function projectListCmd(): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.ProjectList));
}

export async function projectOpenCmd(id: string): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.ProjectOpen, { id }));
}

export async function projectDeleteCmd(id: string): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.ProjectDelete, { id }));
}
