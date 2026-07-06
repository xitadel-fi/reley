import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { ErrorCode, RelayError } from '@reley/shared';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Look up an account-struct entry in the IDL by either its struct name or
 * its 8-byte discriminator (matched against the first 8 bytes of `data`).
 */
export interface AccountMatch {
  name: string;
  size: number | undefined;
}

export class AnchorCoder {
  private readonly coder: BorshAccountsCoder;

  constructor(public readonly idl: Idl) {
    this.coder = new BorshAccountsCoder(idl);
  }

  /** Decode an account by its struct name. */
  decode<T = Record<string, unknown>>(accountName: string, data: Buffer): T {
    return this.coder.decode(accountName, data) as T;
  }

  /**
   * Decode by matching the first 8 bytes of `data` against IDL account
   * discriminators. Returns null if no match.
   */
  decodeAny(data: Buffer): { name: string; value: Record<string, unknown> } | null {
    if (!this.idl.accounts) return null;
    for (const acc of this.idl.accounts) {
      try {
        const value = this.coder.decode(acc.name, data) as Record<string, unknown>;
        return { name: acc.name, value };
      } catch {
        // discriminator mismatch — try next
      }
    }
    return null;
  }

  /** Re-encode a struct back to bytes (full account body including 8-byte discriminator). */
  async encodeAsync(accountName: string, value: unknown): Promise<Buffer> {
    // why: Anchor 0.30 BorshAccountsCoder.encode allocates a fixed 1000-byte buffer
    // (with a "TODO: use a tighter buffer" comment), which overflows for any account
    // larger than ~1 KB (e.g. Kamino's 8 KB Reserve). Re-encode against a 64 KB scratch
    // buffer using the coder's internal layout map.
    const layouts = (this.coder as unknown as { accountLayouts: Map<string, { encode(v: unknown, b: Buffer): number }> }).accountLayouts;
    const layout = layouts.get(accountName);
    if (!layout) throw new RelayError(ErrorCode.IDL_DECODE_FAILURE, `unknown account: ${accountName}`);
    const scratch = Buffer.alloc(65536);
    const len = layout.encode(value, scratch);
    const body = scratch.slice(0, len);
    const acc = this.idl.accounts?.find((a) => a.name === accountName);
    const disc = Buffer.from(acc?.discriminator ?? []);
    return Buffer.concat([disc, body]);
  }
}

/**
 * Apply an in-place edit to a decoded struct's field at a dotted path.
 * Coerces strings into the right type when the existing field is a BN, PublicKey,
 * boolean, or numeric.
 */
export function setFieldByPath(
  target: Record<string, unknown>,
  path: string,
  valueJson: string,
): void {
  if (!path.length) {
    throw new RelayError(ErrorCode.INVALID_INPUT, 'empty field path');
  }
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!key) throw new RelayError(ErrorCode.INVALID_INPUT, `empty path segment in "${path}"`);
    const next = cursor[key];
    if (!next || typeof next !== 'object') {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `field path "${path}" leads through non-object at "${key}"`,
      );
    }
    cursor = next as Record<string, unknown>;
  }
  const finalKey = parts[parts.length - 1];
  if (!finalKey) throw new RelayError(ErrorCode.INVALID_INPUT, `empty final segment in "${path}"`);

  const existing = cursor[finalKey];
  cursor[finalKey] = coerce(existing, valueJson);
}

function coerce(existing: unknown, valueJson: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    parsed = valueJson;
  }

  if (existing instanceof BN) {
    if (typeof parsed === 'number' || typeof parsed === 'string') return new BN(parsed);
    throw new RelayError(ErrorCode.INVALID_INPUT, 'BN field requires number or string value');
  }
  if (existing instanceof PublicKey) {
    if (typeof parsed === 'string') return new PublicKey(parsed);
    throw new RelayError(ErrorCode.INVALID_INPUT, 'PublicKey field requires base58 string');
  }
  if (typeof existing === 'boolean') {
    if (typeof parsed === 'boolean') return parsed;
    if (parsed === 'true' || parsed === 1) return true;
    if (parsed === 'false' || parsed === 0) return false;
    throw new RelayError(ErrorCode.INVALID_INPUT, 'boolean field requires true/false');
  }
  if (typeof existing === 'number') {
    if (typeof parsed === 'number') return parsed;
    if (typeof parsed === 'string' && !Number.isNaN(Number(parsed))) return Number(parsed);
    throw new RelayError(ErrorCode.INVALID_INPUT, 'number field requires numeric value');
  }
  return parsed;
}

/**
 * Convert a decoded Anchor struct (which may contain BN / PublicKey instances) into
 * JSON-friendly primitives.
 */
export function serializeDecoded(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof BN) return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
  if (value instanceof Uint8Array) return { __bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(serializeDecoded);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeDecoded(v);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}
