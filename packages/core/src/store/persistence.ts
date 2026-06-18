import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErrorCode, RelayError } from '@relay/shared';
import type {
  AccountEntry,
  Patch,
  ProgramEntry,
  ProgramVersion,
  ScriptEntry,
  SessionState,
  TestSuite,
  TxTemplate,
  Workflow,
} from '@relay/shared';
import type { PersistenceSink, Project, StoreSnapshot } from './types.js';

export const STORE_FORMAT_VERSION = 2;
const MANIFEST_NAME = '.relay.json';

/**
 * Migration registry. Each entry transforms raw manifest data FROM the keyed
 * version UP one step. Loader walks the chain until it reaches the current
 * STORE_FORMAT_VERSION. Add entries here when bumping; never mutate an
 * existing entry once shipped.
 *
 * Note: while the app is in dev, no real migrations are wired — schema is
 * fluid. This stub exists so the contract is in place for the first
 * production version bump.
 */
const MANIFEST_MIGRATIONS: Record<number, (raw: any) => any> = {
  // v1 manifest had inline collections (programs/patches/scripts/txTemplates/workflows
  // and idlBindings) plus the meta fields. v2 manifest is thin: meta only — the
  // sub-collections moved to per-entity files in .relay/*/<id>.json.
  //
  // This migration drops the dead inline fields so the v2 loader sees a clean
  // thin manifest. The sub-collection folders may be empty (fresh-from-v1
  // projects had nothing saved there yet); the per-entity sinks treat missing
  // dirs as empty, so the project still opens.
  1: (raw) => {
    const {
      programs: _p,
      patches: _pa,
      keypairRefs: _kr,
      scripts: _s,
      txTemplates: _tt,
      workflows: _wf,
      testSuites: _ts,
      idlBindings: _ib,
      sessionIds,
      ...rest
    } = raw;
    return {
      ...rest,
      formatVersion: 2,
      sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
      keypairRefs: Array.isArray(raw.keypairRefs) ? raw.keypairRefs : [],
      pinned: raw.pinned ?? false,
    };
  },
};

function migrateManifest(raw: any): any {
  let current = raw.formatVersion ?? 1;
  while (current < STORE_FORMAT_VERSION) {
    const step = MANIFEST_MIGRATIONS[current];
    if (!step) {
      throw new RelayError(
        ErrorCode.INTERNAL,
        `no migration registered for manifest v${current} → v${current + 1}`,
      );
    }
    raw = step(raw);
    current = raw.formatVersion ?? current + 1;
  }
  return raw;
}

// ---------- Thin manifest (project meta only) ----------

interface ManifestV2 {
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  network: Project['network'];
  rpcEndpointId: string;
  sessionIds: string[];
  keypairRefs: string[];
  createdAt: number;
  lastOpenedAt: number;
  pinned: boolean;
}

/** `<projectRoot>/.relay.json` — thin project meta only. Sub-collections live in `.relay/*` folders. */
export class ProjectManifestSink {
  private readonly path: string;

  constructor(projectRoot: string) {
    this.path = join(projectRoot, MANIFEST_NAME);
  }

  async load(): Promise<ManifestV2 | null> {
    if (!existsSync(this.path)) return null;
    const raw = JSON.parse(await readFile(this.path, 'utf8'), reviver);
    const migrated = migrateManifest(raw) as ManifestV2;
    if (!Array.isArray(migrated.sessionIds)) migrated.sessionIds = [];
    if (!Array.isArray(migrated.keypairRefs)) migrated.keypairRefs = [];
    return migrated;
  }

  async save(meta: ManifestV2): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const wire: ManifestV2 = { ...meta, formatVersion: STORE_FORMAT_VERSION };
    await atomicWrite(this.path, JSON.stringify(wire, replacer, 2));
  }
}

// ---------- Generic per-entity folder sink ----------

/**
 * One JSON file per entity in `<dir>/<id>.json`. saveAll writes every entity
 * and prunes files for ids no longer present. Per-file direct write.
 */
class IdFolderSink<T extends { id: string }> {
  constructor(private readonly dir: string) {}

  async loadAll(): Promise<T[]> {
    if (!existsSync(this.dir)) return [];
    const out: T[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(join(this.dir, f), 'utf8'), reviver) as T);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  async saveAll(items: T[]): Promise<void> {
    if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
    const wanted = new Set(items.map((it) => `${it.id}.json`));
    for (const it of items) {
      const path = join(this.dir, `${it.id}.json`);
      await atomicWrite(path, JSON.stringify(it, replacer, 2));
    }
    try {
      for (const f of await readdir(this.dir)) {
        if (f.endsWith('.json') && !wanted.has(f)) {
          await unlink(join(this.dir, f)).catch(() => {});
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export class TxTemplateFolderSink extends IdFolderSink<TxTemplate> {}
export class WorkflowFolderSink extends IdFolderSink<Workflow> {}
export class TestSuiteFolderSink extends IdFolderSink<TestSuite> {}
export class ScriptFolderSink extends IdFolderSink<ScriptEntry> {}
export class PatchFolderSink extends IdFolderSink<Patch> {}

// ---------- Programs (with nested accounts/) ----------

/**
 * Program file shape on disk: ProgramEntry minus inline accounts.
 *
 * Schema evolution: legacy files (single elfBlobHash + source) are auto-upgraded
 * on read into the multi-version shape with a synthesized `v1` version. Save
 * always writes the multi-version canonical form.
 */
type ProgramFileLegacy = Omit<ProgramEntry, 'accounts' | 'versions' | 'activeVersionId'> &
  Partial<Pick<ProgramEntry, 'versions' | 'activeVersionId'>>;

/**
 * Mirror the active version's elf/source onto the top-level fields so older
 * runtime paths reading `elfBlobHash` see the same bytes the version system
 * resolves to.
 */
function mirrorActiveVersion(p: ProgramEntry): ProgramEntry {
  const active = p.versions.find((v) => v.id === p.activeVersionId);
  if (!active) return p;
  return {
    ...p,
    elfBlobHash: active.elfBlobHash,
    source: active.source,
    clonedAtSlot: active.source.kind === 'cloned' ? active.source.slot : null,
  };
}

/**
 * Read a possibly-legacy file and return a canonical multi-version
 * ProgramEntry. If the file already has `versions`, mirror the active one
 * onto the top-level fields. If it doesn't, synthesize a single `v1` from
 * the existing elfBlobHash + source.
 */
function upgradeProgramFile(
  raw: ProgramFileLegacy,
  accounts: AccountEntry[],
): ProgramEntry {
  if (Array.isArray(raw.versions) && raw.versions.length > 0) {
    const activeId =
      raw.activeVersionId && raw.versions.some((v) => v.id === raw.activeVersionId)
        ? raw.activeVersionId
        : raw.versions[0]!.id;
    return mirrorActiveVersion({
      ...(raw as unknown as ProgramEntry),
      versions: raw.versions,
      activeVersionId: activeId,
      accounts,
    });
  }
  // Legacy: build a synthetic v1 from the single elfBlobHash + source.
  const v1: ProgramVersion = {
    id: randomUUID(),
    label: 'v1',
    elfBlobHash: raw.elfBlobHash,
    source: raw.source,
    idlId: raw.idlId ?? null,
    createdAt: Date.now(),
  };
  return mirrorActiveVersion({
    ...(raw as unknown as ProgramEntry),
    versions: [v1],
    activeVersionId: v1.id,
    accounts,
  });
}

/**
 * `<dir>/<programId>.json` — program metadata.
 * `<dir>/<programId>/accounts/<address>.json` — one file per AccountEntry.
 * Address-named filenames so renames don't churn the diff.
 */
export class ProgramFolderSink {
  constructor(private readonly dir: string) {}

  async loadAll(): Promise<ProgramEntry[]> {
    if (!existsSync(this.dir)) return [];
    const out: ProgramEntry[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const programId = f.slice(0, -'.json'.length);
      try {
        const meta = JSON.parse(
          await readFile(join(this.dir, f), 'utf8'),
          reviver,
        ) as ProgramFileLegacy;
        const accounts = await this.loadAccounts(programId);
        out.push(upgradeProgramFile(meta, accounts));
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  async saveAll(programs: ProgramEntry[]): Promise<void> {
    if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
    const wantedMeta = new Set(programs.map((p) => `${p.programId}.json`));
    const wantedDirs = new Set(programs.map((p) => p.programId));
    for (const p of programs) {
      const { accounts, ...meta } = p;
      const path = join(this.dir, `${p.programId}.json`);
      await atomicWrite(path, JSON.stringify(meta, replacer, 2));
      await this.saveAccounts(p.programId, accounts);
    }
    // Purge stale program metas + their account subdirs.
    try {
      for (const entry of await readdir(this.dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json') && !wantedMeta.has(entry.name)) {
          await unlink(join(this.dir, entry.name)).catch(() => {});
        }
        if (entry.isDirectory() && !wantedDirs.has(entry.name)) {
          await rm(join(this.dir, entry.name), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {
      /* ignore */
    }
  }

  private accountsDir(programId: string): string {
    return join(this.dir, programId, 'accounts');
  }

  private async loadAccounts(programId: string): Promise<AccountEntry[]> {
    const dir = this.accountsDir(programId);
    if (!existsSync(dir)) return [];
    const out: AccountEntry[] = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(join(dir, f), 'utf8'), reviver) as AccountEntry);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  private async saveAccounts(programId: string, accounts: AccountEntry[]): Promise<void> {
    const dir = this.accountsDir(programId);
    if (accounts.length === 0) {
      // Clean empty subdir if it exists, but don't create one.
      if (existsSync(dir)) {
        try {
          for (const f of await readdir(dir)) {
            await unlink(join(dir, f)).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const wanted = new Set(accounts.map((a) => `${a.address}.json`));
    for (const a of accounts) {
      const path = join(dir, `${a.address}.json`);
      await atomicWrite(path, JSON.stringify(a, replacer, 2));
    }
    try {
      for (const f of await readdir(dir)) {
        if (f.endsWith('.json') && !wanted.has(f)) {
          await unlink(join(dir, f)).catch(() => {});
        }
      }
    } catch {
      /* ignore */
    }
  }
}

// ---------- Sessions (already split, kept here for cohesion) ----------

export class SessionFolderSink {
  constructor(private readonly dir: string) {}

  async loadAll(): Promise<SessionState[]> {
    if (!existsSync(this.dir)) return [];
    const entries = await readdir(this.dir);
    const out: SessionState[] = [];
    for (const e of entries) {
      if (!e.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.dir, e), 'utf8');
        out.push(JSON.parse(raw, reviver) as SessionState);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  async saveAll(sessions: SessionState[]): Promise<void> {
    if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
    const wanted = new Set(sessions.map((s) => `${s.id}.json`));
    for (const s of sessions) {
      const path = join(this.dir, `${s.id}.json`);
      await atomicWrite(path, JSON.stringify(s, replacer, 2));
    }
    try {
      for (const f of await readdir(this.dir)) {
        if (f.endsWith('.json') && !wanted.has(f)) {
          await unlink(join(this.dir, f)).catch(() => {});
        }
      }
    } catch {
      /* ignore */
    }
  }
}

// ---------- Legacy combined sink (tests / CLI bundle) ----------

export class JsonFileSink implements PersistenceSink {
  constructor(private readonly path: string) {}

  async load(): Promise<StoreSnapshot | null> {
    if (!existsSync(this.path)) return null;
    const raw = await readFile(this.path, 'utf8');
    const parsed = JSON.parse(raw, reviver) as StoreSnapshot;
    if (parsed.formatVersion !== STORE_FORMAT_VERSION) {
      throw new RelayError(
        ErrorCode.INTERNAL,
        `unsupported store formatVersion: ${parsed.formatVersion}`,
      );
    }
    return parsed;
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await atomicWrite(this.path, JSON.stringify(snapshot, replacer, 2));
  }
}

// ---------- Helpers ----------

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  if (value instanceof Uint8Array) return { __bytes: Buffer.from(value).toString('base64') };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { __bigint?: string; __bytes?: string };
    if (typeof v.__bigint === 'string') return BigInt(v.__bigint);
    if (typeof v.__bytes === 'string') return new Uint8Array(Buffer.from(v.__bytes, 'base64'));
  }
  return value;
}

export type { ManifestV2 };
