declare global {
  interface Window {
    relay: {
      call(method: string, params?: unknown): Promise<unknown>;
      platform: 'darwin' | 'win32' | 'linux' | 'freebsd' | 'openbsd' | 'sunos' | 'aix' | string;
      window: {
        minimize(): void;
        maximize(): void;
        close(): void;
      };
      context: {
        projectRoot: string | null;
        isWelcome: boolean;
      };
      onMenu(cb: (cmd: string) => void): () => void;
      onFilesChanged(cb: (info: { paths: string[] }) => void): () => void;
    };
  }
}

export const api = {
  call: <T>(method: string, params?: unknown): Promise<T> =>
    window.relay.call(method, params) as Promise<T>,
  platform: window.relay.platform,
  windowCtl: window.relay.window,
  context: window.relay.context,
  onMenu: window.relay.onMenu,
  onFilesChanged: window.relay.onFilesChanged,
};
