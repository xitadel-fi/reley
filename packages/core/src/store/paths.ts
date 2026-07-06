import { existsSync } from 'node:fs';
import { join } from 'node:path';

// New-brand names. Used for fresh projects and accepted for loads.
export const MANIFEST_NEW = '.reley.json';
export const STORE_DIR_NEW = '.reley';

// Legacy names. Loaded if present (backward compat); never created fresh.
export const MANIFEST_LEGACY = '.relay.json';
export const STORE_DIR_LEGACY = '.relay';

export interface ResolvedPaths {
  /** Absolute path to the manifest file used by this project. */
  manifest: string;
  /** Absolute path to the per-project store directory (blobs/idls/etc). */
  storeDir: string;
  /** Manifest filename actually picked (`.reley.json` or `.relay.json`). */
  manifestBase: string;
  /** Store-dir basename actually picked (`.reley` or `.relay`). */
  storeDirBase: string;
  /** True when the project is on the legacy layout. */
  legacy: boolean;
}

/**
 * Pick which on-disk layout to use for `projectRoot`.
 *
 * Precedence:
 *  1. `.reley.json` or `.reley/` already exists -> new layout (preferred).
 *  2. `.relay.json` or `.relay/` exists -> legacy layout. Code keeps writing
 *     to the legacy paths to avoid splitting state across two folders.
 *  3. Fresh root -> new layout.
 */
export function resolveProjectPaths(projectRoot: string): ResolvedPaths {
  const newManifest = join(projectRoot, MANIFEST_NEW);
  const newDir = join(projectRoot, STORE_DIR_NEW);
  const legacyManifest = join(projectRoot, MANIFEST_LEGACY);
  const legacyDir = join(projectRoot, STORE_DIR_LEGACY);

  const newPresent = existsSync(newManifest) || existsSync(newDir);
  const legacyPresent = existsSync(legacyManifest) || existsSync(legacyDir);

  if (newPresent || !legacyPresent) {
    return {
      manifest: newManifest,
      storeDir: newDir,
      manifestBase: MANIFEST_NEW,
      storeDirBase: STORE_DIR_NEW,
      legacy: false,
    };
  }
  return {
    manifest: legacyManifest,
    storeDir: legacyDir,
    manifestBase: MANIFEST_LEGACY,
    storeDirBase: STORE_DIR_LEGACY,
    legacy: true,
  };
}

/** True if `projectRoot` contains either layout's marker file/folder. */
export function isProjectRoot(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, MANIFEST_NEW)) ||
    existsSync(join(projectRoot, STORE_DIR_NEW)) ||
    existsSync(join(projectRoot, MANIFEST_LEGACY)) ||
    existsSync(join(projectRoot, STORE_DIR_LEGACY))
  );
}
