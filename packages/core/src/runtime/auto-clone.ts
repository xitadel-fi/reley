/**
 * Auto-clone missing accounts + programs referenced by an incoming transaction.
 *
 * Pre-flight: deserialize the tx → collect every static account key referenced
 * → diff against what's already in the SVM → bulk fetch the missing ones from
 * the project's RPC → for accounts: inject into the SVM + persist to the
 * sandbox state. For programs (executable accounts owned by a BPF loader):
 * extract ELF + register as a new project program via the supplied callback.
 *
 * Missing accounts that don't exist on-chain are injected as zero-lamport
 * System accounts (the usual case for PDAs that the tx itself creates).
 *
 * ALT resolution lives in a separate phase.
 */
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import { type AccountSnapshot } from '@reley/shared';
import type { SvmInstance } from '../svm/svm.js';
import { isBuiltinProgram } from '../util/builtins.js';
import {
  deriveProgramDataAddress,
  detectLoader,
  parseUpgradeableProgramData,
  type LoaderKind,
} from '../util/loader.js';

export interface AutoCloneReport {
  cloned: string[];
  /** Pubkeys whose on-chain account didn't exist; injected as zero-lamport
   *  System accounts so the tx can still create them. */
  injectedAsSystem: string[];
  /** Newly-registered programs (executable accounts with a known loader). */
  clonedPrograms: string[];
  /** ALT pubkeys that were fetched + injected. The tx engine needs the ALT
   *  account itself in SVM to resolve indexes at runtime. */
  resolvedAlts: string[];
  slot: bigint | null;
  rpcError: string | null;
}

/**
 * Callback supplied by the runtime that persists a fetched program ELF as a
 * new project program. The runtime owns the BlobStore + ProjectStore so the
 * auto-clone module stays free of those dependencies.
 */
export interface ProgramRegistrar {
  /**
   * Persist ELF + return the blob hash. Auto-clone uses this hash to call
   * `addProgram` (also injected) so the program shows up in the sidebar.
   */
  saveElf(elf: Uint8Array): Promise<string>;
  /** Already known to the project? Skip clone. */
  hasProgram(programId: string): boolean;
  /** Register the new program (creates a single v1 ProgramVersion). */
  register(args: {
    programId: string;
    elfBlobHash: string;
    upgradeAuthority: string | null;
    slot: bigint;
  }): Promise<void>;
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Extract all unique static account keys from a tx (no ALT resolution). */
export function collectStaticAccountKeys(txBytes: Uint8Array): string[] {
  const tx = VersionedTransaction.deserialize(txBytes);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  return Array.from(new Set(keys));
}

/**
 * Fetch any addresses that aren't already in the SVM + inject them.
 * Executable accounts are routed to the program registrar; the rest land as
 * regular sandbox accounts.
 */
export async function autoCloneMissingAccounts(args: {
  txBytes: Uint8Array;
  svm: SvmInstance;
  /** Mutated in-place with cloned account snapshots so the next save picks
   *  them up. */
  sessionAccounts: Record<string, AccountSnapshot>;
  rpcUrl: string;
  /** Pubkeys already part of the project (cloned manually). Never overwrite. */
  projectAccountSet: Set<string>;
  /** Runtime-supplied program persistence hook. When omitted, programs are
   *  injected into LiteSVM in-memory only (won't survive reload). */
  programRegistrar?: ProgramRegistrar;
}): Promise<AutoCloneReport> {
  const { txBytes, svm, sessionAccounts, rpcUrl, projectAccountSet, programRegistrar } = args;

  const conn = new Connection(rpcUrl, { commitment: 'confirmed' });

  // ── Phase 3: resolve ALT lookups ────────────────────────────────────────
  // Fetch any ALT account the tx references that isn't already in SVM,
  // inject the raw bytes (LiteSVM resolves indexes from this), then decode
  // the table to expand the candidate pubkey list with writable/readonly
  // indexes the tx actually uses. Recursion is naturally capped at 1 ALT
  // level — ALT entries can't reference other ALTs in v1.
  const resolvedAlts: string[] = [];
  const altResolvedKeys: string[] = [];
  let altError: string | null = null;
  try {
    const tx = VersionedTransaction.deserialize(txBytes);
    for (const lookup of tx.message.addressTableLookups) {
      const tableAddr = lookup.accountKey.toBase58();
      // SVM already has this ALT?
      let tableInfo: { data: Buffer | Uint8Array } | null = null;
      try {
        const existing = svm.getAccount(lookup.accountKey);
        if (existing) tableInfo = existing;
      } catch {
        /* ignored */
      }
      if (!tableInfo) {
        const info = await conn.getAccountInfo(lookup.accountKey, {
          commitment: 'confirmed',
        });
        if (!info) continue;
        // Inject the raw ALT account into SVM + persist to sandbox.
        const snap: AccountSnapshot = {
          pubkey: tableAddr,
          lamports: BigInt(info.lamports),
          owner: info.owner.toBase58(),
          executable: info.executable,
          rentEpoch: 0n,
          data: new Uint8Array(info.data),
          clonedAtSlot: null,
          source: 'autoCloned',
        };
        sessionAccounts[tableAddr] = snap;
        svm.setAccount(lookup.accountKey, {
          lamports: info.lamports,
          owner: info.owner,
          executable: info.executable,
          rentEpoch: 0,
          data: Buffer.from(info.data),
        });
        resolvedAlts.push(tableAddr);
        tableInfo = info;
      }
      // Decode + expand referenced keys with the indexes this tx uses.
      try {
        const decoded = AddressLookupTableAccount.deserialize(
          Buffer.isBuffer(tableInfo.data) ? tableInfo.data : Buffer.from(tableInfo.data),
        );
        for (const idx of lookup.writableIndexes) {
          const key = decoded.addresses[idx];
          if (key) altResolvedKeys.push(key.toBase58());
        }
        for (const idx of lookup.readonlyIndexes) {
          const key = decoded.addresses[idx];
          if (key) altResolvedKeys.push(key.toBase58());
        }
      } catch {
        // bad ALT bytes — skip resolution, tx will fail naturally
      }
    }
  } catch (e) {
    altError = e instanceof Error ? e.message : String(e);
  }

  const referenced = Array.from(
    new Set([...collectStaticAccountKeys(txBytes), ...altResolvedKeys]),
  );
  const missing = referenced.filter((k) => {
    if (isBuiltinProgram(k)) return false;
    // why: sysvars are served internally by LiteSVM (svm.getAccount returns
    // null) but cloning them from RPC and re-injecting overrides those
    // internal copies with byte-for-byte mainnet data that breaks consumers
    // like SPL Token InitializeAccount-v1 (rent layout/owner mismatch).
    if (k.startsWith('Sysvar') || k === 'Sysvar1nstructions1111111111111111111111111') return false;
    if (projectAccountSet.has(k)) return false;
    if (programRegistrar?.hasProgram(k)) return false;
    if (sessionAccounts[k] !== undefined) return false;
    try {
      const acc = svm.getAccount(new PublicKey(k));
      if (acc !== null) return false;
    } catch {
      // pubkey parse error
    }
    return true;
  });

  if (missing.length === 0) {
    return {
      cloned: [],
      injectedAsSystem: [],
      clonedPrograms: [],
      resolvedAlts,
      slot: null,
      rpcError: altError,
    };
  }

  let slot: bigint | null = null;
  let infos: Array<Readable | null>;
  try {
    const ctxSlot = await conn.getSlot('confirmed');
    slot = BigInt(ctxSlot);
    const results: Array<Readable | null> = [];
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const got = await conn.getMultipleAccountsInfo(
        chunk.map((k) => new PublicKey(k)),
        { commitment: 'confirmed' },
      );
      for (const info of got) results.push(info ? toReadable(info) : null);
    }
    infos = results;
  } catch (e) {
    return {
      cloned: [],
      injectedAsSystem: [],
      clonedPrograms: [],
      resolvedAlts,
      slot,
      rpcError: e instanceof Error ? e.message : String(e),
    };
  }

  const cloned: string[] = [];
  const injectedAsSystem: string[] = [];
  const clonedPrograms: string[] = [];

  for (let i = 0; i < missing.length; i++) {
    const addr = missing[i]!;
    const info = infos[i];

    if (info && info.executable) {
      // Program account — load the ELF into LiteSVM. Persist as a project
      // program if a registrar was supplied.
      const ownerPk = new PublicKey(info.owner);
      const loader = detectLoader(ownerPk);
      try {
        const elf = await extractElf(conn, addr, info, loader, slot);
        if (elf) {
          svm.addProgram(new PublicKey(addr), elf.bytes);
          if (programRegistrar) {
            const hash = await programRegistrar.saveElf(elf.bytes);
            await programRegistrar.register({
              programId: addr,
              elfBlobHash: hash,
              upgradeAuthority: elf.upgradeAuthority,
              slot: slot ?? 0n,
            });
          }
          clonedPrograms.push(addr);
          continue;
        }
      } catch {
        // Fall through to account injection so the tx still has the bytes
        // even if ELF extraction failed for some reason.
      }
    }

    if (info) {
      const snap: AccountSnapshot = {
        pubkey: addr,
        lamports: BigInt(info.lamports),
        owner: info.owner,
        executable: info.executable,
        rentEpoch: 0n,
        data: info.data,
        clonedAtSlot: slot,
        source: 'autoCloned',
      };
      sessionAccounts[addr] = snap;
      svm.setAccount(new PublicKey(addr), {
        lamports: info.lamports,
        owner: new PublicKey(info.owner),
        executable: info.executable,
        rentEpoch: 0,
        data: Buffer.from(info.data),
      });
      cloned.push(addr);
    } else {
      // Account doesn't exist on chain → inject as default System account so
      // the runtime can create it via system_program::create_account.
      const snap: AccountSnapshot = {
        pubkey: addr,
        lamports: 0n,
        owner: SYSTEM_PROGRAM,
        executable: false,
        rentEpoch: 0n,
        data: new Uint8Array(0),
        clonedAtSlot: slot,
        source: 'autoCloned',
      };
      sessionAccounts[addr] = snap;
      svm.setAccount(new PublicKey(addr), {
        lamports: 0,
        owner: new PublicKey(SYSTEM_PROGRAM),
        executable: false,
        rentEpoch: 0,
        data: Buffer.alloc(0),
      });
      injectedAsSystem.push(addr);
    }
  }

  return {
    cloned,
    injectedAsSystem,
    clonedPrograms,
    resolvedAlts,
    slot,
    rpcError: altError,
  };
}

interface Readable {
  lamports: number;
  owner: string;
  executable: boolean;
  data: Uint8Array;
}
function toReadable(info: {
  lamports: number;
  owner: PublicKey;
  executable: boolean;
  data: Buffer;
}): Readable {
  return {
    lamports: info.lamports,
    owner: info.owner.toBase58(),
    executable: info.executable,
    data: new Uint8Array(info.data),
  };
}

/**
 * Pull ELF bytes out of a fetched program account. Upgradeable programs need
 * a second fetch (ProgramData PDA); v2/deprecated/v4 carry the ELF inline.
 * Returns null when the loader isn't recognized — caller falls back to
 * generic account injection.
 */
async function extractElf(
  conn: Connection,
  programId: string,
  programInfo: Readable,
  loader: LoaderKind,
  slot: bigint | null,
): Promise<{ bytes: Uint8Array; upgradeAuthority: string | null } | null> {
  if (loader === 'bpf2' || loader === 'bpfDeprecated' || loader === 'v4') {
    return { bytes: programInfo.data, upgradeAuthority: null };
  }
  if (loader === 'upgradeable') {
    const programDataAddr = deriveProgramDataAddress(new PublicKey(programId));
    const programData = await conn.getAccountInfo(programDataAddr, {
      commitment: 'confirmed',
      ...(slot !== null && { minContextSlot: Number(slot) }),
    });
    if (!programData) return null;
    const { elf, upgradeAuthority } = parseUpgradeableProgramData(programData.data);
    return {
      bytes: elf,
      upgradeAuthority: upgradeAuthority ? upgradeAuthority.toBase58() : null,
    };
  }
  return null;
}
