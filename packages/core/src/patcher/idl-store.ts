import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Idl } from '@coral-xyz/anchor';

export interface IdlEntry {
  programId: string;
  /** Optional — when set, this IDL applies only to a specific program version. */
  versionId?: string | null;
  idlName: string;
  source: 'manual' | 'onChain' | 'bundled';
  updatedAt: number;
}

/**
 * On-disk layout:
 *   <rootDir>/<programId>.json                  — program-default IDL
 *   <rootDir>/<programId>__<versionId>.json     — version-specific IDL
 *
 * `get(programId, versionId?)` tries the version-specific file first, then
 * falls back to the program default. Callers that don't have a version in
 * mind (e.g. decoding by programId alone) just pass programId — they get
 * whatever default is attached.
 */
export class IdlStore {
  private cache = new Map<string, Idl>();

  constructor(private readonly rootDir: string) {}

  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.rootDir)) await mkdir(this.rootDir, { recursive: true });
  }

  private fileFor(programId: string, versionId?: string | null): string {
    return versionId ? `${programId}__${versionId}.json` : `${programId}.json`;
  }

  private cacheKey(programId: string, versionId?: string | null): string {
    return versionId ? `${programId}__${versionId}` : programId;
  }

  private pathFor(programId: string, versionId?: string | null): string {
    return join(this.rootDir, this.fileFor(programId, versionId));
  }

  async attach(
    programId: string,
    idl: Idl,
    source: 'manual' | 'onChain' | 'bundled' = 'manual',
    versionId?: string | null,
  ): Promise<IdlEntry> {
    await this.ensureRoot();
    this.cache.set(this.cacheKey(programId, versionId), idl);
    const wrapped = {
      __source: source,
      __updatedAt: Date.now(),
      ...(versionId && { __versionId: versionId }),
      idl,
    };
    await writeFile(this.pathFor(programId, versionId), JSON.stringify(wrapped, null, 2));
    return {
      programId,
      versionId: versionId ?? null,
      idlName: idl.metadata?.name ?? programId,
      source,
      updatedAt: wrapped.__updatedAt,
    };
  }

  async detach(programId: string, versionId?: string | null): Promise<void> {
    this.cache.delete(this.cacheKey(programId, versionId));
    const p = this.pathFor(programId, versionId);
    if (existsSync(p)) await unlink(p);
  }

  async get(programId: string, versionId?: string | null): Promise<Idl | null> {
    // Try version-specific first, fall back to program-default.
    if (versionId) {
      const versioned = await this.readOne(programId, versionId);
      if (versioned) return versioned;
    }
    return this.readOne(programId, null);
  }

  private async readOne(programId: string, versionId: string | null): Promise<Idl | null> {
    const key = this.cacheKey(programId, versionId);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const path = this.pathFor(programId, versionId);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    const idl = unwrapIdlFile(raw);
    if (!idl) return null;
    this.cache.set(key, idl);
    return idl;
  }

  async list(): Promise<IdlEntry[]> {
    if (!existsSync(this.rootDir)) return [];
    const files = await readdir(this.rootDir);
    const out: IdlEntry[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const base = f.replace(/\.json$/, '');
      const sep = base.indexOf('__');
      const programId = sep >= 0 ? base.slice(0, sep) : base;
      const versionId = sep >= 0 ? base.slice(sep + 2) : null;
      const raw = await readFile(join(this.rootDir, f), 'utf8');
      const parsed = safeParseJson(raw);
      const idl = unwrapIdl(parsed);
      if (!idl) continue; // skip malformed file; never crash the list
      const meta = parsed && typeof parsed === 'object' ? parsed : {};
      out.push({
        programId,
        versionId,
        idlName: idl.metadata?.name ?? programId,
        source: ((meta as { __source?: string }).__source as IdlEntry['source']) ?? 'manual',
        updatedAt: (meta as { __updatedAt?: number }).__updatedAt ?? 0,
      });
    }
    return out;
  }
}

/**
 * Tolerant JSON parser — returns null instead of throwing on malformed files.
 * IDL files come from third parties (paste, file upload, on-chain decode),
 * so guard the read paths instead of crashing the whole panel.
 */
function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Accept both the wrapped format `{ __source, __updatedAt, idl: {...} }`
 * (current) and a bare IDL object (older files / direct file imports).
 * Returns null if neither shape applies.
 */
function unwrapIdl(parsed: unknown): Idl | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.idl && typeof obj.idl === 'object') return obj.idl as Idl;
  // Bare IDL — has at minimum one of these top-level keys.
  if ('instructions' in obj || 'accounts' in obj || 'metadata' in obj || 'address' in obj) {
    return parsed as Idl;
  }
  return null;
}

/** Convenience wrapper used by readOne. */
function unwrapIdlFile(raw: string): Idl | null {
  return unwrapIdl(safeParseJson(raw));
}
