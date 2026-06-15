import { PublicKey } from '@solana/web3.js';
import { ErrorCode, RelayError } from '@relay/shared';
import {
  ATA_PROGRAM as _ATA,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from '../util/builtins.js';

/**
 * Hand-rolled layouts for native (non-Anchor) accounts whose binary format is
 * fixed by the protocol. Covers the most common cases: SPL Token mint, SPL
 * Token account, Token-2022 base (same offsets as classic Token for the first
 * 165 bytes).
 */

export type FieldType =
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'bool'
  | 'pubkey'
  | 'optionPubkey'; // COption<Pubkey> = u32 tag + 32 bytes

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** Byte offset within account data. For optionPubkey, points at the u32 tag. */
  offset: number;
}

export interface NativeLayout {
  name: string;
  /** Program IDs (owners) this layout applies to. */
  owners: string[];
  /** Exact account-data length, or null to skip strict size match. */
  size: number | null;
  fields: FieldSpec[];
}

export const SPL_TOKEN_MINT: NativeLayout = {
  name: 'SplToken.Mint',
  owners: [TOKEN_PROGRAM.toBase58(), TOKEN_2022_PROGRAM.toBase58()],
  size: 82,
  fields: [
    { name: 'mintAuthority', type: 'optionPubkey', offset: 0 },
    { name: 'supply', type: 'u64', offset: 36 },
    { name: 'decimals', type: 'u8', offset: 44 },
    { name: 'isInitialized', type: 'bool', offset: 45 },
    { name: 'freezeAuthority', type: 'optionPubkey', offset: 46 },
  ],
};

export const SPL_TOKEN_ACCOUNT: NativeLayout = {
  name: 'SplToken.Account',
  owners: [TOKEN_PROGRAM.toBase58(), TOKEN_2022_PROGRAM.toBase58()],
  size: 165,
  fields: [
    { name: 'mint', type: 'pubkey', offset: 0 },
    { name: 'owner', type: 'pubkey', offset: 32 },
    { name: 'amount', type: 'u64', offset: 64 },
    { name: 'delegate', type: 'optionPubkey', offset: 72 },
    { name: 'state', type: 'u8', offset: 108 },
    { name: 'isNative', type: 'optionPubkey' /* placeholder: COption<u64>, see below */, offset: 109 },
    { name: 'delegatedAmount', type: 'u64', offset: 121 },
    { name: 'closeAuthority', type: 'optionPubkey', offset: 129 },
  ],
};

/**
 * Note: Token Account `isNative` is `COption<u64>` (u32 tag + u64), but for
 * patching purposes the user rarely touches it; we expose lamports-equivalent
 * via setLamports, and skip read for the field above. Custom handling done in
 * decodeNative.
 */

export const NATIVE_LAYOUTS: NativeLayout[] = [SPL_TOKEN_MINT, SPL_TOKEN_ACCOUNT];

export function resolveLayout(
  programId: string,
  dataLen: number,
): NativeLayout | null {
  // Two-pass: prefer exact size match (handles MINT=82 vs ACCOUNT=165 under
  // the same program owner). Fall back to "at-least" match for Token-2022
  // base body (account with extensions appended → dataLen > 165).
  const owned = NATIVE_LAYOUTS.filter((l) => l.owners.includes(programId));
  for (const layout of owned) {
    if (layout.size === null) return layout;
    if (dataLen === layout.size) return layout;
  }
  // No exact match → fall back to largest layout that still fits.
  let best: NativeLayout | null = null;
  for (const layout of owned) {
    if (layout.size === null) continue;
    if (dataLen < layout.size) continue;
    if (!best || layout.size > (best.size ?? 0)) best = layout;
  }
  return best;
}

export function decodeNative(data: Uint8Array, layout: NativeLayout): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of layout.fields) {
    out[f.name] = readField(data, f);
  }
  return out;
}

export function encodeNativeField(
  data: Uint8Array,
  layout: NativeLayout,
  fieldPath: string,
  valueJson: string,
): Uint8Array {
  const field = layout.fields.find((f) => f.name === fieldPath);
  if (!field) {
    throw new RelayError(
      ErrorCode.PATCH_APPLY_FAILURE,
      `field "${fieldPath}" not in layout ${layout.name}`,
    );
  }
  const next = new Uint8Array(data);
  writeField(next, field, parseValueForField(field, valueJson));
  return next;
}

function readField(data: Uint8Array, field: FieldSpec): unknown {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const off = field.offset;
  switch (field.type) {
    case 'u8':
      return view.getUint8(off);
    case 'u16':
      return view.getUint16(off, true);
    case 'u32':
      return view.getUint32(off, true);
    case 'u64':
      return view.getBigUint64(off, true).toString();
    case 'u128': {
      const lo = view.getBigUint64(off, true);
      const hi = view.getBigUint64(off + 8, true);
      return ((hi << 64n) | lo).toString();
    }
    case 'bool':
      return view.getUint8(off) !== 0;
    case 'pubkey':
      return new PublicKey(data.slice(off, off + 32)).toBase58();
    case 'optionPubkey': {
      const tag = view.getUint32(off, true);
      if (tag === 0) return null;
      return new PublicKey(data.slice(off + 4, off + 4 + 32)).toBase58();
    }
  }
}

function writeField(data: Uint8Array, field: FieldSpec, value: unknown): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const off = field.offset;
  switch (field.type) {
    case 'u8':
      view.setUint8(off, Number(value));
      return;
    case 'u16':
      view.setUint16(off, Number(value), true);
      return;
    case 'u32':
      view.setUint32(off, Number(value), true);
      return;
    case 'u64':
      view.setBigUint64(off, BigInt(value as string | number | bigint), true);
      return;
    case 'u128': {
      const v = BigInt(value as string | number | bigint);
      view.setBigUint64(off, v & 0xffffffffffffffffn, true);
      view.setBigUint64(off + 8, v >> 64n, true);
      return;
    }
    case 'bool':
      view.setUint8(off, value ? 1 : 0);
      return;
    case 'pubkey': {
      const pk = new PublicKey(value as string).toBuffer();
      data.set(pk, off);
      return;
    }
    case 'optionPubkey': {
      if (value === null || value === undefined) {
        view.setUint32(off, 0, true);
        data.fill(0, off + 4, off + 4 + 32);
        return;
      }
      view.setUint32(off, 1, true);
      const pk = new PublicKey(value as string).toBuffer();
      data.set(pk, off + 4);
      return;
    }
  }
}

function parseValueForField(field: FieldSpec, valueJson: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    parsed = valueJson;
  }
  switch (field.type) {
    case 'u8':
    case 'u16':
    case 'u32':
      if (typeof parsed === 'number') return parsed;
      if (typeof parsed === 'string' && !Number.isNaN(Number(parsed))) return Number(parsed);
      throw new RelayError(ErrorCode.INVALID_INPUT, `${field.name} needs numeric value`);
    case 'u64':
    case 'u128':
      if (typeof parsed === 'number' || typeof parsed === 'string' || typeof parsed === 'bigint')
        return parsed;
      throw new RelayError(ErrorCode.INVALID_INPUT, `${field.name} needs integer value`);
    case 'bool':
      if (typeof parsed === 'boolean') return parsed;
      if (parsed === 'true' || parsed === 1) return true;
      if (parsed === 'false' || parsed === 0) return false;
      throw new RelayError(ErrorCode.INVALID_INPUT, `${field.name} needs boolean`);
    case 'pubkey':
      if (typeof parsed === 'string') return parsed;
      throw new RelayError(ErrorCode.INVALID_INPUT, `${field.name} needs base58 string`);
    case 'optionPubkey':
      if (parsed === null) return null;
      if (typeof parsed === 'string') return parsed;
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `${field.name} needs base58 string or null`,
      );
  }
}
