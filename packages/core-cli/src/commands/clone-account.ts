import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cloner } from '@reley/core';
import { PublicKey } from '@solana/web3.js';

export interface CloneAccountOpts {
  rpc: string;
  out: string;
  network: string;
  slot?: string;
  cache?: string;
}

export async function cloneAccountCmd(address: string, opts: CloneAccountOpts): Promise<void> {
  const pk = new PublicKey(address);
  const cloner = new Cloner(opts.rpc, {
    network: opts.network,
    ...(opts.cache && { cacheDir: opts.cache }),
  });

  console.log(`fetching account ${pk.toBase58()} from ${opts.rpc}...`);
  const slot = opts.slot ? BigInt(opts.slot) : undefined;
  const cloned = await cloner.cloneAccount(pk, slot);

  await mkdir(opts.out, { recursive: true });
  const dataPath = join(opts.out, `${pk.toBase58()}.bin`);
  const metaPath = join(opts.out, `${pk.toBase58()}.json`);

  await writeFile(dataPath, cloned.account.data);
  const meta = {
    address: pk.toBase58(),
    lamports: cloned.account.lamports,
    owner: cloned.account.owner.toBase58(),
    executable: cloned.account.executable,
    rentEpoch: cloned.account.rentEpoch,
    dataBytes: cloned.account.data.length,
    slot: cloned.slot.toString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  console.log(`data → ${dataPath} (${cloned.account.data.length} bytes)`);
  console.log(`meta → ${metaPath}`);
  console.log(`owner: ${cloned.account.owner.toBase58()}`);
}
