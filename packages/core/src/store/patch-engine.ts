import type { Idl } from '@coral-xyz/anchor';
import { ErrorCode, type Patch, RelayError } from '@reley/shared';
import type { AccountSnapshot } from '@reley/shared';
import { AnchorCoder, setFieldByPath } from '../patcher/anchor-coder.js';
import { encodeNativeField, resolveLayout } from '../patcher/native-layouts.js';

export interface PatchContext {
  /** Resolve the IDL for a given owner program (account's owner field). */
  resolveIdl?(programId: string): Idl | null;
}

export function applyPatch(
  snapshot: AccountSnapshot,
  patch: Patch,
  ctx: PatchContext = {},
): AccountSnapshot {
  if (!patch.enabled) return snapshot;
  if (patch.target !== snapshot.pubkey) return snapshot;
  const next: AccountSnapshot = {
    ...snapshot,
    data: new Uint8Array(snapshot.data),
    source: 'patched',
  };
  switch (patch.op.kind) {
    case 'setLamports':
      next.lamports = patch.op.lamports;
      return next;
    case 'setOwner':
      next.owner = patch.op.owner;
      return next;
    case 'rawSplice': {
      const { offset, bytes } = patch.op;
      if (offset + bytes.length > next.data.length) {
        throw new RelayError(
          ErrorCode.PATCH_APPLY_FAILURE,
          `rawSplice out of range: offset=${offset} len=${bytes.length} data=${next.data.length}`,
        );
      }
      next.data.set(bytes, offset);
      return next;
    }
    case 'setField': {
      if (!ctx.resolveIdl) {
        throw new RelayError(
          ErrorCode.PATCH_APPLY_FAILURE,
          'setField patch requires PatchContext.resolveIdl',
        );
      }
      const idl = ctx.resolveIdl(snapshot.owner);
      if (!idl) {
        throw new RelayError(
          ErrorCode.IDL_DECODE_FAILURE,
          `no IDL attached for owner ${snapshot.owner}`,
        );
      }
      const coder = new AnchorCoder(idl);
      const decoded = coder.decodeAny(Buffer.from(next.data));
      if (!decoded) {
        throw new RelayError(
          ErrorCode.IDL_DECODE_FAILURE,
          'IDL did not match any account discriminator',
        );
      }
      setFieldByPath(decoded.value, patch.op.fieldPath, patch.op.valueJson);
      // Note: encode is async; cast through synchronously is not possible.
      // For now we throw, expecting async helper applyPatchAsync to be used.
      throw new RelayError(
        ErrorCode.PATCH_APPLY_FAILURE,
        'setField requires applyPatchAsync (Anchor encode is async)',
      );
    }
  }
}

export async function applyPatchAsync(
  snapshot: AccountSnapshot,
  patch: Patch,
  ctx: PatchContext = {},
): Promise<AccountSnapshot> {
  if (patch.op.kind !== 'setField') return applyPatch(snapshot, patch, ctx);
  if (!patch.enabled) return snapshot;
  if (patch.target !== snapshot.pubkey) return snapshot;

  // 1. Try Anchor IDL first.
  const idl = ctx.resolveIdl?.(snapshot.owner) ?? null;
  if (idl) {
    const coder = new AnchorCoder(idl);
    const decoded = coder.decodeAny(Buffer.from(snapshot.data));
    if (decoded) {
      setFieldByPath(decoded.value, patch.op.fieldPath, patch.op.valueJson);
      const reEncoded = await coder.encodeAsync(decoded.name, decoded.value);
      return {
        ...snapshot,
        data: new Uint8Array(reEncoded),
        source: 'patched',
      };
    }
  }

  // 2. Fall back to native layouts (SPL Token / Token-2022 base).
  const layout = resolveLayout(snapshot.owner, snapshot.data.length);
  if (layout) {
    const newData = encodeNativeField(
      new Uint8Array(snapshot.data),
      layout,
      patch.op.fieldPath,
      patch.op.valueJson,
    );
    return {
      ...snapshot,
      data: newData,
      source: 'patched',
    };
  }

  throw new RelayError(
    ErrorCode.IDL_DECODE_FAILURE,
    `no IDL and no native layout for owner ${snapshot.owner}; attach an IDL or use rawSplice`,
  );
}

export function applyPatches(
  snapshot: AccountSnapshot,
  projectPatches: Patch[],
  sessionPatches: Patch[],
  ctx: PatchContext = {},
): AccountSnapshot {
  let current = snapshot;
  for (const p of projectPatches) current = applyPatch(current, p, ctx);
  for (const p of sessionPatches) current = applyPatch(current, p, ctx);
  return current;
}

export async function applyPatchesAsync(
  snapshot: AccountSnapshot,
  projectPatches: Patch[],
  sessionPatches: Patch[],
  ctx: PatchContext = {},
): Promise<AccountSnapshot> {
  let current = snapshot;
  for (const p of projectPatches) current = await applyPatchAsync(current, p, ctx);
  for (const p of sessionPatches) current = await applyPatchAsync(current, p, ctx);
  return current;
}
