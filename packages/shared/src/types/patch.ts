import type { Base58String, Uuid } from './primitives.js';

export type PatchOp =
  | { kind: 'setField'; fieldPath: string; valueJson: string }
  | { kind: 'rawSplice'; offset: number; bytes: Uint8Array }
  | { kind: 'setLamports'; lamports: bigint }
  | { kind: 'setOwner'; owner: Base58String };

export interface Patch {
  id: Uuid;
  target: Base58String;
  op: PatchOp;
  createdAt: number;
  enabled: boolean;
  folderId?: Uuid | null;
}

export type PatchScope = 'project' | 'session';
