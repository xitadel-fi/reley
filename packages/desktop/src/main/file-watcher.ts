import { type FSWatcher, existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';

interface Entry {
  windowId: number;
  watchers: FSWatcher[];
  /** Debounce timer for collapsing rapid sequential changes. */
  pending: NodeJS.Timeout | null;
  /** Set of paths changed in the current debounce window. */
  changedPaths: Set<string>;
}

const entries = new Map<number, Entry>();
const DEBOUNCE_MS = 150;
const IGNORE = ['.DS_Store', 'worker-fatal.log', 'mcp-error.log', 'ipc-trace.log'];

function shouldIgnore(name: string | null): boolean {
  if (!name) return false;
  if (IGNORE.includes(name)) return true;
  if (name.endsWith('.tmp')) return true; // atomic-write artifacts
  return false;
}

/**
 * Watch `<projectRoot>/.relay.json` and `<projectRoot>/.relay/` for changes
 * caused outside the running app (text editor, git, another Reley window).
 * Coalesces bursts and notifies the renderer via `relay:files-changed`.
 *
 * The renderer is expected to call `project.reload` on the worker so the
 * in-memory CoreContext re-reads from disk, then refresh its UI state.
 */
export function startWatcher(windowId: number, projectRoot: string): void {
  if (entries.has(windowId)) return;
  const watchers: FSWatcher[] = [];

  const flush = (entry: Entry): void => {
    if (entry.pending) {
      clearTimeout(entry.pending);
      entry.pending = null;
    }
    const changed = Array.from(entry.changedPaths);
    entry.changedPaths.clear();
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return;
    win.webContents.send('relay:files-changed', { paths: changed });
  };

  const onEvent = (entry: Entry, relPath: string): void => {
    if (shouldIgnore(relPath.split('/').pop() ?? null)) return;
    entry.changedPaths.add(relPath);
    if (entry.pending) clearTimeout(entry.pending);
    entry.pending = setTimeout(() => flush(entry), DEBOUNCE_MS);
  };

  const entry: Entry = { windowId, watchers, pending: null, changedPaths: new Set() };

  // Manifest + store dir: watch both layouts (new `.reley.*` and legacy
  // `.relay.*`) so projects on either schema get hot reload.
  for (const manifestName of ['.reley.json', '.relay.json']) {
    const manifestPath = join(projectRoot, manifestName);
    try {
      const w = watch(manifestPath, { persistent: false }, () =>
        onEvent(entry, manifestName),
      );
      watchers.push(w);
    } catch {
      /* missing — skip */
    }
  }

  for (const dirName of ['.reley', '.relay']) {
    const dir = join(projectRoot, dirName);
    if (!existsSync(dir)) continue;
    try {
      const w = watch(
        dir,
        { persistent: false, recursive: process.platform !== 'linux' },
        (_evt, name) => {
          const rel = name ? `${dirName}/${String(name)}` : dirName;
          onEvent(entry, rel);
        },
      );
      watchers.push(w);
    } catch {
      /* ignore */
    }
  }

  entries.set(windowId, entry);
}

export function stopWatcher(windowId: number): void {
  const entry = entries.get(windowId);
  if (!entry) return;
  if (entry.pending) clearTimeout(entry.pending);
  for (const w of entry.watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  entries.delete(windowId);
}

export function stopAllWatchers(): void {
  for (const id of Array.from(entries.keys())) stopWatcher(id);
}
