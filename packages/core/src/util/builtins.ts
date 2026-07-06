import { PublicKey } from '@solana/web3.js';

export const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const MEMO_PROGRAM_V1 = new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');
export const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
export const ADDRESS_LOOKUP_TABLE_PROGRAM = new PublicKey(
  'AddressLookupTab1e1111111111111111111111111',
);
export const METAPLEX_TOKEN_METADATA_PROGRAM = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);
export const METAPLEX_AUCTION_HOUSE_PROGRAM = new PublicKey(
  'hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk',
);

export interface BuiltinDescriptor {
  programId: string;
  label: string;
  /** Bundled into LiteSVM (no clone, no ELF). */
  inSvm: boolean;
  /** Auto-cloned on project creation / first program.add. Treated as built-in by the UI. */
  autoCloned?: boolean;
  /** Has a known Anchor IDL we'd want to ship later (P7 IDL pack). */
  hasIdl: boolean;
  description: string;
}

/**
 * Programs always available — either bundled into LiteSVM or auto-cloned at
 * project creation. User does not need to clone them manually.
 */
export const BUILTIN_PROGRAM_LIST: BuiltinDescriptor[] = [
  {
    programId: SYSTEM_PROGRAM.toBase58(),
    label: 'System',
    inSvm: true,
    hasIdl: false,
    description: 'Native System Program (CreateAccount, Transfer, …)',
  },
  {
    programId: TOKEN_PROGRAM.toBase58(),
    label: 'SPL Token',
    inSvm: true,
    hasIdl: false,
    description: 'SPL Token Program — mint / transfer / approve',
  },
  {
    programId: TOKEN_2022_PROGRAM.toBase58(),
    label: 'Token-2022',
    inSvm: true,
    hasIdl: false,
    description: 'SPL Token-2022 Program with extensions',
  },
  {
    programId: ATA_PROGRAM.toBase58(),
    label: 'Associated Token Account',
    inSvm: true,
    hasIdl: false,
    description: 'Associated Token Account Program',
  },
  {
    programId: MEMO_PROGRAM.toBase58(),
    label: 'Memo v2',
    inSvm: true,
    hasIdl: false,
    description: 'SPL Memo v2',
  },
  {
    programId: MEMO_PROGRAM_V1.toBase58(),
    label: 'Memo v1',
    inSvm: true,
    hasIdl: false,
    description: 'SPL Memo v1',
  },
  {
    programId: COMPUTE_BUDGET_PROGRAM.toBase58(),
    label: 'Compute Budget',
    inSvm: true,
    hasIdl: false,
    description: 'Compute Budget Program',
  },
  {
    programId: ADDRESS_LOOKUP_TABLE_PROGRAM.toBase58(),
    label: 'Address Lookup Table',
    inSvm: true,
    hasIdl: false,
    description: 'Address Lookup Table Program (v0 tx ALTs)',
  },
  {
    programId: METAPLEX_TOKEN_METADATA_PROGRAM.toBase58(),
    label: 'Metaplex Token Metadata',
    inSvm: false,
    autoCloned: true,
    hasIdl: true,
    description:
      'Metaplex Token Metadata - auto-attached on project create. Bundled blob, no mainnet RPC roundtrip.',
  },
];

const SVM_BUILTIN_KEYS = new Set<string>(
  BUILTIN_PROGRAM_LIST.filter((b) => b.inSvm).map((b) => b.programId),
);
const ALL_BUILTIN_KEYS = new Set<string>(BUILTIN_PROGRAM_LIST.map((b) => b.programId));

/** Available in-place within LiteSVM: skip both clone and addProgram. */
export const BUILTIN_PROGRAMS = SVM_BUILTIN_KEYS;

export function isBuiltinProgram(programId: PublicKey | string): boolean {
  const key = typeof programId === 'string' ? programId : programId.toBase58();
  return SVM_BUILTIN_KEYS.has(key);
}

/** Includes inSvm builtins + auto-cloned helpers (Metaplex Metadata, etc.). */
export function isKnownBuiltinOrBundled(programId: PublicKey | string): boolean {
  const key = typeof programId === 'string' ? programId : programId.toBase58();
  return ALL_BUILTIN_KEYS.has(key);
}

export function getBuiltinDescriptor(programId: PublicKey | string): BuiltinDescriptor | null {
  const key = typeof programId === 'string' ? programId : programId.toBase58();
  return BUILTIN_PROGRAM_LIST.find((b) => b.programId === key) ?? null;
}
