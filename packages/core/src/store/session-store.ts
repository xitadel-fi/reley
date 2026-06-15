import { randomUUID } from 'node:crypto';
import { ErrorCode, RelayError } from '@relay/shared';
import type { CreateSessionInput, SessionMeta, SessionState } from './types.js';

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  list(projectId?: string): SessionMeta[] {
    return Array.from(this.sessions.values())
      .filter((s) => !projectId || s.projectId === projectId)
      .map((s) => this.toMeta(s));
  }

  get(id: string): SessionState {
    const s = this.sessions.get(id);
    if (!s) throw new RelayError(ErrorCode.NOT_FOUND, `session not found: ${id}`);
    return s;
  }

  create(input: CreateSessionInput): SessionState {
    const session: SessionState = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      currentSlot: 0n,
      accounts: {},
      sessionPatches: [],
      txHistory: [],
      snapshots: [],
      isDefault: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  rename(id: string, name: string): SessionState {
    const s = this.get(id);
    s.name = name;
    return s;
  }

  delete(id: string): void {
    if (!this.sessions.delete(id)) {
      throw new RelayError(ErrorCode.NOT_FOUND, `session not found: ${id}`);
    }
  }

  deleteByProject(projectId: string): void {
    for (const [id, s] of this.sessions) {
      if (s.projectId === projectId) this.sessions.delete(id);
    }
  }

  setDefault(projectId: string, sessionId: string): void {
    for (const s of this.sessions.values()) {
      if (s.projectId === projectId) s.isDefault = s.id === sessionId;
    }
  }

  /**
   * Pin (or clear) a program version override for one session. Passing
   * `versionId: null` removes the override so the session falls back to the
   * project-level active version.
   */
  pinProgramVersion(sessionId: string, programId: string, versionId: string | null): SessionState {
    const s = this.get(sessionId);
    if (!s.programVersionOverrides) s.programVersionOverrides = {};
    if (versionId == null) {
      delete s.programVersionOverrides[programId];
      if (Object.keys(s.programVersionOverrides).length === 0) {
        delete s.programVersionOverrides;
      }
    } else {
      s.programVersionOverrides[programId] = versionId;
    }
    return s;
  }

  reset(id: string): SessionState {
    const s = this.get(id);
    s.accounts = {};
    s.sessionPatches = [];
    s.txHistory = [];
    s.currentSlot = 0n;
    return s;
  }

  exportAll(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  loadAll(sessions: SessionState[]): void {
    this.sessions.clear();
    for (const s of sessions) {
      this.sessions.set(s.id, s);
    }
  }

  private toMeta(s: SessionState): SessionMeta {
    return {
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      isDefault: s.isDefault,
      accountCount: Object.keys(s.accounts).length,
      mutationCount: s.sessionPatches.length + s.txHistory.length,
      createdAt: 0,
      lastUsedAt: 0,
    };
  }
}

export function newPatchId(): string {
  return randomUUID();
}
