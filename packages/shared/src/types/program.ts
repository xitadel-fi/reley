import type { AccountEntry } from './account.js';
import type { Base58String, Uuid } from './primitives.js';

export type ProgramSource = { kind: 'cloned'; slot: bigint } | { kind: 'localFile'; path: string };

/**
 * One ELF version of a program. Multiple versions per program enable testing
 * upgrade paths (v1 → v2 forward) and rollbacks (v2 → v1 backward) against
 * the same accounts + templates.
 */
export interface ProgramVersion {
  id: Uuid;
  /** User-facing label: "v1.2.0", "before-audit", "anchor-29", … */
  label: string;
  elfBlobHash: string;
  source: ProgramSource;
  /** Optional per-version IDL (Anchor versions can diverge in account / ix shape). */
  idlId?: Uuid | null;
  notes?: string;
  createdAt: number;
}

export interface ProgramEntry {
  programId: Base58String;
  label: string;
  idlId: Uuid | null;
  accounts: AccountEntry[];
  upgradeAuthority: Base58String | null;

  /** All known ELF versions. Always has length >= 1. */
  versions: ProgramVersion[];
  /** Currently active version id. Worker uses this version's ELF + IDL. */
  activeVersionId: Uuid;

  /**
   * Mirror of `versions.find(v => v.id === activeVersionId).elfBlobHash` for
   * back-compat with code that reads the field directly. Persisted so a
   * stale read still sees the same hash the worker uses.
   */
  elfBlobHash: string;
  source: ProgramSource;
  clonedAtSlot: bigint | null;
}
