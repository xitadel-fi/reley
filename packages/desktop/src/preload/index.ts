import { contextBridge, ipcRenderer } from 'electron';

const RPC_CHANNEL = 'relay:rpc';

function parseProjectRootFromArgv(): string | null {
  for (const a of process.argv) {
    if (a.startsWith('--relay-project-root=')) {
      return a.slice('--relay-project-root='.length);
    }
  }
  return null;
}

function parseIsWelcome(): boolean {
  return process.argv.some((a) => a === '--relay-welcome');
}

const api = {
  call: async (method: string, params?: unknown): Promise<unknown> => {
    const resp = (await ipcRenderer.invoke(RPC_CHANNEL, method, params)) as
      | { ok: true; result: unknown }
      | { ok: false; error: { code: string; message: string } };
    if (!resp.ok) {
      const err = new Error(resp.error.message);
      (err as Error & { code?: string }).code = resp.error.code;
      throw err;
    }
    return resp.result;
  },
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('relay:window:minimize'),
    maximize: () => ipcRenderer.send('relay:window:maximize'),
    close: () => ipcRenderer.send('relay:window:close'),
  },
  context: {
    projectRoot: parseProjectRootFromArgv(),
    isWelcome: parseIsWelcome(),
  },
  onMenu: (cb: (cmd: string) => void): (() => void) => {
    const handler = (_e: unknown, cmd: string): void => cb(cmd);
    ipcRenderer.on('relay:menu', handler);
    return () => ipcRenderer.removeListener('relay:menu', handler);
  },
  onFilesChanged: (cb: (info: { paths: string[] }) => void): (() => void) => {
    const handler = (_e: unknown, info: { paths: string[] }): void => cb(info);
    ipcRenderer.on('relay:files-changed', handler);
    return () => ipcRenderer.removeListener('relay:files-changed', handler);
  },
};

contextBridge.exposeInMainWorld('relay', api);

export type RelayApi = typeof api;
