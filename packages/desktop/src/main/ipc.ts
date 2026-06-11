import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { type RpcEndpoint, getAppStore } from './app-store';
import { getProjectPathForWindow } from './project-windows';
import {
  closeWindowForProject,
  createProjectFolder,
  focusOrOpenProjectWindow,
  getProjectInfoForWindow as getProjectInfoForWindowImpl,
  showWelcomeWindow,
} from './project-windows';
import { getClientForWindow } from './workerMgr';

const RPC_CHANNEL = 'relay:rpc';

export function registerIpc(): void {
  ipcMain.handle(RPC_CHANNEL, async (evt, method: string, params: unknown) => {
    try {
      if (method.startsWith('app.')) {
        const result = await handleAppMethod(evt.sender, method, params);
        return { ok: true, result };
      }
      const senderWin = BrowserWindow.fromWebContents(evt.sender);
      const client = senderWin ? getClientForWindow(senderWin.id) : null;
      if (!client) {
        return {
          ok: false,
          error: { code: 'NO_PROJECT', message: 'no project open in this window' },
        };
      }
      const result = await client.call(method, params);
      return { ok: true, result };
    } catch (err) {
      const e = err as Error & { code?: string };
      return { ok: false, error: { code: e.code ?? 'INTERNAL', message: e.message } };
    }
  });
}

async function handleAppMethod(
  sender: Electron.WebContents,
  method: string,
  params: unknown,
): Promise<unknown> {
  const store = getAppStore();
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'app.recentProjects':
      return store.recentProjects();

    case 'app.removeRecent':
      await store.removeRecent(String(p.path));
      return { ok: true };

    case 'app.recentProjectMeta': {
      try {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const raw = await readFile(join(String(p.path), '.relay.json'), 'utf8');
        const parsed = JSON.parse(raw) as { network?: string; pinned?: boolean };
        return { network: parsed.network ?? null, pinned: !!parsed.pinned };
      } catch {
        return null;
      }
    }

    case 'app.openProjectPicker': {
      const win = BrowserWindow.fromWebContents(sender);
      const r = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
        title: 'Open Relay Project',
      });
      const path = r.filePaths[0];
      if (r.canceled || !path) return { canceled: true };
      await focusOrOpenProjectWindow(path);
      return { path };
    }

    case 'app.newProjectPicker': {
      const win = BrowserWindow.fromWebContents(sender);
      const r = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose folder for new Relay project',
      });
      const path = r.filePaths[0];
      if (r.canceled || !path) return { canceled: true };
      const name = String(p.name ?? '').trim() || pathBasename(path);
      const rpcEndpointId = String(p.rpcEndpointId ?? 'mainnet-public');
      const network = String(p.network ?? 'mainnet-beta');
      await createProjectFolder(path, {
        name,
        network: network as RpcEndpoint['network'],
        rpcEndpointId,
      });
      await focusOrOpenProjectWindow(path);
      return { path };
    }

    case 'app.openProjectByPath': {
      const path = String(p.path);
      await focusOrOpenProjectWindow(path);
      return { path };
    }

    case 'app.showWelcome': {
      showWelcomeWindow();
      return { ok: true };
    }

    case 'app.closeProjectWindow': {
      const win = BrowserWindow.fromWebContents(sender);
      if (win) closeWindowForProject(win.id);
      return { ok: true };
    }

    case 'app.rpcEndpoints':
      return store.rpcEndpoints();

    case 'app.upsertRpcEndpoint':
      await store.upsertRpc(p as unknown as RpcEndpoint);
      return { ok: true };

    case 'app.deleteRpcEndpoint':
      await store.deleteRpc(String(p.id));
      return { ok: true };

    case 'app.preferences':
      return store.preferences();

    case 'app.setPreferences':
      await store.setPreferences(p as Record<string, unknown>);
      return store.preferences();

    case 'app.projectInfo': {
      const win = BrowserWindow.fromWebContents(sender);
      if (!win) return null;
      return getProjectInfoForWindowImpl(win.id);
    }

    case 'app.files.tree':
      return handleFilesTree(sender);

    case 'app.files.read':
      return handleFilesRead(sender, String(p.path));

    case 'app.files.write':
      return handleFilesWrite(sender, String(p.path), String(p.content));

    default:
      throw new Error(`unknown app method: ${method}`);
  }
}

interface FileNode {
  name: string;
  /** Relative to project root (POSIX-style separators). */
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime?: number;
  children?: FileNode[];
}

/**
 * Map a window to its project root. Throws if window isn't a project window
 * (e.g. welcome window with no project).
 */
function getRootForSender(sender: Electron.WebContents): string {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) throw new Error('no window');
  const root = getProjectPathForWindow(win.id);
  if (!root) throw new Error('window has no project');
  return root;
}

/** Resolve a project-relative path safely; throws on escape via `..`. */
function resolveInRoot(root: string, rel: string): string {
  const cleaned = normalize(rel.replace(/^[\\/]+/, ''));
  const abs = resolve(root, cleaned);
  const within = relative(root, abs);
  if (within.startsWith('..') || within.startsWith(`..${sep}`) || within === '..') {
    throw new Error(`path escapes project root: ${rel}`);
  }
  return abs;
}

async function walkDir(abs: string, root: string): Promise<FileNode[]> {
  const out: FileNode[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (e.name.startsWith('.DS_Store')) continue;
    const full = join(abs, e.name);
    const rel = relative(root, full).split(sep).join('/');
    if (e.isDirectory()) {
      out.push({
        name: e.name,
        path: rel,
        kind: 'dir',
        children: await walkDir(full, root),
      });
    } else if (e.isFile()) {
      let size: number | undefined;
      let mtime: number | undefined;
      try {
        const s = await stat(full);
        size = s.size;
        mtime = s.mtimeMs;
      } catch {
        /* ignore */
      }
      out.push({ name: e.name, path: rel, kind: 'file', size, mtime });
    }
  }
  return out;
}

async function handleFilesTree(sender: Electron.WebContents): Promise<{ root: string; nodes: FileNode[] }> {
  const root = getRootForSender(sender);
  // Show .relay.json + .relay/ subtree only — those are the editable bits.
  const nodes: FileNode[] = [];
  const manifestAbs = join(root, '.relay.json');
  try {
    const s = await stat(manifestAbs);
    nodes.push({
      name: '.relay.json',
      path: '.relay.json',
      kind: 'file',
      size: s.size,
      mtime: s.mtimeMs,
    });
  } catch {
    /* missing */
  }
  const relayDirAbs = join(root, '.relay');
  try {
    await stat(relayDirAbs);
    nodes.push({
      name: '.relay',
      path: '.relay',
      kind: 'dir',
      children: await walkDir(relayDirAbs, root),
    });
  } catch {
    /* missing */
  }
  return { root, nodes };
}

async function handleFilesRead(
  sender: Electron.WebContents,
  rel: string,
): Promise<{ path: string; content: string; mtime: number }> {
  const root = getRootForSender(sender);
  const abs = resolveInRoot(root, rel);
  const [content, s] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
  return { path: rel, content, mtime: s.mtimeMs };
}

async function handleFilesWrite(
  sender: Electron.WebContents,
  rel: string,
  content: string,
): Promise<{ path: string; mtime: number }> {
  const root = getRootForSender(sender);
  const abs = resolveInRoot(root, rel);
  // For .json files: validate before write so the user can't break the
  // worker by saving syntactically invalid manifest / entity files.
  if (abs.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error(`invalid JSON: ${(e as Error).message}`);
    }
  }
  await writeFile(abs, content);
  const s = await stat(abs);
  return { path: rel, mtime: s.mtimeMs };
}

function pathBasename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
}
