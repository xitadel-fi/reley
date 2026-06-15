import type { AccountSnapshot } from './account.js';
import type { Patch } from './patch.js';
import type { Base58String, Uuid } from './primitives.js';
import type { TraceNode } from './trace.js';

export interface SnapshotRef {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
  createdAt: number;
  blobHash?: string;
  fingerprint?: string;
}

export interface TxRecord {
  id: Uuid;
  signature: Base58String | null;
  submittedAt: number;
  success: boolean;
  errorMessage: string | null;
  cuConsumed: bigint;
  trace: TraceNode;
  touchedAccounts: Base58String[];
}

export interface SessionState {
  id: Uuid;
  projectId: Uuid;
  name: string;
  currentSlot: bigint;
  accounts: Record<Base58String, AccountSnapshot>;
  sessionPatches: Patch[];
  txHistory: TxRecord[];
  snapshots: SnapshotRef[];
  isDefault: boolean;
  /**
   * Per-program override of the project-level active version. Keyed by
   * programId. When set, this session's runtime loads the pinned version's
   * ELF instead of the project's `activeVersionId`. Undefined / missing key
   * = follow project default.
   */
  programVersionOverrides?: Record<Base58String, Uuid>;
}

export interface SessionMeta {
  id: Uuid;
  projectId: Uuid;
  name: string;
  isDefault: boolean;
  accountCount: number;
  mutationCount: number;
  createdAt: number;
  lastUsedAt: number;
}
