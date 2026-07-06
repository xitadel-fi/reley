import { ErrorCode, RelayError } from '@reley/shared';
import { type AccountInfo, type Commitment, Connection, PublicKey } from '@solana/web3.js';
import {
  type LoaderKind,
  deriveProgramDataAddress,
  detectLoader,
  parseUpgradeableProgramData,
} from '../util/loader.js';
import { BlobCache } from './cache.js';
import type { ClonedAccount, ClonedProgram, ClonerOptions } from './types.js';

export class Cloner {
  private readonly conn: Connection;
  private readonly network: string;
  private readonly commitment: Commitment;
  private readonly cache: BlobCache | null;

  constructor(rpcUrl: string, opts: ClonerOptions & { network: string }) {
    this.conn = new Connection(rpcUrl, { commitment: opts.commitment ?? 'confirmed' });
    this.network = opts.network;
    this.commitment = opts.commitment ?? 'confirmed';
    this.cache = opts.cacheDir ? new BlobCache(opts.cacheDir) : null;
  }

  async cloneAccount(address: PublicKey, slot?: bigint): Promise<ClonedAccount> {
    const fetchSlot = slot ?? null;
    const info = await this.fetchAccount(address, fetchSlot);
    if (!info) {
      throw new RelayError(
        ErrorCode.ACCOUNT_NOT_CLONABLE,
        `account not found: ${address.toBase58()}`,
      );
    }
    const ctxSlot = await this.conn.getSlot(this.commitment);
    return { address, account: info, slot: fetchSlot ?? BigInt(ctxSlot) };
  }

  async cloneAccounts(addresses: PublicKey[], slot?: bigint): Promise<ClonedAccount[]> {
    if (addresses.length === 0) return [];
    const ctxSlot = await this.conn.getSlot(this.commitment);
    const useSlot = slot ?? BigInt(ctxSlot);
    const infos = await this.conn.getMultipleAccountsInfo(addresses, {
      commitment: this.commitment,
      ...(slot !== undefined && { minContextSlot: Number(slot) }),
    });
    return infos.map((info, idx) => {
      if (!info) {
        const addr = addresses[idx];
        throw new RelayError(
          ErrorCode.ACCOUNT_NOT_CLONABLE,
          `account not found: ${addr ? addr.toBase58() : 'unknown'}`,
        );
      }
      const addr = addresses[idx];
      if (!addr) {
        throw new RelayError(ErrorCode.INTERNAL, `address missing at index ${idx}`);
      }
      return { address: addr, account: info, slot: useSlot };
    });
  }

  async cloneProgram(programId: PublicKey, slot?: bigint): Promise<ClonedProgram> {
    const programAccount = await this.fetchAccount(programId, slot ?? null);
    if (!programAccount) {
      throw new RelayError(
        ErrorCode.PROGRAM_LOAD_FAILURE,
        `program account not found: ${programId.toBase58()}`,
      );
    }
    if (!programAccount.executable) {
      throw new RelayError(
        ErrorCode.PROGRAM_LOAD_FAILURE,
        `account is not executable: ${programId.toBase58()}`,
      );
    }

    const loader: LoaderKind = detectLoader(programAccount.owner);
    const ctxSlot = await this.conn.getSlot(this.commitment);
    const finalSlot = slot ?? BigInt(ctxSlot);

    if (loader === 'upgradeable') {
      const programDataAddress = deriveProgramDataAddress(programId);
      const programDataAccount = await this.fetchAccount(programDataAddress, slot ?? null);
      if (!programDataAccount) {
        throw new RelayError(
          ErrorCode.PROGRAM_LOAD_FAILURE,
          `ProgramData account not found for ${programId.toBase58()}`,
        );
      }
      const { elf, upgradeAuthority } = parseUpgradeableProgramData(programDataAccount.data);
      return {
        programId,
        loader,
        elf,
        programAccount,
        programDataAddress,
        programDataAccount,
        upgradeAuthority,
        slot: finalSlot,
      };
    }

    if (loader === 'bpf2' || loader === 'bpfDeprecated' || loader === 'v4') {
      return {
        programId,
        loader,
        elf: new Uint8Array(programAccount.data),
        programAccount,
        programDataAddress: null,
        programDataAccount: null,
        upgradeAuthority: null,
        slot: finalSlot,
      };
    }

    throw new RelayError(
      ErrorCode.PROGRAM_LOAD_FAILURE,
      `unsupported loader for ${programId.toBase58()}: owner=${programAccount.owner.toBase58()}`,
      { owner: programAccount.owner.toBase58() },
    );
  }

  private async fetchAccount(
    address: PublicKey,
    slot: bigint | null,
  ): Promise<AccountInfo<Buffer> | null> {
    const cacheKey = {
      network: this.network,
      kind: 'account' as const,
      address: address.toBase58(),
      slot,
    };

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return deserializeAccountInfo(cached);
      }
    }

    const opts =
      slot !== null
        ? { commitment: this.commitment, minContextSlot: Number(slot) }
        : { commitment: this.commitment };
    const info = await this.conn.getAccountInfo(address, opts);
    if (!info) return null;

    if (this.cache) {
      await this.cache.set(cacheKey, serializeAccountInfo(info));
    }
    return info;
  }
}


function serializeAccountInfo(info: AccountInfo<Buffer>): Uint8Array {
  const ownerBytes = info.owner.toBuffer();
  const dataLen = info.data.length;
  const buf = Buffer.alloc(8 + 32 + 1 + 8 + 4 + dataLen);
  buf.writeBigUInt64LE(BigInt(info.lamports), 0);
  ownerBytes.copy(buf, 8);
  buf.writeUInt8(info.executable ? 1 : 0, 40);
  buf.writeBigUInt64LE(BigInt(info.rentEpoch ?? 0), 41);
  buf.writeUInt32LE(dataLen, 49);
  info.data.copy(buf, 53);
  return new Uint8Array(buf);
}

function deserializeAccountInfo(bytes: Uint8Array): AccountInfo<Buffer> {
  const buf = Buffer.from(bytes);
  const lamports = Number(buf.readBigUInt64LE(0));
  const owner = new PublicKey(buf.subarray(8, 40));
  const executable = buf.readUInt8(40) === 1;
  const rentEpoch = Number(buf.readBigUInt64LE(41));
  const dataLen = buf.readUInt32LE(49);
  const data = Buffer.from(buf.subarray(53, 53 + dataLen));
  return { lamports, owner, executable, rentEpoch, data };
}
