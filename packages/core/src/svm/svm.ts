import { ErrorCode, RelayError } from '@relay/shared';
import {
  type AccountInfo,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from '@solana/web3.js';
import {
  Clock,
  FailedTransactionMetadata,
  LiteSVM,
  SimulatedTransactionInfo,
  TransactionMetadata,
} from 'litesvm';

export interface SvmTxResult {
  success: boolean;
  signature: string | null;
  logs: string[];
  cuConsumed: bigint;
  returnData: Uint8Array | null;
  errorMessage: string | null;
}

export class SvmInstance {
  private readonly svm: LiteSVM;

  constructor() {
    this.svm = new LiteSVM();
  }

  raw(): LiteSVM {
    return this.svm;
  }

  addProgram(programId: PublicKey, elf: Uint8Array): void {
    this.svm.addProgram(programId, elf);
  }

  setAccount(address: PublicKey, account: AccountInfo<Buffer>): void {
    this.svm.setAccount(address, {
      lamports: account.lamports,
      data: account.data,
      owner: account.owner,
      executable: account.executable,
    });
  }

  getAccount(address: PublicKey): AccountInfo<Buffer> | null {
    const a = this.svm.getAccount(address);
    if (!a) return null;
    return {
      lamports: Number(a.lamports),
      owner: new PublicKey(a.owner),
      executable: a.executable,
      rentEpoch: 0,
      data: Buffer.from(a.data),
    };
  }

  airdrop(address: PublicKey, lamports: bigint): void {
    this.svm.airdrop(address, lamports);
  }

  latestBlockhash(): string {
    return this.svm.latestBlockhash();
  }

  warpToSlot(slot: bigint): void {
    this.svm.warpToSlot(slot);
  }

  /**
   * Set the SVM clock. Use this to drive `Clock::unix_timestamp` forward —
   * LiteSVM's `warpToSlot` only moves the slot field, not the timestamp.
   */
  setClock(c: {
    slot: bigint;
    epochStartTimestamp: bigint;
    epoch: bigint;
    leaderScheduleEpoch: bigint;
    unixTimestamp: bigint;
  }): void {
    this.svm.setClock(
      new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp),
    );
  }

  expireBlockhash(): void {
    this.svm.expireBlockhash();
  }

  getClock(): {
    slot: string;
    epoch: string;
    epochStartTimestamp: string;
    leaderScheduleEpoch: string;
    unixTimestamp: string;
  } {
    const c = this.svm.getClock();
    return {
      slot: c.slot.toString(),
      epoch: c.epoch.toString(),
      epochStartTimestamp: c.epochStartTimestamp.toString(),
      leaderScheduleEpoch: c.leaderScheduleEpoch.toString(),
      unixTimestamp: c.unixTimestamp.toString(),
    };
  }

  /** Same as getClock but returns raw bigints (no stringify). */
  getClockBig(): {
    slot: bigint;
    epoch: bigint;
    epochStartTimestamp: bigint;
    leaderScheduleEpoch: bigint;
    unixTimestamp: bigint;
  } {
    const c = this.svm.getClock();
    return {
      slot: c.slot,
      epoch: c.epoch,
      epochStartTimestamp: c.epochStartTimestamp,
      leaderScheduleEpoch: c.leaderScheduleEpoch,
      unixTimestamp: c.unixTimestamp,
    };
  }

  simulateTransaction(tx: Transaction | VersionedTransaction): SvmTxResult {
    const result = this.svm.simulateTransaction(tx);
    if (result instanceof FailedTransactionMetadata) {
      return {
        success: false,
        signature: null,
        logs: result.meta()?.logs() ?? [],
        cuConsumed: result.meta()?.computeUnitsConsumed() ?? 0n,
        returnData: extractReturnData(result.meta()?.returnData()),
        errorMessage: formatSvmError(result.err()),
      };
    }
    if (result instanceof SimulatedTransactionInfo) {
      const meta = result.meta();
      return {
        success: true,
        signature: null,
        logs: meta.logs(),
        cuConsumed: meta.computeUnitsConsumed(),
        returnData: extractReturnData(meta.returnData()),
        errorMessage: null,
      };
    }
    throw new RelayError(
      ErrorCode.SVM_EXECUTION_FAILURE,
      'unexpected simulateTransaction result type',
    );
  }

  sendTransaction(tx: Transaction | VersionedTransaction): SvmTxResult {
    const result = this.svm.sendTransaction(tx);
    if (result instanceof FailedTransactionMetadata) {
      return {
        success: false,
        signature: null,
        logs: result.meta()?.logs() ?? [],
        cuConsumed: result.meta()?.computeUnitsConsumed() ?? 0n,
        returnData: extractReturnData(result.meta()?.returnData()),
        errorMessage: formatSvmError(result.err()),
      };
    }
    if (result instanceof TransactionMetadata) {
      return {
        success: true,
        signature: null,
        logs: result.logs(),
        cuConsumed: result.computeUnitsConsumed(),
        returnData: extractReturnData(result.returnData()),
        errorMessage: null,
      };
    }
    throw new RelayError(ErrorCode.SVM_EXECUTION_FAILURE, 'unexpected sendTransaction result type');
  }
}

/**
 * Solana TransactionError variants are emitted by LiteSVM in different shapes
 * (string, object, tuple, plain number). Try to produce a human-readable
 * description without losing the underlying data.
 */
function formatSvmError(err: unknown): string {
  if (err === null || err === undefined) return 'unknown error';
  if (typeof err === 'string') return decodeKnownError(err);
  if (typeof err === 'number') return `code ${err}: ${decodeKnownError(String(err))}`;
  // LiteSVM err objects often have `toString()` that loses detail; prefer JSON
  try {
    const json = JSON.stringify(err, jsonReplacer);
    if (json && json !== '{}') return decodeKnownError(json);
  } catch {
    /* ignore */
  }
  try {
    return String((err as { toString?: () => string }).toString?.() ?? 'unknown');
  } catch {
    return 'unknown error';
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Map known Solana TransactionError codes to readable descriptions.
 * Cf. solana_sdk::transaction::TransactionError.
 */
const TRANSACTION_ERROR_NAMES: Record<string, string> = {
  '0': 'AccountInUse',
  '1': 'AccountLoadedTwice',
  '2': 'AccountNotFound',
  '3': 'ProgramAccountNotFound',
  '4': 'InsufficientFundsForFee',
  '5': 'InvalidAccountForFee',
  '6': 'AlreadyProcessed',
  '7': 'BlockhashNotFound',
  '8': 'InstructionError',
  '9': 'CallChainTooDeep',
  '10': 'MissingSignatureForFee',
  '11': 'InvalidAccountIndex',
  '12': 'SignatureFailure',
  '13': 'InvalidProgramForExecution',
  '14': 'SanitizeFailure',
  '15': 'ClusterMaintenance',
  '16': 'AccountBorrowOutstanding',
  '17': 'WouldExceedMaxBlockCostLimit',
  '18': 'UnsupportedVersion',
  '19': 'InvalidWritableAccount',
};

function decodeKnownError(raw: string): string {
  // bare number — map to error name
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const name = TRANSACTION_ERROR_NAMES[trimmed];
    return name ? `${name} (${trimmed})` : `TransactionError code ${trimmed}`;
  }
  // JSON with numeric variants — substitute names where possible
  return raw;
}

function extractReturnData(rd: unknown): Uint8Array | null {
  if (!rd || typeof rd !== 'object') return null;
  const obj = rd as { data?: unknown };
  if (!obj.data) return null;
  if (obj.data instanceof Uint8Array) return obj.data;
  if (Array.isArray(obj.data)) return new Uint8Array(obj.data as number[]);
  return null;
}
