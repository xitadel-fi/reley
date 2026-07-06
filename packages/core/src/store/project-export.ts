import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { type Zippable, zipSync } from 'fflate';
import type { CoreContext } from './context.js';
import { resolveProjectPaths } from './paths.js';

/**
 * Full-project export — mirrors every file under the project root including
 * keypairs and sandbox sessions. Caller controls trust boundary (they pick
 * who receives the zip). Keypair secret bytes go through as-is; on macOS
 * with safeStorage seal active, they remain encrypted and only decryptable
 * on the originating user account.
 */
const STORE_EXCLUDE = new Set<string>();

export interface ExportResult {
  zip: Uint8Array;
  /** Suggested file name (no path), e.g. `my-project.reley.zip`. */
  suggestedFileName: string;
}

/**
 * Build a portable `.reley.zip` of the current project. Layout inside the zip
 * mirrors the on-disk project folder: `<project-name>/.reley.json`,
 * `<project-name>/.reley/blobs/...`, etc. Recipients unzip, then open the
 * top folder in Reley.
 */
export async function exportProjectZip(ctx: CoreContext): Promise<ExportResult> {
  const project = ctx.projects.exportAll()[0];
  if (!project) throw new Error('no project loaded in this context');

  const paths = resolveProjectPaths(ctx.projectRoot);
  const rootName = safeFolderName(project.name) || 'reley-project';
  const files: Zippable = {};

  // 1. Top-level manifest (.reley.json or .relay.json — keep whatever exists).
  if (existsSync(paths.manifest)) {
    const bytes = await readFile(paths.manifest);
    files[`${rootName}/${paths.manifestBase}`] = new Uint8Array(bytes);
  }

  // 2. Everything under the store directory.
  if (existsSync(paths.storeDir)) {
    await collectDir(paths.storeDir, paths.storeDir, files, rootName, paths.storeDirBase);
  }

  const zip = zipSync(files, { level: 6 });
  return {
    zip,
    suggestedFileName: `${rootName}.reley.zip`,
  };
}

async function collectDir(
  rootDir: string,
  currentDir: string,
  out: Zippable,
  zipRootName: string,
  storeDirBase: string,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(currentDir, e.name);
    const rel = relative(rootDir, full).split(sep).join('/');
    if (e.isDirectory()) {
      if (STORE_EXCLUDE.has(e.name) && currentDir === rootDir) continue;
      await collectDir(rootDir, full, out, zipRootName, storeDirBase);
    } else if (e.isFile()) {
      const bytes = await readFile(full);
      out[`${zipRootName}/${storeDirBase}/${rel}`] = new Uint8Array(bytes);
    }
  }
}

function safeFolderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
