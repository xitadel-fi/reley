import type {
  AccountEntry,
  AccountSnapshot,
  NetworkId,
  Patch,
  PatchScope,
  ProgramEntry,
  ProgramSource,
  Project,
  ProjectMeta,
  ScriptEntry,
  SessionMeta,
  SessionState,
} from '@reley/shared';

export interface StoreSnapshot {
  formatVersion: number;
  projects: Project[];
  sessions: SessionState[];
}

export interface PersistenceSink {
  load(): Promise<StoreSnapshot | null>;
  save(snapshot: StoreSnapshot): Promise<void>;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  network: NetworkId;
  rpcEndpointId: string;
}

export interface CreateSessionInput {
  projectId: string;
  name: string;
}

export interface AddProgramInput {
  projectId: string;
  programId: string;
  label?: string;
  source: ProgramSource;
  elfBlobHash: string;
  upgradeAuthority?: string | null;
  clonedAtSlot?: bigint | null;
}

export interface AddAccountInput {
  projectId: string;
  programId: string;
  address: string;
  label?: string;
  blobHash: string;
  source?: 'cloned' | 'manual';
  clonedAtSlot?: bigint | null;
}

export interface CreatePatchInput {
  scope: PatchScope;
  scopeId: string;
  patch: Omit<Patch, 'id' | 'createdAt'>;
}

export type {
  AccountEntry,
  AccountSnapshot,
  NetworkId,
  Patch,
  PatchScope,
  ProgramEntry,
  Project,
  ProjectMeta,
  ScriptEntry,
  SessionMeta,
  SessionState,
};
