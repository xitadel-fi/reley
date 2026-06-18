import { join } from 'node:path';
import { KeypairStore, type SealAdapter } from '../keypair/keypair-store.js';
import { IdlStore } from '../patcher/idl-store.js';
import { BlobStore } from './blob-store.js';
import {
  PatchFolderSink,
  ProgramFolderSink,
  ProjectManifestSink,
  ScriptFolderSink,
  SessionFolderSink,
  TestSuiteFolderSink,
  TxTemplateFolderSink,
  WorkflowFolderSink,
  type ManifestV2,
} from './persistence.js';
import { ProjectStore } from './project-store.js';
import { SessionStore } from './session-store.js';
import type { Project } from './types.js';

export interface CoreContextOptions {
  /**
   * Absolute path to the project root folder (the folder that contains `.relay.json`
   * and a `.relay/` directory). A single CoreContext represents one project.
   */
  projectRoot: string;
  seal?: SealAdapter;
}

export class CoreContext {
  readonly projects: ProjectStore;
  readonly sessions: SessionStore;
  readonly blobs: BlobStore;
  readonly idls: IdlStore;
  readonly keypairs: KeypairStore;
  readonly projectRoot: string;
  private readonly manifestSink: ProjectManifestSink;
  private readonly sessionSink: SessionFolderSink;
  private readonly templateSink: TxTemplateFolderSink;
  private readonly workflowSink: WorkflowFolderSink;
  private readonly testSuiteSink: TestSuiteFolderSink;
  private readonly scriptSink: ScriptFolderSink;
  private readonly patchSink: PatchFolderSink;
  private readonly programSink: ProgramFolderSink;

  constructor(opts: CoreContextOptions) {
    this.projectRoot = opts.projectRoot;
    const relayDir = join(opts.projectRoot, '.relay');
    this.blobs = new BlobStore(join(relayDir, 'blobs'));
    this.idls = new IdlStore(join(relayDir, 'idls'));
    this.keypairs = new KeypairStore(join(relayDir, 'keypairs'), opts.seal);
    this.projects = new ProjectStore();
    this.sessions = new SessionStore();
    this.manifestSink = new ProjectManifestSink(opts.projectRoot);
    this.sessionSink = new SessionFolderSink(join(relayDir, 'sessions'));
    this.templateSink = new TxTemplateFolderSink(join(relayDir, 'tx-templates'));
    this.workflowSink = new WorkflowFolderSink(join(relayDir, 'workflows'));
    this.testSuiteSink = new TestSuiteFolderSink(join(relayDir, 'test-suites'));
    this.scriptSink = new ScriptFolderSink(join(relayDir, 'scripts'));
    this.patchSink = new PatchFolderSink(join(relayDir, 'patches'));
    this.programSink = new ProgramFolderSink(join(relayDir, 'programs'));
  }

  async load(): Promise<void> {
    await this.waitForSavesToSettle();

    const meta = await this.manifestSink.load();
    if (meta) {
      const [templates, workflows, testSuites, scripts, patches, programs] = await Promise.all([
        this.templateSink.loadAll(),
        this.workflowSink.loadAll(),
        this.testSuiteSink.loadAll(),
        this.scriptSink.loadAll(),
        this.patchSink.loadAll(),
        this.programSink.loadAll(),
      ]);
      const project: Project = {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        network: meta.network,
        rpcEndpointId: meta.rpcEndpointId,
        programs: Object.fromEntries(programs.map((p) => [p.programId, p])),
        patches,
        sessionIds: meta.sessionIds,
        keypairRefs: meta.keypairRefs,
        scripts,
        txTemplates: templates,
        workflows,
        testSuites,
        createdAt: meta.createdAt,
        lastOpenedAt: meta.lastOpenedAt,
        pinned: meta.pinned,
      };
      this.projects.loadAll([project]);
    }
    const sessions = await this.sessionSink.loadAll();
    this.sessions.loadAll(sessions);
  }

  private inFlight: Promise<void> | null = null;
  private nextQueued: Promise<void> | null = null;

  private async waitForSavesToSettle(): Promise<void> {
    while (this.inFlight || this.nextQueued) {
      await (this.nextQueued ?? this.inFlight);
    }
  }

  /**
   * Serialize + coalesce saves. Multiple IPC handlers may call `persist()`
   * concurrently; without serialization their write loops race on shared
   * tmp filenames and watcher events fire for every entity twice. When a
   * save is already running, the next arriver enqueues exactly ONE
   * follow-up — every subsequent caller until that follow-up starts
   * running piggybacks on the same promise. So a burst of N IPC calls
   * collapses to at most 2 saves.
   */
  async save(): Promise<void> {
    if (this.nextQueued) return this.nextQueued;
    if (this.inFlight) {
      this.nextQueued = this.inFlight.catch(() => {}).then(() => {
        this.nextQueued = null;
        this.inFlight = this._runSave();
        return this.inFlight;
      });
      return this.nextQueued;
    }
    this.inFlight = this._runSave();
    return this.inFlight;
  }

  private _runSave(): Promise<void> {
    const p = this._saveNow().finally(() => {
      if (this.inFlight === p) this.inFlight = null;
    });
    return p;
  }

  private async _saveNow(): Promise<void> {
    const first = this.projects.exportAll()[0];
    if (first) {
      const meta: ManifestV2 = {
        formatVersion: 0, // sink stamps current version on write
        id: first.id,
        name: first.name,
        description: first.description,
        network: first.network,
        rpcEndpointId: first.rpcEndpointId,
        sessionIds: first.sessionIds,
        keypairRefs: first.keypairRefs,
        createdAt: first.createdAt,
        lastOpenedAt: first.lastOpenedAt,
        pinned: first.pinned,
      };
      await Promise.all([
        this.manifestSink.save(meta),
        this.templateSink.saveAll(first.txTemplates),
        this.workflowSink.saveAll(first.workflows),
        this.testSuiteSink.saveAll(first.testSuites),
        this.scriptSink.saveAll(first.scripts),
        this.patchSink.saveAll(first.patches),
        this.programSink.saveAll(Object.values(first.programs)),
      ]);
    }
    await this.sessionSink.saveAll(this.sessions.exportAll());
  }

  /** Returns the single project's id (this context represents one project). */
  projectId(): string | null {
    const all = this.projects.exportAll();
    return all[0]?.id ?? null;
  }
}
