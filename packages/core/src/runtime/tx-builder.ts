import { ErrorCode, RelayError } from '@reley/shared';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export interface InstructionSpec {
  programId: string;
  /** Account meta: { pubkey, isSigner, isWritable }. */
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  /** base64-encoded instruction data. */
  dataBase64: string;
}

export interface BuildTxInput {
  payer: string;
  ixs: InstructionSpec[];
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: number;
}

export interface SignerInput {
  /** base58 pubkey */
  pubkey: string;
  /** 64-byte secret key, base58 or array */
  secretKey: number[] | string;
}

export function buildTransaction(input: BuildTxInput): VersionedTransaction {
  const payer = new PublicKey(input.payer);
  const ixs: TransactionInstruction[] = [];

  if (input.computeUnitLimit !== undefined) {
    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnitLimit }));
  }
  if (input.computeUnitPrice !== undefined) {
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(input.computeUnitPrice) }),
    );
  }
  for (const spec of input.ixs) {
    ixs.push(
      new TransactionInstruction({
        programId: new PublicKey(spec.programId),
        keys: spec.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(spec.dataBase64, 'base64'),
      }),
    );
  }

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: input.recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function signTransaction(tx: VersionedTransaction, signers: SignerInput[]): void {
  if (signers.length === 0) {
    throw new RelayError(ErrorCode.INVALID_INPUT, 'no signers provided');
  }
  const kps = signers.map((s) =>
    Array.isArray(s.secretKey)
      ? Keypair.fromSecretKey(new Uint8Array(s.secretKey))
      : Keypair.fromSecretKey(bs58.decode(s.secretKey)),
  );
  tx.sign(kps);
}

export interface LegacyTxInput {
  payer: string;
  ixs: InstructionSpec[];
  recentBlockhash: string;
}

export function buildLegacyTransaction(input: LegacyTxInput): Transaction {
  const tx = new Transaction();
  tx.feePayer = new PublicKey(input.payer);
  tx.recentBlockhash = input.recentBlockhash;
  for (const spec of input.ixs) {
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(spec.programId),
        keys: spec.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(spec.dataBase64, 'base64'),
      }),
    );
  }
  return tx;
}
