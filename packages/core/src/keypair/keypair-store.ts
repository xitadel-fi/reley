import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorCode, RelayError, type Uuid } from '@reley/shared';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export interface KeypairMeta {
  id: Uuid;
  label: string;
  pubkey: string;
  createdAt: number;
  /** True if the secret is sealed via Electron safeStorage; false = plaintext (warn). */
  sealed: boolean;
}

interface StoredKeypair extends KeypairMeta {
  /** base58 (plaintext) or base64 (safeStorage-sealed). */
  secret: string;
}

/**
 * Sealing hook: when running under Electron, the main process injects an
 * implementation backed by `safeStorage`. When called from non-Electron contexts
 * (CLI, tests, headless worker), seal/unseal are identity functions and stored
 * keypairs carry sealed=false.
 */
export interface SealAdapter {
  seal(plaintext: Uint8Array): Promise<Uint8Array> | Uint8Array;
  unseal(sealed: Uint8Array): Promise<Uint8Array> | Uint8Array;
  available: boolean;
}

const IDENTITY_SEAL: SealAdapter = {
  seal: (b) => b,
  unseal: (b) => b,
  available: false,
};

export class KeypairStore {
  private items = new Map<string, StoredKeypair>();
  private loaded = false;

  constructor(
    private readonly rootDir: string,
    private readonly seal: SealAdapter = IDENTITY_SEAL,
  ) {}

  private get path(): string {
    return join(this.rootDir, 'keypairs.json');
  }

  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.rootDir)) await mkdir(this.rootDir, { recursive: true });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.ensureRoot();
    if (existsSync(this.path)) {
      const raw = await readFile(this.path, 'utf8');
      const list = JSON.parse(raw) as StoredKeypair[];
      this.items = new Map(list.map((k) => [k.id, k]));
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.ensureRoot();
    await writeFile(this.path, JSON.stringify(Array.from(this.items.values()), null, 2));
  }

  async generate(label: string): Promise<KeypairMeta> {
    await this.load();
    const kp = Keypair.generate();
    return this.put(kp, label);
  }

  async importSecret(label: string, secret: number[] | string): Promise<KeypairMeta> {
    await this.load();
    const bytes = Array.isArray(secret) ? new Uint8Array(secret) : bs58.decode(secret);
    if (bytes.length !== 64) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `keypair secret must be 64 bytes (got ${bytes.length})`,
      );
    }
    const kp = Keypair.fromSecretKey(bytes);
    return this.put(kp, label);
  }

  private async put(kp: Keypair, label: string): Promise<KeypairMeta> {
    const sealed = this.seal.available;
    const secret = sealed
      ? Buffer.from(await this.seal.seal(kp.secretKey)).toString('base64')
      : bs58.encode(kp.secretKey);

    const item: StoredKeypair = {
      id: randomUUID(),
      label,
      pubkey: kp.publicKey.toBase58(),
      createdAt: Date.now(),
      sealed,
      secret,
    };
    this.items.set(item.id, item);
    await this.save();
    const { secret: _, ...meta } = item;
    return meta;
  }

  async list(): Promise<KeypairMeta[]> {
    await this.load();
    return Array.from(this.items.values()).map(({ secret: _s, ...m }) => m);
  }

  async delete(id: string): Promise<void> {
    await this.load();
    if (!this.items.delete(id)) {
      throw new RelayError(ErrorCode.NOT_FOUND, `keypair not found: ${id}`);
    }
    await this.save();
  }

  async resealAll(): Promise<{ updated: number }> {
    await this.load();
    if (!this.seal.available) {
      throw new RelayError(
        ErrorCode.UNAUTHORIZED,
        'seal adapter not available (safeStorage off or not running under Electron)',
      );
    }
    let updated = 0;
    for (const item of this.items.values()) {
      if (item.sealed) continue;
      const secretBytes = bs58.decode(item.secret);
      const sealed = await this.seal.seal(secretBytes);
      item.secret = Buffer.from(sealed).toString('base64');
      item.sealed = true;
      updated += 1;
    }
    if (updated > 0) await this.save();
    return { updated };
  }

  async exportSecretKey(id: string): Promise<Uint8Array> {
    await this.load();
    const item = this.items.get(id);
    if (!item) throw new RelayError(ErrorCode.NOT_FOUND, `keypair not found: ${id}`);
    if (item.sealed) {
      const bytes = Buffer.from(item.secret, 'base64');
      const opened = this.seal.unseal(new Uint8Array(bytes));
      return opened instanceof Promise ? await opened : opened;
    }
    return bs58.decode(item.secret);
  }
}
