import type { SessionState } from '@relay/shared';
import { describe, expect, it } from 'vitest';
import {
  applySnapshot,
  captureFromSession,
  deserializeSnapshot,
  newSnapshotRef,
  serializeSnapshot,
  snapshotFingerprint,
} from '../src/snapshot/snapshot.js';

function freshSession(): SessionState {
  return {
    id: 's1',
    projectId: 'p1',
    name: 'main',
    currentSlot: 100n,
    accounts: {
      ABC: {
        pubkey: 'ABC',
        lamports: 500n,
        owner: 'OWN',
        executable: false,
        rentEpoch: 0n,
        data: new Uint8Array([1, 2, 3]),
        clonedAtSlot: 99n,
        source: 'cloned',
      },
    },
    sessionPatches: [],
    txHistory: [],
    snapshots: [],
    isDefault: false,
  };
}

describe('snapshot serialize/deserialize', () => {
  it('roundtrips a session state', () => {
    const session = freshSession();
    const payload = captureFromSession(session);
    const bytes = serializeSnapshot(payload);
    const restored = deserializeSnapshot(bytes);
    expect(restored.formatVersion).toBe(2);
    expect(restored.currentSlot).toBe(100n);
    const acc = restored.accounts.ABC;
    expect(acc?.lamports).toBe(500n);
    expect(Array.from(acc?.data ?? [])).toEqual([1, 2, 3]);
  });

  it('produces deterministic bytes for equivalent inputs', () => {
    const a = serializeSnapshot(captureFromSession(freshSession()));
    const b = serializeSnapshot(captureFromSession(freshSession()));
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });
});

describe('applySnapshot', () => {
  it('replaces session state but keeps tx history', () => {
    const session = freshSession();
    session.txHistory.push({
      id: 'tx1',
      signature: null,
      submittedAt: 0,
      success: true,
      errorMessage: null,
      cuConsumed: 0n,
      trace: {
        programId: 'X',
        depth: 1,
        instructionIndex: 0,
        cuConsumed: 0n,
        cuRemaining: 0n,
        logs: [],
        events: [],
        returnData: null,
        children: [],
        error: null,
      },
      touchedAccounts: [],
    });
    // Round-trip through serialize/deserialize to detach references
    const snap = deserializeSnapshot(serializeSnapshot(captureFromSession(session)));

    session.accounts.ABC = {
      ...session.accounts.ABC!,
      lamports: 9999n,
    };

    applySnapshot(session, snap);
    expect(session.accounts.ABC?.lamports).toBe(500n);
    expect(session.txHistory).toHaveLength(1);
  });
});

describe('newSnapshotRef', () => {
  it('assigns unique ids', () => {
    const a = newSnapshotRef('a');
    const b = newSnapshotRef('b');
    expect(a.id).not.toBe(b.id);
  });
});
