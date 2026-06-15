export interface ProjectMeta {
  id: string;
  name: string;
  network: string;
  programCount: number;
  sessionCount: number;
  createdAt: number;
  lastOpenedAt: number;
  pinned: boolean;
}

export interface AccountEntry {
  address: string;
  label: string;
  blobHash: string;
  clonedAtSlot: string | null;
  source: 'cloned' | 'manual';
}

export interface ProgramVersion {
  id: string;
  label: string;
  elfBlobHash: string;
  source: { kind: 'cloned'; slot: string } | { kind: 'localFile'; path: string };
  idlId: string | null;
  notes?: string;
  createdAt: number;
}

export interface ProgramEntry {
  programId: string;
  label: string;
  elfBlobHash: string;
  source: { kind: 'cloned'; slot: string } | { kind: 'localFile'; path: string };
  idlId: string | null;
  accounts: AccountEntry[];
  upgradeAuthority: string | null;
  clonedAtSlot: string | null;
  versions: ProgramVersion[];
  activeVersionId: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  network: string;
  rpcEndpointId: string;
  programs: Record<string, ProgramEntry>;
  patches: unknown[];
  sessionIds: string[];
  keypairRefs: string[];
  scripts: unknown[];
  txTemplates?: unknown[];
  createdAt: number;
  lastOpenedAt: number;
  pinned: boolean;
}

export interface SessionMeta {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  accountCount: number;
  mutationCount: number;
  createdAt: number;
  lastUsedAt: number;
}
