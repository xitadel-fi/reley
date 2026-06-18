import { randomUUID } from 'node:crypto';
import { ErrorCode, RelayError } from '@relay/shared';
import type { ProgramSource, ProgramVersion } from '@relay/shared';
import type {
  AddAccountInput,
  AddProgramInput,
  CreateProjectInput,
  Project,
  ProjectMeta,
} from './types.js';

function mirrorActive<T extends { versions: ProgramVersion[]; activeVersionId: string }>(
  prog: T,
): T & { elfBlobHash: string; source: ProgramSource; clonedAtSlot: bigint | null } {
  const active = prog.versions.find((v) => v.id === prog.activeVersionId) ?? prog.versions[0];
  if (!active) return prog as never;
  return {
    ...prog,
    elfBlobHash: active.elfBlobHash,
    source: active.source,
    clonedAtSlot: active.source.kind === 'cloned' ? active.source.slot : null,
  };
}

export class ProjectStore {
  private readonly projects = new Map<string, Project>();

  list(): ProjectMeta[] {
    return Array.from(this.projects.values()).map((p) => this.toMeta(p));
  }

  get(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new RelayError(ErrorCode.NOT_FOUND, `project not found: ${id}`);
    return p;
  }

  create(input: CreateProjectInput): Project {
    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      network: input.network,
      rpcEndpointId: input.rpcEndpointId,
      programs: {},
      patches: [],
      sessionIds: [],
      keypairRefs: [],
      scripts: [],
      txTemplates: [],
      workflows: [],
      testSuites: [],
      createdAt: now,
      lastOpenedAt: now,
      pinned: false,
    };
    this.projects.set(project.id, project);
    return project;
  }

  rename(id: string, name: string): Project {
    const p = this.get(id);
    p.name = name;
    return p;
  }

  delete(id: string): void {
    if (!this.projects.delete(id)) {
      throw new RelayError(ErrorCode.NOT_FOUND, `project not found: ${id}`);
    }
  }

  touchOpened(id: string): void {
    const p = this.get(id);
    p.lastOpenedAt = Date.now();
  }

  addProgram(input: AddProgramInput): Project {
    const p = this.get(input.projectId);
    if (p.programs[input.programId]) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `program already in project: ${input.programId}`,
      );
    }
    const v1: ProgramVersion = {
      id: randomUUID(),
      label: 'v1',
      elfBlobHash: input.elfBlobHash,
      source: input.source,
      idlId: null,
      createdAt: Date.now(),
    };
    p.programs[input.programId] = mirrorActive({
      programId: input.programId,
      label: input.label ?? input.programId,
      idlId: null,
      accounts: [],
      upgradeAuthority: input.upgradeAuthority ?? null,
      versions: [v1],
      activeVersionId: v1.id,
      // mirrored below
      elfBlobHash: v1.elfBlobHash,
      source: v1.source,
      clonedAtSlot: v1.source.kind === 'cloned' ? v1.source.slot : null,
    });
    return p;
  }

  // ───────── Version management ─────────

  /** Add a new version under an existing program. */
  addProgramVersion(
    projectId: string,
    programId: string,
    input: { label: string; elfBlobHash: string; source: ProgramSource; idlId?: string | null; notes?: string },
  ): ProgramVersion {
    const p = this.get(projectId);
    const prog = p.programs[programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    if (prog.versions.some((v) => v.label === input.label)) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `version label already used: ${input.label}`,
      );
    }
    const version: ProgramVersion = {
      id: randomUUID(),
      label: input.label,
      elfBlobHash: input.elfBlobHash,
      source: input.source,
      idlId: input.idlId ?? null,
      ...(input.notes !== undefined && { notes: input.notes }),
      createdAt: Date.now(),
    };
    prog.versions.push(version);
    return version;
  }

  removeProgramVersion(projectId: string, programId: string, versionId: string): void {
    const p = this.get(projectId);
    const prog = p.programs[programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    if (prog.versions.length <= 1) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        'cannot remove the last version — remove the whole program instead',
      );
    }
    if (prog.activeVersionId === versionId) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        'cannot remove the active version — switch active first',
      );
    }
    const before = prog.versions.length;
    prog.versions = prog.versions.filter((v) => v.id !== versionId);
    if (prog.versions.length === before) {
      throw new RelayError(ErrorCode.NOT_FOUND, `version not found: ${versionId}`);
    }
  }

  setActiveProgramVersion(projectId: string, programId: string, versionId: string): void {
    const p = this.get(projectId);
    const prog = p.programs[programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    const v = prog.versions.find((x) => x.id === versionId);
    if (!v) throw new RelayError(ErrorCode.NOT_FOUND, `version not found: ${versionId}`);
    prog.activeVersionId = versionId;
    // Mirror top-level fields onto the new active version's bytes.
    prog.elfBlobHash = v.elfBlobHash;
    prog.source = v.source;
    prog.clonedAtSlot = v.source.kind === 'cloned' ? v.source.slot : null;
  }

  setProgramVersionLabel(
    projectId: string,
    programId: string,
    versionId: string,
    label: string,
  ): void {
    const p = this.get(projectId);
    const prog = p.programs[programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    if (prog.versions.some((v) => v.id !== versionId && v.label === label)) {
      throw new RelayError(ErrorCode.INVALID_INPUT, `version label already used: ${label}`);
    }
    const v = prog.versions.find((x) => x.id === versionId);
    if (!v) throw new RelayError(ErrorCode.NOT_FOUND, `version not found: ${versionId}`);
    v.label = label;
  }

  setProgramLabel(projectId: string, programId: string, label: string): Project {
    const p = this.get(projectId);
    const prog = p.programs[programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    prog.label = label;
    return p;
  }

  setAccountLabel(projectId: string, address: string, label: string): Project {
    const p = this.get(projectId);
    for (const prog of Object.values(p.programs)) {
      const acc = prog.accounts.find((a) => a.address === address);
      if (acc) {
        acc.label = label;
        return p;
      }
    }
    throw new RelayError(ErrorCode.NOT_FOUND, `account not in project: ${address}`);
  }

  removeProgram(projectId: string, programId: string): Project {
    const p = this.get(projectId);
    if (!p.programs[programId]) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${programId}`);
    }
    delete p.programs[programId];
    return p;
  }

  addAccount(input: AddAccountInput): Project {
    const p = this.get(input.projectId);
    const prog = p.programs[input.programId];
    if (!prog) {
      throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${input.programId}`);
    }
    if (prog.accounts.some((a) => a.address === input.address)) {
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `account already under program: ${input.address}`,
      );
    }
    prog.accounts.push({
      address: input.address,
      label: input.label ?? input.address,
      blobHash: input.blobHash,
      clonedAtSlot: input.clonedAtSlot ?? null,
      source: input.source ?? 'cloned',
    });
    return p;
  }

  removeAccount(projectId: string, address: string): Project {
    const p = this.get(projectId);
    for (const prog of Object.values(p.programs)) {
      const idx = prog.accounts.findIndex((a) => a.address === address);
      if (idx >= 0) {
        prog.accounts.splice(idx, 1);
        return p;
      }
    }
    throw new RelayError(ErrorCode.NOT_FOUND, `account not in project: ${address}`);
  }

  setLastSessions(projectId: string, sessionIds: string[]): void {
    const p = this.get(projectId);
    p.sessionIds = sessionIds;
  }

  exportAll(): Project[] {
    return Array.from(this.projects.values());
  }

  loadAll(projects: Project[]): void {
    this.projects.clear();
    for (const p of projects) {
      // Backfill fields added in newer versions
      if (!Array.isArray((p as { txTemplates?: unknown }).txTemplates)) {
        (p as { txTemplates: unknown[] }).txTemplates = [];
      }
      if (!Array.isArray((p as { workflows?: unknown }).workflows)) {
        (p as { workflows: unknown[] }).workflows = [];
      }
      if (!Array.isArray((p as { testSuites?: unknown }).testSuites)) {
        (p as { testSuites: unknown[] }).testSuites = [];
      }
      if (!Array.isArray((p as { folders?: unknown }).folders)) {
        (p as { folders: unknown[] }).folders = [];
      }
      // Synthesize multi-version layout for legacy single-version programs
      // that bypassed the per-entity sink upgrade (e.g. project created via
      // direct ProjectStore.addProgram before the multi-version shipped).
      for (const prog of Object.values(p.programs)) {
        if (!Array.isArray((prog as { versions?: unknown }).versions) || prog.versions.length === 0) {
          const v1: ProgramVersion = {
            id: randomUUID(),
            label: 'v1',
            elfBlobHash: prog.elfBlobHash,
            source: prog.source,
            idlId: (prog as { idlId?: string | null }).idlId ?? null,
            createdAt: Date.now(),
          };
          prog.versions = [v1];
          prog.activeVersionId = v1.id;
        } else if (!prog.activeVersionId || !prog.versions.some((v) => v.id === prog.activeVersionId)) {
          prog.activeVersionId = prog.versions[0]!.id;
        }
      }
      this.projects.set(p.id, p);
    }
  }

  private toMeta(p: Project): ProjectMeta {
    const programCount = Object.keys(p.programs).length;
    return {
      id: p.id,
      name: p.name,
      network: p.network,
      programCount,
      sessionCount: p.sessionIds.length,
      createdAt: p.createdAt,
      lastOpenedAt: p.lastOpenedAt,
      pinned: p.pinned,
    };
  }
}
