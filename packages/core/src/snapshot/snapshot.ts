import { randomUUID } from 'node:crypto';
import { ErrorCode, RelayError, type SessionState, type SnapshotRef } from '@reley/shared';
import { sha256Hex } from '../util/hash.js';

export const SNAPSHOT_FORMAT_VERSION = 2;

interface SnapshotPayload {
  formatVersion: number;
  sessionId: string;
  capturedAt: number;
  accounts: SessionState['accounts'];
  sessionPatches: SessionState['sessionPatches'];
  currentSlot: bigint;
  /**
   * Active program version per program at capture time. Lets restore optionally
   * also rewind the session's overrides so observed state matches the original
   * ELF bytes. New in v2.
   */
  programVersions?: Record<string, string>;
  /** Session-level overrides at capture time. */
  programVersionOverrides?: Record<string, string>;
}

/**
 * Canonical serialize a session-snapshot blob. Deterministic across machines
 * (per D-3): keys sorted, bigint → string, Uint8Array → base64.
 */
export function serializeSnapshot(payload: SnapshotPayload): Uint8Array {
  const canonical = JSON.stringify(payload, canonicalReplacer, 2);
  return new Uint8Array(Buffer.from(canonical, 'utf8'));
}

export function deserializeSnapshot(bytes: Uint8Array): SnapshotPayload {
  const text = Buffer.from(bytes).toString('utf8');
  const parsed = JSON.parse(text, canonicalReviver) as SnapshotPayload;
  if (parsed.formatVersion === 1) {
    // v1 snapshots: no version info captured. Treat as if no overrides were set.
    return { ...parsed, formatVersion: SNAPSHOT_FORMAT_VERSION };
  }
  if (parsed.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new RelayError(
      ErrorCode.INTERNAL,
      `unsupported snapshot formatVersion: ${parsed.formatVersion}`,
    );
  }
  return parsed;
}

export function snapshotFingerprint(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export function captureFromSession(
  session: SessionState,
  projectActiveVersions?: Record<string, string>,
): SnapshotPayload {
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    sessionId: session.id,
    // capturedAt comes from the host-supplied clock, kept out of canonical hash via
    // separate field for human reference but counted in the blob.
    capturedAt: 0,
    accounts: session.accounts,
    sessionPatches: session.sessionPatches,
    currentSlot: session.currentSlot,
    ...(projectActiveVersions && { programVersions: projectActiveVersions }),
    ...(session.programVersionOverrides && {
      programVersionOverrides: session.programVersionOverrides,
    }),
  };
}

export interface ApplySnapshotOptions {
  /** When true, restore programVersionOverrides too (defaults false). */
  restoreVersions?: boolean;
}

export function applySnapshot(
  session: SessionState,
  payload: SnapshotPayload,
  opts: ApplySnapshotOptions = {},
): void {
  session.accounts = payload.accounts;
  session.sessionPatches = payload.sessionPatches;
  session.currentSlot = payload.currentSlot;
  if (opts.restoreVersions) {
    if (payload.programVersionOverrides) {
      session.programVersionOverrides = { ...payload.programVersionOverrides };
    } else {
      delete session.programVersionOverrides;
    }
  }
  // tx history is left intact — snapshots represent state, not history (P6 design choice)
}

export function newSnapshotRef(name: string, parentId: string | null = null): SnapshotRef {
  return {
    id: randomUUID(),
    name,
    parentId,
    createdAt: Date.now(),
  };
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  let current: unknown = value;
  if (
    current &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    !(current instanceof Uint8Array)
  ) {
    const obj = current as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) out[k] = obj[k];
    current = out;
  }
  if (typeof current === 'bigint') return { __bigint: current.toString() };
  if (current instanceof Uint8Array) return { __bytes: Buffer.from(current).toString('base64') };
  return current;
}

function canonicalReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { __bigint?: string; __bytes?: string };
    if (typeof v.__bigint === 'string') return BigInt(v.__bigint);
    if (typeof v.__bytes === 'string') return new Uint8Array(Buffer.from(v.__bytes, 'base64'));
  }
  return value;
}
