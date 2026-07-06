import type { AccountSnapshot, Patch } from '@reley/shared';
import { describe, expect, it } from 'vitest';
import { applyPatch, applyPatches } from '../src/store/patch-engine.js';

function snap(data: number[] = [1, 2, 3, 4, 5]): AccountSnapshot {
  return {
    pubkey: 'POOL11111111111111111111111111111111111111',
    lamports: 1000n,
    owner: 'OWN11111111111111111111111111111111111111',
    executable: false,
    rentEpoch: 0n,
    data: new Uint8Array(data),
    clonedAtSlot: 100n,
    source: 'cloned',
  };
}

function patch(op: Patch['op'], enabled = true): Patch {
  return {
    id: 'p1',
    target: 'POOL11111111111111111111111111111111111111',
    op,
    createdAt: 0,
    enabled,
  };
}

describe('applyPatch', () => {
  it('setLamports overrides lamports field', () => {
    const out = applyPatch(snap(), patch({ kind: 'setLamports', lamports: 99n }));
    expect(out.lamports).toBe(99n);
    expect(out.source).toBe('patched');
  });

  it('setOwner overrides owner', () => {
    const out = applyPatch(snap(), patch({ kind: 'setOwner', owner: 'NEW' }));
    expect(out.owner).toBe('NEW');
  });

  it('rawSplice writes bytes at offset', () => {
    const out = applyPatch(
      snap(),
      patch({ kind: 'rawSplice', offset: 2, bytes: new Uint8Array([99, 99]) }),
    );
    expect(Array.from(out.data)).toEqual([1, 2, 99, 99, 5]);
  });

  it('disabled patch is a no-op', () => {
    const out = applyPatch(snap(), patch({ kind: 'setLamports', lamports: 99n }, false));
    expect(out.lamports).toBe(1000n);
    expect(out.source).toBe('cloned');
  });

  it('mismatched target is a no-op', () => {
    const p = patch({ kind: 'setLamports', lamports: 99n });
    p.target = 'OTHER11111111111111111111111111111111111111';
    const out = applyPatch(snap(), p);
    expect(out.lamports).toBe(1000n);
  });

  it('rawSplice out of range throws', () => {
    expect(() =>
      applyPatch(snap(), patch({ kind: 'rawSplice', offset: 4, bytes: new Uint8Array([1, 2, 3]) })),
    ).toThrow(/out of range/);
  });
});

describe('applyPatches order', () => {
  it('project then session', () => {
    const proj = [patch({ kind: 'setLamports', lamports: 500n })];
    const sess = [patch({ kind: 'setLamports', lamports: 999n })];
    expect(applyPatches(snap(), proj, sess).lamports).toBe(999n);
  });
});
