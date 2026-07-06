import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';

const FORMAT_VERSION = 1;
const MAX_RECENTS = 20;

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export interface RpcEndpoint {
  id: string;
  label: string;
  url: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet' | 'custom';
  isDefault?: boolean;
}

export interface AppPreferences {
  theme?: 'dark' | 'light';
  rpcServerBasePort?: number;
}

export interface AppState {
  formatVersion: number;
  recentProjects: RecentProject[];
  rpcEndpoints: RpcEndpoint[];
  preferences: AppPreferences;
}

const DEFAULTS: AppState = {
  formatVersion: FORMAT_VERSION,
  recentProjects: [],
  rpcEndpoints: [
    {
      id: 'mainnet-public',
      label: 'Mainnet (Public)',
      url: 'https://api.mainnet-beta.solana.com',
      network: 'mainnet-beta',
      isDefault: true,
    },
    {
      id: 'devnet-public',
      label: 'Devnet',
      url: 'https://api.devnet.solana.com',
      network: 'devnet',
    },
  ],
  preferences: { theme: 'dark', rpcServerBasePort: 8899 },
};

export class AppStore {
  private state: AppState = DEFAULTS;
  private readonly path: string;

  constructor() {
    this.path = join(app.getPath('userData'), 'app.json');
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) {
      this.state = structuredClone(DEFAULTS);
      await this.save();
      return;
    }
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as AppState;
      this.state = {
        formatVersion: FORMAT_VERSION,
        recentProjects: Array.isArray(parsed.recentProjects) ? parsed.recentProjects : [],
        rpcEndpoints:
          Array.isArray(parsed.rpcEndpoints) && parsed.rpcEndpoints.length > 0
            ? parsed.rpcEndpoints
            : DEFAULTS.rpcEndpoints,
        preferences: { ...DEFAULTS.preferences, ...(parsed.preferences ?? {}) },
      };
    } catch {
      this.state = structuredClone(DEFAULTS);
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2));
    await rename(tmp, this.path);
  }

  recentProjects(): RecentProject[] {
    return this.state.recentProjects
      .filter(
        (r) =>
          existsSync(join(r.path, '.reley.json')) ||
          existsSync(join(r.path, '.relay.json')),
      )
      .slice(0, MAX_RECENTS);
  }

  async pushRecent(path: string, name: string): Promise<void> {
    const filtered = this.state.recentProjects.filter((r) => r.path !== path);
    filtered.unshift({ path, name, lastOpened: Date.now() });
    this.state.recentProjects = filtered.slice(0, MAX_RECENTS);
    await this.save();
  }

  async removeRecent(path: string): Promise<void> {
    this.state.recentProjects = this.state.recentProjects.filter((r) => r.path !== path);
    await this.save();
  }

  rpcEndpoints(): RpcEndpoint[] {
    return this.state.rpcEndpoints;
  }

  async upsertRpc(ep: RpcEndpoint): Promise<void> {
    const idx = this.state.rpcEndpoints.findIndex((e) => e.id === ep.id);
    if (idx >= 0) this.state.rpcEndpoints[idx] = ep;
    else this.state.rpcEndpoints.push(ep);
    await this.save();
  }

  async deleteRpc(id: string): Promise<void> {
    this.state.rpcEndpoints = this.state.rpcEndpoints.filter((e) => e.id !== id);
    await this.save();
  }

  preferences(): AppPreferences {
    return { ...this.state.preferences };
  }

  async setPreferences(p: Partial<AppPreferences>): Promise<void> {
    this.state.preferences = { ...this.state.preferences, ...p };
    await this.save();
  }
}

let instance: AppStore | null = null;

export function getAppStore(): AppStore {
  if (!instance) instance = new AppStore();
  return instance;
}
