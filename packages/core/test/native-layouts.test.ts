import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  SPL_TOKEN_ACCOUNT,
  SPL_TOKEN_MINT,
  decodeNative,
  encodeNativeField,
  resolveLayout,
} from '../src/patcher/native-layouts.js';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/util/builtins.js';

function emptyMintBuf(): Uint8Array {
  return new Uint8Array(82);
}

function emptyAcctBuf(): Uint8Array {
  return new Uint8Array(165);
}

describe('resolveLayout', () => {
  it('resolves SPL Token mint by owner + size', () => {
    const layout = resolveLayout(TOKEN_PROGRAM.toBase58(), 82);
    expect(layout?.name).toBe('SplToken.Mint');
  });

  it('resolves Token-2022 token account with extensions (data > 165)', () => {
    const layout = resolveLayout(TOKEN_2022_PROGRAM.toBase58(), 200);
    // No exact size match; fall back to largest-fits. Both MINT (82) and
    // ACCOUNT (165) fit; ACCOUNT wins because 165 > 82.
    expect(layout?.name).toBe('SplToken.Account');
  });

  it('resolves SPL Token account at exact 165', () => {
    const layout = resolveLayout(TOKEN_PROGRAM.toBase58(), 165);
    expect(layout?.name).toBe('SplToken.Account');
  });

  it('returns null for unknown owner', () => {
    const layout = resolveLayout('11111111111111111111111111111111', 100);
    expect(layout).toBeNull();
  });
});

describe('encode/decode mint fields', () => {
  it('round-trips supply (u64)', () => {
    let buf = emptyMintBuf();
    buf = encodeNativeField(buf, SPL_TOKEN_MINT, 'supply', '"123456789"');
    const decoded = decodeNative(buf, SPL_TOKEN_MINT);
    expect(decoded.supply).toBe('123456789');
  });

  it('round-trips decimals (u8)', () => {
    let buf = emptyMintBuf();
    buf = encodeNativeField(buf, SPL_TOKEN_MINT, 'decimals', '6');
    const decoded = decodeNative(buf, SPL_TOKEN_MINT);
    expect(decoded.decimals).toBe(6);
  });

  it('round-trips optionPubkey (mintAuthority set)', () => {
    let buf = emptyMintBuf();
    const pk = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr').toBase58();
    buf = encodeNativeField(buf, SPL_TOKEN_MINT, 'mintAuthority', `"${pk}"`);
    const decoded = decodeNative(buf, SPL_TOKEN_MINT);
    expect(decoded.mintAuthority).toBe(pk);
  });

  it('round-trips optionPubkey to null', () => {
    let buf = emptyMintBuf();
    const pk = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
    buf = encodeNativeField(buf, SPL_TOKEN_MINT, 'mintAuthority', `"${pk}"`);
    buf = encodeNativeField(buf, SPL_TOKEN_MINT, 'mintAuthority', 'null');
    expect(decodeNative(buf, SPL_TOKEN_MINT).mintAuthority).toBeNull();
  });

  it('rejects unknown field', () => {
    const buf = emptyMintBuf();
    expect(() => encodeNativeField(buf, SPL_TOKEN_MINT, 'nope', '1')).toThrow(/not in layout/);
  });
});

describe('encode/decode token account fields', () => {
  it('round-trips owner (pubkey)', () => {
    let buf = emptyAcctBuf();
    const pk = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
    buf = encodeNativeField(buf, SPL_TOKEN_ACCOUNT, 'owner', `"${pk}"`);
    expect(decodeNative(buf, SPL_TOKEN_ACCOUNT).owner).toBe(pk);
  });

  it('round-trips amount (u64)', () => {
    let buf = emptyAcctBuf();
    buf = encodeNativeField(buf, SPL_TOKEN_ACCOUNT, 'amount', '"9999999999"');
    expect(decodeNative(buf, SPL_TOKEN_ACCOUNT).amount).toBe('9999999999');
  });
});
