import { randomUUID } from 'node:crypto';
import { cp, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BrowserWindow, shell } from 'electron';
import { getAppStore } from './app-store';

const cpAsync = promisify(cp);
import {
  shutdownWorkerForWindow,
  spawnWorkerForWindow,
  type SpawnOptions,
} from './workerMgr';

const RELAY_MANIFEST = '.relay.json';
// Keep in sync with STORE_FORMAT_VERSION in @relay/core/store/persistence.ts.
const PROJECT_FORMAT_VERSION = 2;

const windowToPath = new Map<number, string>();
const pathToWindow = new Map<string, number>();
let welcomeWindow: BrowserWindow | null = null;

export interface CreateProjectOptions {
  name: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet' | 'custom';
  rpcEndpointId: string;
  description?: string;
}

export async function createProjectFolder(
  projectPath: string,
  opts: CreateProjectOptions,
): Promise<void> {
  if (!existsSync(projectPath)) {
    await mkdir(projectPath, { recursive: true });
  }
  const manifestPath = join(projectPath, RELAY_MANIFEST);
  if (existsSync(manifestPath)) return; // Already a project; just open it.

  const relayDir = join(projectPath, '.relay');
  await mkdir(join(relayDir, 'sessions'), { recursive: true });
  await mkdir(join(relayDir, 'blobs'), { recursive: true });
  await mkdir(join(relayDir, 'keypairs'), { recursive: true });
  await mkdir(join(relayDir, 'idls'), { recursive: true });
  // Per-entity dirs for v2 thin manifest layout.
  await mkdir(join(relayDir, 'programs'), { recursive: true });
  await mkdir(join(relayDir, 'tx-templates'), { recursive: true });
  await mkdir(join(relayDir, 'workflows'), { recursive: true });
  await mkdir(join(relayDir, 'scripts'), { recursive: true });
  await mkdir(join(relayDir, 'patches'), { recursive: true });

  const now = Date.now();
  // v2 thin manifest: meta only. Sub-collections live in `.relay/*` folders.
  const manifest = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: cryptoRandomId(),
    name: opts.name,
    description: opts.description ?? '',
    network: opts.network,
    rpcEndpointId: opts.rpcEndpointId,
    sessionIds: [],
    keypairRefs: [],
    createdAt: now,
    lastOpenedAt: now,
    pinned: false,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Ship Claude Code skill bundle alongside every new project so an agent
  // working in this folder gets Relay-specific orientation automatically.
  await copyBundledSkills(projectPath);
}

/**
 * Copy bundled SKILL.md files into `<projectRoot>/.claude/skills/`. Idempotent
 * (skips overwrite if a same-named skill dir already exists). Errors are
 * swallowed — missing skills shouldn't block project creation.
 */
async function copyBundledSkills(projectPath: string): Promise<void> {
  try {
    // Bundled skills live at <appRoot>/skills/. From __dirname (out/main) the
    // skills dir resolves at ../../skills relative to the built file. In the
    // packaged .app this maps to Contents/Resources/app/skills/.
    const src = join(__dirname, '..', '..', 'skills');
    if (!existsSync(src)) return;
    const dest = join(projectPath, '.claude', 'skills');
    await mkdir(dest, { recursive: true });
    await cpAsync(src, dest, { recursive: true, force: false, errorOnExist: false });
  } catch {
    /* non-fatal: project still usable without skills */
  }
}

export function isProjectFolder(p: string): boolean {
  return existsSync(join(p, RELAY_MANIFEST));
}

export async function focusOrOpenProjectWindow(projectPath: string): Promise<void> {
  if (!isProjectFolder(projectPath)) {
    throw new Error(`not a Relay project: ${projectPath}`);
  }
  const existingId = pathToWindow.get(projectPath);
  if (existingId !== undefined) {
    const existing = BrowserWindow.fromId(existingId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    pathToWindow.delete(projectPath);
  }
  const win = createProjectWindow({ projectRoot: projectPath });
  windowToPath.set(win.id, projectPath);
  pathToWindow.set(projectPath, win.id);
  await getAppStore().pushRecent(projectPath, basename(projectPath));

  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.close();
    welcomeWindow = null;
  }
}

export function getProjectInfoForWindow(
  windowId: number,
): { path: string; name: string } | null {
  const path = windowToPath.get(windowId);
  if (!path) return null;
  return { path, name: basename(path) };
}

export function getProjectPathForWindow(windowId: number): string | null {
  return windowToPath.get(windowId) ?? null;
}

export function closeWindowForProject(windowId: number): void {
  const win = BrowserWindow.fromId(windowId);
  if (win && !win.isDestroyed()) win.close();
}

export function showWelcomeWindow(): BrowserWindow {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.focus();
    return welcomeWindow;
  }
  welcomeWindow = createProjectWindow({ welcome: true });
  welcomeWindow.on('closed', () => {
    welcomeWindow = null;
  });
  return welcomeWindow;
}

interface CreateWinOptions {
  projectRoot?: string;
  welcome?: boolean;
}

function createProjectWindow(opts: CreateWinOptions): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const iconPath = join(
    __dirname,
    '../../build',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  const win = new BrowserWindow({
    width: opts.welcome ? 900 : 1400,
    height: opts.welcome ? 600 : 900,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    frame: isLinux ? false : undefined,
    backgroundColor: '#0c0e12',
    title: opts.welcome
      ? 'Relay'
      : `Relay — ${opts.projectRoot ? basename(opts.projectRoot) : ''}`,
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#0c0e12',
        symbolColor: '#e4e7ee',
        height: 40,
      },
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: opts.projectRoot
        ? [`--relay-project-root=${opts.projectRoot}`]
        : ['--relay-welcome'],
    },
  });

  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    const path = windowToPath.get(win.id);
    if (path) {
      windowToPath.delete(win.id);
      pathToWindow.delete(path);
    }
    void shutdownWorkerForWindow(win.id);
  });

  if (opts.projectRoot) {
    void spawnWorkerForWindow(win.id, { projectRoot: opts.projectRoot } satisfies SpawnOptions);
  }

  const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
  const url = isDev ? process.env.ELECTRON_RENDERER_URL! : null;
  const indexFile = join(__dirname, '../renderer/index.html');

  if (url) {
    const target = opts.welcome ? `${url}?welcome=1` : url;
    void win.loadURL(target);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(indexFile, {
      search: opts.welcome ? 'welcome=1' : undefined,
    });
  }

  return win;
}

export function getAllProjectWindows(): BrowserWindow[] {
  return Array.from(windowToPath.keys())
    .map((id) => BrowserWindow.fromId(id))
    .filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
}

export function appHasOpenWindows(): boolean {
  return getAllProjectWindows().length > 0 || (welcomeWindow !== null && !welcomeWindow.isDestroyed());
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function cryptoRandomId(): string {
  return randomUUID();
}
