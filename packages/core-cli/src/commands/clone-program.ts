import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cloner } from '@reley/core';
import { PublicKey } from '@solana/web3.js';

export interface CloneProgramOpts {
  rpc: string;
  out: string;
  network: string;
  slot?: string;
  cache?: string;
}

export async function cloneProgramCmd(programId: string, opts: CloneProgramOpts): Promise<void> {
  const pk = new PublicKey(programId);
  const cloner = new Cloner(opts.rpc, {
    network: opts.network,
    ...(opts.cache && { cacheDir: opts.cache }),
  });

  console.log(`fetching program ${pk.toBase58()} from ${opts.rpc}...`);
  const slot = opts.slot ? BigInt(opts.slot) : undefined;
  const result = await cloner.cloneProgram(pk, slot);

  await mkdir(opts.out, { recursive: true });
  const elfPath = join(opts.out, `${pk.toBase58()}.so`);
  const metaPath = join(opts.out, `${pk.toBase58()}.json`);

  await writeFile(elfPath, result.elf);
  const meta = {
    programId: pk.toBase58(),
    loader: result.loader,
    elfBytes: result.elf.length,
    upgradeAuthority: result.upgradeAuthority?.toBase58() ?? null,
    programDataAddress: result.programDataAddress?.toBase58() ?? null,
    slot: result.slot.toString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  console.log(`elf  → ${elfPath} (${result.elf.length} bytes)`);
  console.log(`meta → ${metaPath}`);
  console.log(`loader: ${result.loader}`);
  if (result.upgradeAuthority) {
    console.log(`upgrade authority: ${result.upgradeAuthority.toBase58()}`);
  }
}
