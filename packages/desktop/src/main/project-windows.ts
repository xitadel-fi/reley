import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { unzipSync } from 'fflate';
import { getAppStore } from './app-store';

import {
  shutdownWorkerForWindow,
  spawnWorkerForWindow,
  type SpawnOptions,
} from './workerMgr';

const MANIFEST_NEW = '.reley.json';
const MANIFEST_LEGACY = '.relay.json';
const STORE_DIR_NEW = '.reley';
const STORE_DIR_LEGACY = '.relay';
// Keep in sync with STORE_FORMAT_VERSION in @reley/core/store/persistence.ts.
const PROJECT_FORMAT_VERSION = 2;

function manifestPathFor(projectPath: string): string {
  const next = join(projectPath, MANIFEST_NEW);
  if (existsSync(next)) return next;
  const legacy = join(projectPath, MANIFEST_LEGACY);
  if (existsSync(legacy)) return legacy;
  return next;
}

function storeDirFor(projectPath: string): string {
  const next = join(projectPath, STORE_DIR_NEW);
  if (existsSync(next)) return next;
  const legacy = join(projectPath, STORE_DIR_LEGACY);
  if (existsSync(legacy)) return legacy;
  return next;
}

export function isProjectFolder(p: string): boolean {
  return (
    existsSync(join(p, MANIFEST_NEW)) ||
    existsSync(join(p, MANIFEST_LEGACY)) ||
    existsSync(join(p, STORE_DIR_NEW)) ||
    existsSync(join(p, STORE_DIR_LEGACY))
  );
}

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
  if (isProjectFolder(projectPath)) return; // Already a project; just open it.
  const manifestPath = join(projectPath, MANIFEST_NEW);
  const relayDir = join(projectPath, STORE_DIR_NEW);
  await mkdir(join(relayDir, 'sessions'), { recursive: true });
  await mkdir(join(relayDir, 'blobs'), { recursive: true });
  await mkdir(join(relayDir, 'keypairs'), { recursive: true });
  await mkdir(join(relayDir, 'idls'), { recursive: true });
  // Per-entity dirs for v2 thin manifest layout.
  await mkdir(join(relayDir, 'programs'), { recursive: true });
  await mkdir(join(relayDir, 'tx-templates'), { recursive: true });
  await mkdir(join(relayDir, 'workflows'), { recursive: true });
  await mkdir(join(relayDir, 'test-suites'), { recursive: true });
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
  // working in this folder gets Reley-specific orientation automatically.
  await copyBundledSkills(projectPath);
}

/**
 * Extract a `.reley.zip` produced by `project.export` into `destParentDir`.
 * Zip layout: single top-level folder containing the project manifest and
 * `.reley/` store dir. Returns the absolute path to the extracted project
 * root. Auto-syncs bundled Claude skills if the extracted project doesn't
 * already ship them.
 *
 * Conflict handling: if the chosen project name collides with an existing
 * folder under destParentDir, append `-1`, `-2`, … until unique.
 */
export async function importProjectFromZip(
  zipPath: string,
  destParentDir: string,
): Promise<{ projectPath: string; fileCount: number }> {
  const raw = await readFile(zipPath);
  const entries = unzipSync(new Uint8Array(raw));

  // Detect single top-level folder. fflate keys are POSIX paths.
  const topDirs = new Set<string>();
  for (const key of Object.keys(entries)) {
    const slash = key.indexOf('/');
    if (slash === -1) continue;
    topDirs.add(key.slice(0, slash));
  }
  if (topDirs.size !== 1) {
    throw new Error(
      `expected exactly one top-level folder in zip, got ${topDirs.size} (${[...topDirs].slice(0, 3).join(', ')})`,
    );
  }
  const topName = [...topDirs][0]!;

  await mkdir(destParentDir, { recursive: true });
  let projectPath = join(destParentDir, topName);
  let suffix = 1;
  while (existsSync(projectPath)) {
    projectPath = join(destParentDir, `${topName}-${suffix}`);
    suffix += 1;
  }
  await mkdir(projectPath, { recursive: true });

  // Write every file under <projectPath>, stripping the top-level dir prefix.
  let fileCount = 0;
  for (const [key, bytes] of Object.entries(entries)) {
    // Directory entry — fflate represents these as keys ending in '/' with
    // empty payload. mkdir on file write covers nesting; skip.
    if (key.endsWith('/')) continue;
    const rel = key.slice(topName.length + 1); // drop "<topName>/"
    if (!rel) continue;
    const out = join(projectPath, rel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    fileCount += 1;
  }

  if (!isProjectFolder(projectPath)) {
    throw new Error(
      `extracted folder is missing project manifest (.reley.json / .relay.json): ${projectPath}`,
    );
  }

  // Sync bundled Claude skills if the imported zip didn't ship them or shipped
  // an older copy. copyBundledSkills uses `force: true` so it always wins on
  // the relay-* bundle names — user-authored skills under other names stay.
  await copyBundledSkills(projectPath);

  return { projectPath, fileCount };
}

/**
 * Sync bundled SKILL.md files into `<projectRoot>/.claude/skills/`. Force-
 * overwrites the bundled relay-* skill dirs so app updates ship fresh docs to
 * existing projects. User-added skills under different names are untouched
 * (cp only writes paths that exist in the source tree). Errors swallowed.
 */
async function copyBundledSkills(projectPath: string): Promise<void> {
  try {
    const src = join(__dirname, '..', '..', 'skills');
    if (!existsSync(src)) return;
    const dest = join(projectPath, '.claude', 'skills');
    await mkdir(dest, { recursive: true });
    await cp(src, dest, { recursive: true, force: true, errorOnExist: false });
  } catch {
    /* non-fatal: project still usable without skills */
  }
}

/**
 * If `p` itself is a Reley project, return it. Else if `p` contains exactly
 * one subfolder that IS a project, descend into it (common case: user picks
 * the parent that holds an unzipped project folder). Else return null.
 */
function resolveProjectRoot(p: string): string | null {
  if (isProjectFolder(p)) return p;
  if (!existsSync(p)) return null;
  try {
    const subdirs = readdirSync(p)
      .filter((name) => !name.startsWith('.') && statSync(join(p, name)).isDirectory())
      .map((name) => join(p, name));
    const projects = subdirs.filter(isProjectFolder);
    if (projects.length === 1) return projects[0]!;
  } catch {
    /* ignore */
  }
  return null;
}

export async function focusOrOpenProjectWindow(projectPath: string): Promise<void> {
  const resolved = resolveProjectRoot(projectPath);
  if (!resolved) {
    throw new Error(`not a Reley project: ${projectPath}`);
  }
  projectPath = resolved;
  const existingId = pathToWindow.get(projectPath);
  if (existingId !== undefined) {
    const existing = BrowserWindow.fromId(existingId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    pathToWindow.delete(projectPath);
  }
  // Re-sync bundled relay-* skills on every open so app upgrades reach
  // existing projects. Fire-and-forget; window doesn't wait on it.
  void copyBundledSkills(projectPath);
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
      ? 'Reley'
      : `Reley — ${opts.projectRoot ? basename(opts.projectRoot) : ''}`,
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
    void (async () => {
      try {
        const { stopWatcher } = await import('./file-watcher');
        stopWatcher(win.id);
      } catch {
        /* ignore */
      }
    })();
    void shutdownWorkerForWindow(win.id);
  });

  if (opts.projectRoot) {
    void spawnWorkerForWindow(win.id, { projectRoot: opts.projectRoot } satisfies SpawnOptions);
    void (async () => {
      try {
        const { startWatcher } = await import('./file-watcher');
        startWatcher(win.id, opts.projectRoot!);
      } catch {
        /* ignore */
      }
    })();
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
