import { PublicKey } from '@solana/web3.js';
import { ErrorCode, RelayError } from '@reley/shared';
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  MEMO_PROGRAM_V1,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from '../util/builtins.js';

/**
 * Native (non-Anchor) instruction registry — mirror of what each program's
 * processor expects on the wire. Used to power "instruction name" picker for
 * built-in programs that don't ship Anchor IDLs.
 */

export type ArgType =
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'i64'
  | 'pubkey'
  | 'bool'
  | 'utf8'
  | 'optionPubkey'; // u32 tag + 32 bytes

export interface NativeIxAccount {
  name: string;
  isSigner: boolean;
  isWritable: boolean;
  optional?: boolean;
  docs?: string;
}

export interface NativeIxArg {
  name: string;
  type: ArgType;
}

export type NativeTag =
  | { kind: 'u8'; value: number }
  | { kind: 'u32'; value: number }
  | { kind: 'none' }
  | { kind: 'utf8' }; // memo: data IS the utf8 message, no tag prefix

export interface NativeIx {
  programId: string;
  name: string;
  docs?: string;
  tag: NativeTag;
  args: NativeIxArg[];
  accounts: NativeIxAccount[];
}

/* --------------------------------- System --------------------------------- */

const SYS = SYSTEM_PROGRAM.toBase58();
const SYS_INSTRUCTIONS: NativeIx[] = [
  {
    programId: SYS,
    name: 'CreateAccount',
    tag: { kind: 'u32', value: 0 },
    args: [
      { name: 'lamports', type: 'u64' },
      { name: 'space', type: 'u64' },
      { name: 'owner', type: 'pubkey' },
    ],
    accounts: [
      { name: 'from', isSigner: true, isWritable: true },
      { name: 'newAccount', isSigner: true, isWritable: true },
    ],
  },
  {
    programId: SYS,
    name: 'Assign',
    tag: { kind: 'u32', value: 1 },
    args: [{ name: 'owner', type: 'pubkey' }],
    accounts: [{ name: 'account', isSigner: true, isWritable: true }],
  },
  {
    programId: SYS,
    name: 'Transfer',
    tag: { kind: 'u32', value: 2 },
    args: [{ name: 'lamports', type: 'u64' }],
    accounts: [
      { name: 'from', isSigner: true, isWritable: true },
      { name: 'to', isSigner: false, isWritable: true },
    ],
  },
  {
    programId: SYS,
    name: 'Allocate',
    tag: { kind: 'u32', value: 8 },
    args: [{ name: 'space', type: 'u64' }],
    accounts: [{ name: 'account', isSigner: true, isWritable: true }],
  },
];

/* ---------------------------- SPL Token + 2022 ---------------------------- */

const TOKEN = TOKEN_PROGRAM.toBase58();
const TOKEN_22 = TOKEN_2022_PROGRAM.toBase58();
const tokenIxs: NativeIx[] = [];

const TOKEN_OWNERS = [TOKEN, TOKEN_22];

const tokenInstructionTemplates: Array<Omit<NativeIx, 'programId'>> = [
  {
    name: 'InitializeMint',
    tag: { kind: 'u8', value: 0 },
    args: [
      { name: 'decimals', type: 'u8' },
      { name: 'mintAuthority', type: 'pubkey' },
      { name: 'freezeAuthority', type: 'optionPubkey' },
    ],
    accounts: [
      { name: 'mint', isSigner: false, isWritable: true },
      { name: 'rent', isSigner: false, isWritable: false },
    ],
  },
  {
    name: 'InitializeAccount',
    tag: { kind: 'u8', value: 1 },
    args: [],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'mint', isSigner: false, isWritable: false },
      { name: 'owner', isSigner: false, isWritable: false },
      { name: 'rent', isSigner: false, isWritable: false },
    ],
  },
  {
    name: 'Transfer',
    tag: { kind: 'u8', value: 3 },
    args: [{ name: 'amount', type: 'u64' }],
    accounts: [
      { name: 'source', isSigner: false, isWritable: true },
      { name: 'destination', isSigner: false, isWritable: true },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'Approve',
    tag: { kind: 'u8', value: 4 },
    args: [{ name: 'amount', type: 'u64' }],
    accounts: [
      { name: 'source', isSigner: false, isWritable: true },
      { name: 'delegate', isSigner: false, isWritable: false },
      { name: 'owner', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'Revoke',
    tag: { kind: 'u8', value: 5 },
    args: [],
    accounts: [
      { name: 'source', isSigner: false, isWritable: true },
      { name: 'owner', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'SetAuthority',
    tag: { kind: 'u8', value: 6 },
    args: [
      { name: 'authorityType', type: 'u8' },
      { name: 'newAuthority', type: 'optionPubkey' },
    ],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'currentAuthority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'MintTo',
    tag: { kind: 'u8', value: 7 },
    args: [{ name: 'amount', type: 'u64' }],
    accounts: [
      { name: 'mint', isSigner: false, isWritable: true },
      { name: 'destination', isSigner: false, isWritable: true },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'Burn',
    tag: { kind: 'u8', value: 8 },
    args: [{ name: 'amount', type: 'u64' }],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'mint', isSigner: false, isWritable: true },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'CloseAccount',
    tag: { kind: 'u8', value: 9 },
    args: [],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'destination', isSigner: false, isWritable: true },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'FreezeAccount',
    tag: { kind: 'u8', value: 10 },
    args: [],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'mint', isSigner: false, isWritable: false },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
  {
    name: 'ThawAccount',
    tag: { kind: 'u8', value: 11 },
    args: [],
    accounts: [
      { name: 'account', isSigner: false, isWritable: true },
      { name: 'mint', isSigner: false, isWritable: false },
      { name: 'authority', isSigner: true, isWritable: false },
    ],
  },
];

for (const tpl of tokenInstructionTemplates) {
  for (const owner of TOKEN_OWNERS) {
    tokenIxs.push({ ...tpl, programId: owner });
  }
}

/* ------------------------------ Memo + ATA + CB ----------------------------*/

const MEMO_INSTRUCTIONS: NativeIx[] = [
  {
    programId: MEMO_PROGRAM.toBase58(),
    name: 'Memo',
    tag: { kind: 'utf8' },
    docs: 'Writes the supplied UTF-8 string as memo data',
    args: [{ name: 'message', type: 'utf8' }],
    accounts: [],
  },
  {
    programId: MEMO_PROGRAM_V1.toBase58(),
    name: 'Memo',
    tag: { kind: 'utf8' },
    args: [{ name: 'message', type: 'utf8' }],
    accounts: [],
  },
];

const CB_INSTRUCTIONS: NativeIx[] = [
  {
    programId: COMPUTE_BUDGET_PROGRAM.toBase58(),
    name: 'RequestHeapFrame',
    tag: { kind: 'u8', value: 1 },
    args: [{ name: 'bytes', type: 'u32' }],
    accounts: [],
  },
  {
    programId: COMPUTE_BUDGET_PROGRAM.toBase58(),
    name: 'SetComputeUnitLimit',
    tag: { kind: 'u8', value: 2 },
    args: [{ name: 'units', type: 'u32' }],
    accounts: [],
  },
  {
    programId: COMPUTE_BUDGET_PROGRAM.toBase58(),
    name: 'SetComputeUnitPrice',
    tag: { kind: 'u8', value: 3 },
    args: [{ name: 'microLamports', type: 'u64' }],
    accounts: [],
  },
];

const ATA = ATA_PROGRAM.toBase58();
const ATA_INSTRUCTIONS: NativeIx[] = [
  {
    programId: ATA,
    name: 'Create',
    tag: { kind: 'none' },
    args: [],
    accounts: [
      { name: 'payer', isSigner: true, isWritable: true },
      { name: 'associatedAccount', isSigner: false, isWritable: true },
      { name: 'owner', isSigner: false, isWritable: false },
      { name: 'mint', isSigner: false, isWritable: false },
      { name: 'systemProgram', isSigner: false, isWritable: false },
      { name: 'tokenProgram', isSigner: false, isWritable: false },
    ],
  },
  {
    programId: ATA,
    name: 'CreateIdempotent',
    tag: { kind: 'u8', value: 1 },
    args: [],
    accounts: [
      { name: 'payer', isSigner: true, isWritable: true },
      { name: 'associatedAccount', isSigner: false, isWritable: true },
      { name: 'owner', isSigner: false, isWritable: false },
      { name: 'mint', isSigner: false, isWritable: false },
      { name: 'systemProgram', isSigner: false, isWritable: false },
      { name: 'tokenProgram', isSigner: false, isWritable: false },
    ],
  },
];

export const NATIVE_INSTRUCTIONS: NativeIx[] = [
  ...SYS_INSTRUCTIONS,
  ...tokenIxs,
  ...MEMO_INSTRUCTIONS,
  ...CB_INSTRUCTIONS,
  ...ATA_INSTRUCTIONS,
];

export function listNativeInstructions(programId: string): NativeIx[] {
  return NATIVE_INSTRUCTIONS.filter((i) => i.programId === programId);
}

export function findNativeInstruction(programId: string, name: string): NativeIx | null {
  return NATIVE_INSTRUCTIONS.find((i) => i.programId === programId && i.name === name) ?? null;
}

/* --------------------------------- Encoder -------------------------------- */

export function encodeNativeIx(
  programId: string,
  name: string,
  args: Record<string, unknown>,
): Uint8Array {
  const def = findNativeInstruction(programId, name);
  if (!def) {
    throw new RelayError(
      ErrorCode.INVALID_INPUT,
      `unknown native instruction "${name}" for ${programId}`,
    );
  }
  // Memo: data IS the message
  if (def.tag.kind === 'utf8') {
    const msg = args.message;
    if (typeof msg !== 'string') {
      throw new RelayError(ErrorCode.INVALID_INPUT, 'Memo requires `message` (string)');
    }
    return new TextEncoder().encode(msg);
  }

  const parts: Uint8Array[] = [];
  if (def.tag.kind === 'u8') {
    parts.push(new Uint8Array([def.tag.value & 0xff]));
  } else if (def.tag.kind === 'u32') {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, def.tag.value, true);
    parts.push(buf);
  }
  for (const a of def.args) {
    parts.push(encodeArg(a, args[a.name]));
  }
  return concat(parts);
}

function encodeArg(arg: NativeIxArg, value: unknown): Uint8Array {
  switch (arg.type) {
    case 'u8': {
      const buf = new Uint8Array(1);
      buf[0] = Number(value) & 0xff;
      return buf;
    }
    case 'u16': {
      const buf = new Uint8Array(2);
      new DataView(buf.buffer).setUint16(0, Number(value), true);
      return buf;
    }
    case 'u32': {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, Number(value), true);
      return buf;
    }
    case 'u64': {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setBigUint64(0, BigInt(value as string | number | bigint), true);
      return buf;
    }
    case 'i64': {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setBigInt64(0, BigInt(value as string | number | bigint), true);
      return buf;
    }
    case 'pubkey':
      return new PublicKey(value as string).toBytes();
    case 'bool': {
      const buf = new Uint8Array(1);
      buf[0] = value ? 1 : 0;
      return buf;
    }
    case 'utf8':
      return new TextEncoder().encode(value as string);
    case 'optionPubkey': {
      const buf = new Uint8Array(36);
      if (value === null || value === undefined || value === '') {
        // tag = 0
        return new Uint8Array([0, 0, 0, 0]); // 4-byte tag, NO trailing 32 bytes when None
      }
      new DataView(buf.buffer).setUint32(0, 1, true);
      const pk = new PublicKey(value as string).toBytes();
      buf.set(pk, 4);
      return buf;
    }
  }
}

/**
 * Try to decode raw instruction bytes against the native registry for a given
 * program. Returns null if no candidate matches.
 */
export function decodeNativeIx(
  programId: string,
  data: Uint8Array,
): { name: string; args: Record<string, unknown> } | null {
  const candidates = NATIVE_INSTRUCTIONS.filter((i) => i.programId === programId);
  for (const def of candidates) {
    try {
      const result = tryDecode(def, data);
      if (result) return { name: def.name, args: result };
    } catch {
      /* try next */
    }
  }
  return null;
}

function tryDecode(def: NativeIx, data: Uint8Array): Record<string, unknown> | null {
  let off = 0;

  // utf8: entire payload is the single utf8 arg
  if (def.tag.kind === 'utf8') {
    if (def.args.length !== 1) return null;
    const argName = def.args[0]!.name;
    return { [argName]: new TextDecoder('utf-8').decode(data) };
  }

  // Validate tag
  if (def.tag.kind === 'u8') {
    if (data.length < 1) return null;
    if (data[0] !== def.tag.value) return null;
    off = 1;
  } else if (def.tag.kind === 'u32') {
    if (data.length < 4) return null;
    const view = new DataView(data.buffer, data.byteOffset);
    if (view.getUint32(0, true) !== def.tag.value) return null;
    off = 4;
  } else if (def.tag.kind === 'none') {
    off = 0;
  }

  const args: Record<string, unknown> = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const a of def.args) {
    const r = readArg(view, data, off, a.type);
    if (!r) return null;
    args[a.name] = r.value;
    off = r.nextOffset;
  }
  // Allow trailing bytes (some programs accept extra) — accept partial match if all args read.
  return args;
}

function readArg(
  view: DataView,
  data: Uint8Array,
  off: number,
  type: ArgType,
): { value: unknown; nextOffset: number } | null {
  switch (type) {
    case 'u8':
      if (off + 1 > data.length) return null;
      return { value: view.getUint8(off), nextOffset: off + 1 };
    case 'u16':
      if (off + 2 > data.length) return null;
      return { value: view.getUint16(off, true), nextOffset: off + 2 };
    case 'u32':
      if (off + 4 > data.length) return null;
      return { value: view.getUint32(off, true), nextOffset: off + 4 };
    case 'u64':
      if (off + 8 > data.length) return null;
      return { value: view.getBigUint64(off, true).toString(), nextOffset: off + 8 };
    case 'i64':
      if (off + 8 > data.length) return null;
      return { value: view.getBigInt64(off, true).toString(), nextOffset: off + 8 };
    case 'bool':
      if (off + 1 > data.length) return null;
      return { value: view.getUint8(off) !== 0, nextOffset: off + 1 };
    case 'pubkey': {
      if (off + 32 > data.length) return null;
      const pk = new PublicKey(data.slice(off, off + 32)).toBase58();
      return { value: pk, nextOffset: off + 32 };
    }
    case 'utf8': {
      const remaining = data.slice(off);
      return { value: new TextDecoder('utf-8').decode(remaining), nextOffset: data.length };
    }
    case 'optionPubkey': {
      if (off + 4 > data.length) return null;
      const tag = view.getUint32(off, true);
      if (tag === 0) {
        return { value: null, nextOffset: off + 4 };
      }
      if (tag === 1) {
        if (off + 4 + 32 > data.length) return null;
        const pk = new PublicKey(data.slice(off + 4, off + 4 + 32)).toBase58();
        return { value: pk, nextOffset: off + 4 + 32 };
      }
      return null;
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
