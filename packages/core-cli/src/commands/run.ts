import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { SvmInstance } from '@reley/core';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';

export interface RunOpts {
  program: string[];
  account: string[];
  payer?: string;
  ix?: string;
  ixProgram?: string;
  ixAccount: string[];
  tx?: string;
  computeUnits?: string;
}

export async function runCmd(opts: RunOpts): Promise<void> {
  const svm = new SvmInstance();

  for (const spec of opts.program) {
    const { pubkey, path } = parsePubkeyPathSpec(spec, 'program');
    const elf = new Uint8Array(await readFile(path));
    svm.addProgram(pubkey, elf);
    console.log(`loaded program ${pubkey.toBase58()} (${elf.length} bytes) from ${basename(path)}`);
  }

  for (const spec of opts.account) {
    const { pubkey, path } = parsePubkeyPathSpec(spec, 'account');
    const data = await readFile(path);
    // Look for sibling .json metadata to get owner/lamports/executable
    const metaPath = path.replace(extname(path), '.json');
    let lamports = 1n * 1_000_000_000n;
    let owner = new PublicKey('11111111111111111111111111111111');
    let executable = false;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
        lamports?: number;
        owner?: string;
        executable?: boolean;
      };
      if (typeof meta.lamports === 'number') lamports = BigInt(meta.lamports);
      if (meta.owner) owner = new PublicKey(meta.owner);
      if (typeof meta.executable === 'boolean') executable = meta.executable;
    } catch {
      console.warn(`(no metadata at ${metaPath}; using defaults)`);
    }
    svm.setAccount(pubkey, {
      lamports: Number(lamports),
      data,
      owner,
      executable,
      rentEpoch: 0,
    });
    console.log(
      `set account ${pubkey.toBase58()} (${data.length} bytes, owner=${owner.toBase58()})`,
    );
  }

  let payer: Keypair;
  if (opts.payer) {
    const raw = JSON.parse(await readFile(opts.payer, 'utf8')) as number[];
    payer = Keypair.fromSecretKey(new Uint8Array(raw));
  } else {
    payer = Keypair.generate();
  }
  svm.airdrop(payer.publicKey, 10n * 1_000_000_000n);
  console.log(`payer: ${payer.publicKey.toBase58()}`);

  if (opts.tx) {
    const txBytes = Buffer.from(opts.tx, 'base64');
    const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
    printResult(svm.sendTransaction(tx));
    return;
  }

  if (!opts.ix || !opts.ixProgram) {
    throw new Error('must supply either --tx, or both --ix and --ix-program');
  }

  const ixProgramId = new PublicKey(opts.ixProgram);
  const ixData = Buffer.from(opts.ix.startsWith('0x') ? opts.ix.slice(2) : opts.ix, 'hex');
  const keys = opts.ixAccount.map(parseIxAccountSpec);

  const tx = new Transaction();
  if (opts.computeUnits) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: Number(opts.computeUnits) }));
  }
  tx.add(new TransactionInstruction({ programId: ixProgramId, keys, data: ixData }));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer);

  printResult(svm.sendTransaction(tx));
}

function parsePubkeyPathSpec(spec: string, kind: string): { pubkey: PublicKey; path: string } {
  const idx = spec.indexOf(':');
  if (idx < 0) {
    throw new Error(`invalid --${kind} spec "${spec}"; expected pubkey:path`);
  }
  const pubkey = new PublicKey(spec.slice(0, idx));
  const path = spec.slice(idx + 1);
  return { pubkey, path };
}

function parseIxAccountSpec(spec: string): {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
} {
  const parts = spec.split(':');
  if (parts.length !== 3) {
    throw new Error(`invalid --ix-account spec "${spec}"; expected pubkey:isSigner:isWritable`);
  }
  const [keyStr, signerStr, writableStr] = parts as [string, string, string];
  return {
    pubkey: new PublicKey(keyStr),
    isSigner: signerStr === 'true' || signerStr === '1',
    isWritable: writableStr === 'true' || writableStr === '1',
  };
}

function printResult(r: ReturnType<SvmInstance['sendTransaction']>): void {
  console.log('');
  console.log(`result: ${r.success ? 'SUCCESS' : 'FAILURE'}`);
  console.log(`cu consumed: ${r.cuConsumed.toString()}`);
  if (r.errorMessage) console.log(`error: ${r.errorMessage}`);
  if (r.returnData) console.log(`return data (hex): ${Buffer.from(r.returnData).toString('hex')}`);
  console.log('--- logs ---');
  for (const line of r.logs) console.log(line);
  console.log('------------');
}
