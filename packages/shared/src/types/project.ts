import type { Patch } from './patch.js';
import type { Base58String, NetworkId, Uuid } from './primitives.js';
import type { ProgramEntry } from './program.js';

export interface ScriptEntry {
  id: Uuid;
  name: string;
  source: string;
  updatedAt: number;
}

export interface TxTemplateInstruction {
  programId: Base58String;
  programLabel: string;
  instructionName: string;
  summary: string;
  accounts: Array<{ pubkey: Base58String; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

export interface TxTemplate {
  id: Uuid;
  name: string;
  description: string;
  ixs: TxTemplateInstruction[];
  computeUnitLimit: number | null;
  airdropLamports: string | null;
  createdAt: number;
  updatedAt: number;
  /** Optional parent folder id. Null/undefined → root. */
  folderId?: Uuid | null;
}

/**
 * Folder for grouping sidebar items by section. Items reference a folder
 * via their own `folderId` field; the folder tree itself is a flat list
 * with optional `parentId` to nest folders.
 */
export type FolderSection = 'programs' | 'templates' | 'workflows' | 'testSuites' | 'patches';

export interface TreeFolder {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
  section: FolderSection;
  createdAt: number;
}

export type WorkflowStep =
  | {
      kind: 'tx';
      id: Uuid;
      name: string;
      ixs: TxTemplateInstruction[];
      computeUnitLimit?: number | null;
      airdropPayerLamports?: string | null;
      payerKeypairId?: Uuid | null;
      additionalSignerKeypairIds?: Uuid[];
      templateId?: Uuid | null;
      /**
       * Pin specific program versions for the duration of this step. Keys are
       * programIds, values are versionIds. Restored after the step regardless
       * of success/fail. Use to drive forward/backward compat tests across
       * workflow chains.
       */
      programVersionOverrides?: Record<Base58String, Uuid>;
    }
  | { kind: 'airdrop'; id: Uuid; name: string; pubkey: Base58String; lamports: string }
  | { kind: 'warpTime'; id: Uuid; name: string; seconds: number }
  | { kind: 'warpSlot'; id: Uuid; name: string; slot: string }
  | { kind: 'expireBlockhash'; id: Uuid; name: string }
  | { kind: 'resetSession'; id: Uuid; name: string }
  // Alias kind — same semantics as `resetSession`. New saves use this; old
  // saves carrying the legacy literal still parse.
  | { kind: 'resetSandbox'; id: Uuid; name: string }
  /**
   * Persistent switch of the session-level program version pin. Unlike the
   * per-tx-step `programVersionOverrides` (which restores after the step),
   * this flips the pin for ALL subsequent steps in the run. `versionId: null`
   * clears the pin (follow project active).
   */
  | {
      kind: 'setProgramVersion';
      id: Uuid;
      name: string;
      programId: Base58String;
      versionId: Uuid | null;
    };

export interface Workflow {
  id: Uuid;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  folderId?: Uuid | null;
}

export interface WorkflowStepResult {
  stepId: Uuid;
  kind: WorkflowStep['kind'];
  name: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  /** For tx steps: TxSendResult-shaped subset. */
  tx?: {
    cuConsumed: string;
    logs: string[];
    errorMessage: string | null;
    success: boolean;
  };
}

export interface WorkflowRunResult {
  workflowId: Uuid;
  sessionId: Uuid;
  startedAt: number;
  completedAt: number;
  success: boolean;
  steps: WorkflowStepResult[];
}

// ───────────────── Testcase / TestSuite ─────────────────
//
// Testcases sit alongside Workflows but never halt on failed tx. Each step
// declares optional expectations; the runner records actual vs expected and
// continues to the next step. Multiple testcases per suite.

export type NumericOp = 'eq' | 'neq' | 'ge' | 'le' | 'gt' | 'lt';

export type TxExpectation =
  | { kind: 'shouldSucceed'; value: boolean }
  | { kind: 'errorMessageContains'; substring: string }
  | { kind: 'logContains'; substring: string }
  | { kind: 'cuRange'; min?: number | null; max?: number | null };

export type AccountExpectation =
  | { kind: 'accountExists'; address: Base58String; exists: boolean }
  | { kind: 'lamports'; address: Base58String; op: NumericOp; value: string }
  | { kind: 'tokenBalance'; ata: Base58String; op: NumericOp; value: string }
  | {
      kind: 'fieldEquals';
      address: Base58String;
      /** Dot path inside decoded account, e.g. "amount" or "data.bumps.0". */
      path: string;
      op: NumericOp;
      /** String form; numeric ops cast to bigint, others string compare. */
      value: string;
    };

export interface TestStepExpectations {
  txExpectations?: TxExpectation[];
  accountExpectations?: AccountExpectation[];
}

export type TestStep = WorkflowStep & TestStepExpectations;

export interface TestCase {
  id: Uuid;
  name: string;
  description: string;
  steps: TestStep[];
  /** Reset session state before running this case (fresh slate). */
  resetBefore?: boolean;
}

export interface TestSuite {
  id: Uuid;
  name: string;
  description: string;
  cases: TestCase[];
  createdAt: number;
  updatedAt: number;
  folderId?: Uuid | null;
}

export interface TestExpectationResult {
  kind: string;
  description: string;
  pass: boolean;
  actual: string | null;
  expected: string;
}

export interface TestStepResult {
  stepId: Uuid;
  kind: WorkflowStep['kind'];
  name: string;
  /** Wall-clock tx outcome; null for non-tx kinds. */
  txOk: boolean | null;
  errorMessage: string | null;
  durationMs: number;
  tx?: {
    cuConsumed: string;
    logs: string[];
    errorMessage: string | null;
    success: boolean;
  };
  expectations: TestExpectationResult[];
  pass: boolean;
}

export interface TestCaseResult {
  caseId: Uuid;
  name: string;
  startedAt: number;
  completedAt: number;
  pass: boolean;
  steps: TestStepResult[];
}

export interface TestSuiteRunResult {
  suiteId: Uuid | null;
  sessionId: Uuid;
  startedAt: number;
  completedAt: number;
  pass: boolean;
  cases: TestCaseResult[];
}

export interface Project {
  id: Uuid;
  name: string;
  description: string;
  network: NetworkId;
  rpcEndpointId: Uuid;
  programs: Record<Base58String, ProgramEntry>;
  patches: Patch[];
  sessionIds: Uuid[];
  keypairRefs: Uuid[];
  scripts: ScriptEntry[];
  txTemplates: TxTemplate[];
  workflows: Workflow[];
  testSuites: TestSuite[];
  /**
   * Optional folder tree for grouping sidebar items. Items reference their
   * folder via their own `folderId`. Items without a folderId render at the
   * root of their section. Schema-backwards-compat: undefined → no folders.
   */
  folders?: TreeFolder[];
  /**
   * When true, missing accounts referenced by an incoming tx are auto-cloned
   * from the project RPC before the tx executes. Defaults to true if
   * undefined. Disable for hermetic sandboxes that should fail explicitly on
   * unseen accounts.
   */
  autoCloneEnabled?: boolean;
  createdAt: number;
  lastOpenedAt: number;
  pinned: boolean;
}

export interface ProjectMeta {
  id: Uuid;
  name: string;
  network: NetworkId;
  programCount: number;
  sessionCount: number;
  createdAt: number;
  lastOpenedAt: number;
  pinned: boolean;
}
