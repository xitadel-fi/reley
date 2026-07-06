import { PublicKey } from '@solana/web3.js';

export const BPF_LOADER_2 = new PublicKey('BPFLoader2111111111111111111111111111111111');
export const BPF_LOADER_DEPRECATED = new PublicKey('BPFLoader1111111111111111111111111111111111');
export const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const LOADER_V4 = new PublicKey('LoaderV411111111111111111111111111111111111');

export type LoaderKind = 'bpf2' | 'bpfDeprecated' | 'upgradeable' | 'v4' | 'unknown';

export function detectLoader(owner: PublicKey): LoaderKind {
  if (owner.equals(BPF_LOADER_UPGRADEABLE)) return 'upgradeable';
  if (owner.equals(BPF_LOADER_2)) return 'bpf2';
  if (owner.equals(BPF_LOADER_DEPRECATED)) return 'bpfDeprecated';
  if (owner.equals(LOADER_V4)) return 'v4';
  return 'unknown';
}

export function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE);
  return pda;
}

export const PROGRAM_DATA_HEADER_LEN = 45;

/**
 * Decode the bytes of an upgradeable-loader `ProgramData` account. Layout:
 *   - 4 bytes: enum discriminator (3 = ProgramData)
 *   - 8 bytes: last-deploy slot
 *   - 1 byte: hasAuthority flag
 *   - 32 bytes: upgrade authority pubkey (zeroed if no authority)
 *   - rest: ELF bytes
 */
export function parseUpgradeableProgramData(data: Buffer | Uint8Array): {
  elf: Uint8Array;
  upgradeAuthority: PublicKey | null;
} {
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  if (buf.length < PROGRAM_DATA_HEADER_LEN) {
    throw new Error('ProgramData buffer too short');
  }
  const hasAuthority = buf.readUInt8(12) === 1;
  let upgradeAuthority: PublicKey | null = null;
  if (hasAuthority) {
    upgradeAuthority = new PublicKey(buf.subarray(13, 13 + 32));
  }
  const elf = new Uint8Array(buf.subarray(PROGRAM_DATA_HEADER_LEN));
  return { elf, upgradeAuthority };
}
