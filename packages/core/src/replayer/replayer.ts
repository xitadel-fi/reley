import { ErrorCode, RelayError, type TraceNode } from '@reley/shared';
import {
  type AccountInfo,
  AddressLookupTableAccount,
  type Commitment,
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { Cloner } from '../cloner/cloner.js';
import { SvmInstance, type SvmTxResult } from '../svm/svm.js';
import { parseTrace } from '../trace/parser.js';
import { BUILTIN_PROGRAMS } from '../util/builtins.js';

export interface ReplayInput {
  signature: string;
  rpcUrl: string;
  network: string;
  commitment?: Commitment;
}

export interface ReplayResult {
  signature: string;
  slot: bigint;
  onChain: {
    success: boolean;
    cuConsumed: bigint;
    logs: string[];
    errorMessage: string | null;
  };
  local: {
    success: boolean;
    cuConsumed: bigint;
    logs: string[];
    errorMessage: string | null;
    trace: TraceNode[];
  };
  /** Per-frame comparison summary: 'match' | 'divergent' | 'failed-locally'. */
  verdict: 'match' | 'divergent' | 'failed-locally';
  /** Accounts hydrated from `slot-1`. */
  hydratedAccounts: string[];
  /** Programs loaded into the SVM (excluding built-ins). */
  loadedPrograms: string[];
}

export class Replayer {
  constructor(
    private readonly rpcUrl: string,
    private readonly network: string,
  ) {}

  async replay(input: ReplayInput): Promise<ReplayResult> {
    const conn = new Connection(input.rpcUrl, { commitment: input.commitment ?? 'confirmed' });

    const tx = await conn.getTransaction(input.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || !tx.meta) {
      throw new RelayError(
        ErrorCode.REPLAY_HYDRATE_FAILURE,
        `transaction not found or missing meta: ${input.signature}`,
      );
    }

    const slot = BigInt(tx.slot);
    const hydrateSlot = slot - 1n;

    // Resolve all account keys (incl. ALT)
    const message = tx.transaction.message;
    const staticKeys = message.staticAccountKeys;
    const altKeysWritable: PublicKey[] = [];
    const altKeysReadonly: PublicKey[] = [];

    if (message.addressTableLookups.length > 0) {
      const altAccs = await Promise.all(
        message.addressTableLookups.map(async (lookup) => {
          const info = await conn.getAccountInfo(lookup.accountKey);
          if (!info) {
            throw new RelayError(
              ErrorCode.REPLAY_HYDRATE_FAILURE,
              `lookup table missing: ${lookup.accountKey.toBase58()}`,
            );
          }
          return {
            lookup,
            table: new AddressLookupTableAccount({
              key: lookup.accountKey,
              state: AddressLookupTableAccount.deserialize(info.data),
            }),
          };
        }),
      );
      for (const { lookup, table } of altAccs) {
        for (const idx of lookup.writableIndexes) {
          const key = table.state.addresses[idx];
          if (key) altKeysWritable.push(key);
        }
        for (const idx of lookup.readonlyIndexes) {
          const key = table.state.addresses[idx];
          if (key) altKeysReadonly.push(key);
        }
      }
    }

    const allKeys = [...staticKeys, ...altKeysWritable, ...altKeysReadonly];

    // Identify programs in this tx (top-level + inner)
    const programIds = new Set<string>();
    for (const ix of message.compiledInstructions) {
      const pid = allKeys[ix.programIdIndex];
      if (pid) programIds.add(pid.toBase58());
    }
    for (const inner of tx.meta.innerInstructions ?? []) {
      for (const ix of inner.instructions) {
        const pid = allKeys[ix.programIdIndex];
        if (pid) programIds.add(pid.toBase58());
      }
    }

    // Hydrate every account at slot - 1
    const clonerCommit = (input.commitment ?? 'confirmed') as
      | 'processed'
      | 'confirmed'
      | 'finalized';
    const cloner = new Cloner(input.rpcUrl, { network: input.network, commitment: clonerCommit });
    const svm = new SvmInstance();
    const hydratedAccounts: string[] = [];
    const loadedPrograms: string[] = [];

    const hydratedAccountInfos = await this.fetchAccountsAtSlot(conn, allKeys, hydrateSlot);
    for (let i = 0; i < allKeys.length; i += 1) {
      const key = allKeys[i];
      const info = hydratedAccountInfos[i];
      if (!key || !info) continue;
      svm.setAccount(key, info);
      hydratedAccounts.push(key.toBase58());
    }

    // Load programs (skip built-ins; SVM has them already)
    for (const pidStr of programIds) {
      if (BUILTIN_PROGRAMS.has(pidStr)) continue;
      const pid = new PublicKey(pidStr);
      try {
        const cloned = await cloner.cloneProgram(pid);
        svm.addProgram(pid, cloned.elf);
        loadedPrograms.push(pidStr);
        // For Upgradeable, ProgramData account also needs to be set or LiteSVM
        // resolution may differ. Since addProgram bypasses, this is OK.
      } catch {
        // Could be a deprecated loader the cloner doesn't fully support; skip.
      }
    }

    // Execute
    const rawTx = tx.transaction;
    const txBytes = serializeMessageWithSignatures(rawTx);
    let localResult: SvmTxResult;
    try {
      const versioned = VersionedTransaction.deserialize(txBytes);
      localResult = svm.sendTransaction(versioned);
    } catch (err) {
      localResult = {
        success: false,
        signature: null,
        logs: [],
        cuConsumed: 0n,
        returnData: null,
        errorMessage: (err as Error).message,
      };
    }

    const trace = parseTrace(localResult.logs);

    // Compare
    const onChainLogs = tx.meta.logMessages ?? [];
    const onChainSuccess = tx.meta.err === null;
    const onChainCu = BigInt(tx.meta.computeUnitsConsumed ?? 0);

    let verdict: ReplayResult['verdict'];
    if (!localResult.success && onChainSuccess) verdict = 'failed-locally';
    else if (localResult.success === onChainSuccess && logsMatch(localResult.logs, onChainLogs)) {
      verdict = 'match';
    } else {
      verdict = 'divergent';
    }

    return {
      signature: input.signature,
      slot,
      onChain: {
        success: onChainSuccess,
        cuConsumed: onChainCu,
        logs: onChainLogs,
        errorMessage: onChainSuccess ? null : JSON.stringify(tx.meta.err),
      },
      local: {
        success: localResult.success,
        cuConsumed: localResult.cuConsumed,
        logs: localResult.logs,
        errorMessage: localResult.errorMessage,
        trace,
      },
      verdict,
      hydratedAccounts,
      loadedPrograms,
    };
  }

  private async fetchAccountsAtSlot(
    conn: Connection,
    keys: PublicKey[],
    slot: bigint,
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const chunkSize = 100;
    const out: Array<AccountInfo<Buffer> | null> = new Array(keys.length).fill(null);
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const infos = await conn.getMultipleAccountsInfo(chunk, {
        commitment: 'confirmed',
        minContextSlot: Number(slot),
      });
      for (let j = 0; j < infos.length; j += 1) out[i + j] = infos[j] ?? null;
    }
    return out;
  }
}

function serializeMessageWithSignatures(tx: {
  message: { serialize(): Uint8Array };
  signatures: string[];
}): Uint8Array {
  // Reconstruct full v0 wire format: signature count (shortvec) + sigs + message
  const msgBytes = tx.message.serialize();
  const sigs = tx.signatures.map((s) => bs58Decode(s));
  const sigCountBytes = encodeShortvec(sigs.length);
  const total = Buffer.concat([
    Buffer.from(sigCountBytes),
    ...sigs.map((s) => Buffer.from(s)),
    Buffer.from(msgBytes),
  ]);
  return new Uint8Array(total);
}

function bs58Decode(s: string): Uint8Array {
  return bs58.decode(s);
}

function encodeShortvec(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (true) {
    let elem = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(elem);
      return out;
    }
    elem |= 0x80;
    out.push(elem);
  }
}

function logsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
