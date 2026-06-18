import {
  Activity,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Droplets,
  FlaskConical,
  GitBranch,
  Layers,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  SkipForward,
  Timer,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { AddressInput } from '../components/AddressInput';
import { useDialogs } from '../components/Dialogs';
import { FirstRunGuide } from '../components/FirstRunGuide';
import { recordRun } from './AutomationsHome';
import { useToast } from '../components/Toast';
import { useAddressSuggestions } from '../components/useAddressSuggestions';
import { IxInspectButton } from './IxInspectModal';
import type { Project } from '../types';
import {
  Badge,
  Button,
  Empty,
  Field,
  IconButton,
  Input,
  Select,
  Spinner,
} from '../ui';

type StepKind =
  | 'tx'
  | 'airdrop'
  | 'warpTime'
  | 'warpSlot'
  | 'expireBlockhash'
  | 'resetSession'
  | 'resetSandbox'
  | 'setProgramVersion';
type NumericOp = 'eq' | 'neq' | 'ge' | 'le' | 'gt' | 'lt';

interface TxIxLite {
  programId: string;
  programLabel: string;
  instructionName: string;
  summary: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

type TxExpectation =
  | { kind: 'shouldSucceed'; value: boolean }
  | { kind: 'errorMessageContains'; substring: string }
  | { kind: 'logContains'; substring: string }
  | { kind: 'cuRange'; min?: number | null; max?: number | null };

type AccountExpectation =
  | { kind: 'accountExists'; address: string; exists: boolean }
  | { kind: 'lamports'; address: string; op: NumericOp; value: string }
  | { kind: 'tokenBalance'; ata: string; op: NumericOp; value: string }
  | { kind: 'fieldEquals'; address: string; path: string; op: NumericOp; value: string };

interface StepExpectations {
  txExpectations?: TxExpectation[];
  accountExpectations?: AccountExpectation[];
}

interface BaseStep extends StepExpectations {
  id: string;
  name: string;
  kind: StepKind;
}

type TestStep =
  | (BaseStep & {
      kind: 'tx';
      ixs: TxIxLite[];
      computeUnitLimit?: number | null;
      airdropPayerLamports?: string | null;
      payerKeypairId?: string | null;
      additionalSignerKeypairIds?: string[];
      templateId?: string | null;
      programVersionOverrides?: Record<string, string>;
    })
  | (BaseStep & { kind: 'airdrop'; pubkey: string; lamports: string })
  | (BaseStep & { kind: 'warpTime'; seconds: number })
  | (BaseStep & { kind: 'warpSlot'; slot: string })
  | (BaseStep & { kind: 'expireBlockhash' })
  | (BaseStep & { kind: 'resetSession' })
  | (BaseStep & { kind: 'resetSandbox' })
  | (BaseStep & {
      kind: 'setProgramVersion';
      programId: string;
      versionId: string | null;
    });

interface TestCase {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  resetBefore?: boolean;
}

interface TestSuite {
  id: string;
  name: string;
  description: string;
  cases: TestCase[];
  createdAt: number;
  updatedAt: number;
}

interface ExpectationResult {
  kind: string;
  description: string;
  pass: boolean;
  actual: string | null;
  expected: string;
}

interface StepResult {
  stepId: string;
  kind: StepKind;
  name: string;
  txOk: boolean | null;
  errorMessage: string | null;
  durationMs: number;
  tx?: { cuConsumed: string; logs: string[]; errorMessage: string | null; success: boolean };
  expectations: ExpectationResult[];
  pass: boolean;
}

interface CaseResult {
  caseId: string;
  name: string;
  startedAt: number;
  completedAt: number;
  pass: boolean;
  steps: StepResult[];
}

interface RunResult {
  suiteId: string | null;
  sessionId: string;
  startedAt: number;
  completedAt: number;
  pass: boolean;
  cases: CaseResult[];
}

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const STEP_KINDS: StepKind[] = [
  'tx',
  'airdrop',
  'warpTime',
  'warpSlot',
  'expireBlockhash',
  'resetSandbox',
  'setProgramVersion',
];

/** Step kinds grouped by intent. Used by the "+ Add step" menu so newbies
 *  can scan by category. Mirrors WorkflowsPanel.STEP_GROUPS. */
const STEP_GROUPS: Array<{ label: string; kinds: StepKind[] }> = [
  { label: 'Tx ops', kinds: ['tx', 'airdrop'] },
  { label: 'Time ops', kinds: ['warpTime', 'warpSlot', 'expireBlockhash'] },
  { label: 'Reset ops', kinds: ['resetSandbox'] },
  { label: 'Version ops', kinds: ['setProgramVersion'] },
];

const NUMERIC_OPS: NumericOp[] = ['eq', 'neq', 'ge', 'le', 'gt', 'lt'];

const prettyKind = (k: StepKind): string =>
  ({
    tx: 'Submit tx',
    airdrop: 'Airdrop SOL',
    warpTime: 'Warp by time',
    warpSlot: 'Warp to slot',
    expireBlockhash: 'Expire blockhash',
    resetSession: 'Reset sandbox',
    resetSandbox: 'Reset sandbox',
    setProgramVersion: 'Set program version',
  })[k];

const stepIcon = (k: StepKind, size = 13): ReactNode => {
  switch (k) {
    case 'tx':
      return <Send size={size} aria-hidden />;
    case 'airdrop':
      return <Droplets size={size} aria-hidden />;
    case 'warpTime':
      return <Clock size={size} aria-hidden />;
    case 'warpSlot':
      return <SkipForward size={size} aria-hidden />;
    case 'expireBlockhash':
      return <RefreshCcw size={size} aria-hidden />;
    case 'resetSession':
    case 'resetSandbox':
      return <RotateCcw size={size} aria-hidden />;
    case 'setProgramVersion':
      return <GitBranch size={size} aria-hidden />;
  }
};

const defaultStep = (kind: StepKind): TestStep => {
  const base = { id: newId(), name: prettyKind(kind) };
  switch (kind) {
    case 'tx':
      return {
        ...base,
        kind,
        ixs: [],
        computeUnitLimit: null,
        airdropPayerLamports: null,
        payerKeypairId: null,
        templateId: null,
      };
    case 'airdrop':
      return { ...base, kind, pubkey: '', lamports: '1000000000' };
    case 'warpTime':
      return { ...base, kind, seconds: 60 };
    case 'warpSlot':
      return { ...base, kind, slot: '0' };
    case 'expireBlockhash':
      return { ...base, kind };
    case 'resetSession':
    case 'resetSandbox':
      return { ...base, kind };
    case 'setProgramVersion':
      return { ...base, kind, programId: '', versionId: null };
  }
};

const defaultCase = (): TestCase => ({
  id: newId(),
  name: 'New testcase',
  description: '',
  steps: [],
});

export function TestsPanel({
  project,
  activeSessionId,
  onSelectSession,
  onOpenHelp,
  pendingOpenId,
  onConsumePending,
  onBackToHome,
  onPushRunRecord,
}: {
  project: Project;
  activeSessionId: string | null;
  onSelectSession?: (id: string) => void;
  onOpenHelp?: (skillId: string) => void;
  /** Auto-open the matching test suite in the editor. Null = blank new. */
  pendingOpenId?: string | null | undefined;
  onConsumePending?: () => void;
  /** Back from detail/editor → Automations home. */
  onBackToHome?: () => void;
  /** Push a run result up to App so it surfaces in the bottom console dock. */
  onPushRunRecord?: (rec: {
    kind: 'testSuite';
    name: string;
    pass: boolean;
    body: JSX.Element;
    subtitle: string;
  }) => void;
}): JSX.Element {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [editing, setEditing] = useState<TestSuite | null>(null);
  // Sidebar click opens a read-only detail pane; editor only opens when the
  // user clicks Edit. Matches WorkflowsPanel pattern — no implicit dirty state.
  const [viewing, setViewing] = useState<TestSuite | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [ranIxs, setRanIxs] = useState<Map<string, TxIxLite[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialogs = useDialogs();
  const suggestions = useAddressSuggestions(project);

  const reload = (): void => {
    void api
      .call<TestSuite[]>('testSuite.list', { projectId: project.id })
      .then(setSuites)
      .catch(() => setSuites([]));
  };
  useEffect(() => {
    reload();
  }, [project.id]);

  // Sidebar click → open detail view (not editor). Blank new (null) still
  // jumps straight to editor since there's nothing to view yet.
  useEffect(() => {
    if (pendingOpenId === undefined) return;
    if (pendingOpenId === null) {
      void newSuite();
      onConsumePending?.();
      return;
    }
    const s = suites.find((x) => x.id === pendingOpenId);
    if (s) {
      setViewing(s);
      setEditing(null);
      onConsumePending?.();
    }
  }, [pendingOpenId, suites]);

  // Keep viewing pane in sync. Returns prev reference when nothing meaningful
  // changed so React skips re-render (avoids cascading updates).
  useEffect(() => {
    setViewing((prev) => {
      if (!prev) return prev;
      const live = suites.find((s) => s.id === prev.id);
      if (!live) return null;
      if (live === prev) return prev;
      if (
        live.name === prev.name &&
        live.description === prev.description &&
        live.updatedAt === prev.updatedAt &&
        live.cases.length === prev.cases.length
      ) {
        return prev;
      }
      return live;
    });
  }, [suites]);

  // External rename sync — keep editor's name/description in sync with the
  // sidebar after an inline rename. Cases stay user-driven.
  useEffect(() => {
    setEditing((prev) => {
      if (!prev) return prev;
      const live = suites.find((s) => s.id === prev.id);
      if (!live) return prev;
      if (live.name === prev.name && live.description === prev.description) return prev;
      return { ...prev, name: live.name, description: live.description };
    });
  }, [suites]);

  const newSuite = async (): Promise<void> => {
    const name = await dialogs.prompt({
      title: 'New test suite',
      label: 'Name',
      placeholder: 'e.g. init-and-deposit-suite',
    });
    if (!name?.trim()) return;
    setEditing({
      id: '',
      name: name.trim(),
      description: '',
      cases: [defaultCase()],
      createdAt: 0,
      updatedAt: 0,
    });
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    setBusy(true);
    try {
      const saved = await api.call<TestSuite>('testSuite.save', {
        projectId: project.id,
        ...(editing.id && { id: editing.id }),
        name: editing.name,
        description: editing.description,
        cases: editing.cases,
      });
      setEditing(saved);
      reload();
      toast.success('test suite saved');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Delete test suite',
      message: 'Permanently remove this test suite?',
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    await api.call('testSuite.delete', { projectId: project.id, id });
    reload();
    if (editing?.id === id) setEditing(null);
  };

  const pickSessionViaModal = async (): Promise<string | null> => {
    let sessions: Array<{ id: string; name: string; isDefault: boolean; accountCount: number }> =
      [];
    try {
      sessions = await api.call('session.list', { projectId: project.id });
    } catch (e) {
      toast.error(String(e));
      return null;
    }
    const id = await dialogs.pickFromList({
      title: 'Select sandbox',
      message: 'Pick which sandbox to run against.',
      items: sessions.map((s) => ({
        id: s.id,
        label: s.name + (s.isDefault ? ' (default)' : ''),
        hint: `${s.accountCount} accounts`,
      })),
      emptyMessage: 'No sandboxes in this project. Create one from the sidebar.',
      confirmText: 'Run',
    });
    if (id) onSelectSession?.(id);
    return id;
  };

  const run = async (suite?: TestSuite): Promise<void> => {
    let sid = activeSessionId;
    if (!sid) {
      sid = await pickSessionViaModal();
      if (!sid) return;
    }
    const target = suite ?? editing;
    if (!target) return;
    if (target.cases.length === 0) {
      toast.error('suite has no testcases');
      return;
    }
    setBusy(true);
    setResult(null);
    // Build stepId → ixs map so result rows can render Inspect buttons.
    const ixMap = new Map<string, TxIxLite[]>();
    for (const c of target.cases) {
      for (const s of c.steps) {
        if (s.kind === 'tx') ixMap.set(s.id, s.ixs);
      }
    }
    setRanIxs(ixMap);
    try {
      const r = await api.call<RunResult>('testSuite.run', {
        sessionId: sid,
        ...(target.id && { suiteId: target.id }),
        ...(!target.id && { cases: target.cases }),
      });
      setResult(r);
      if (target.id) recordRun('testSuite', target.id);
      onPushRunRecord?.({
        kind: 'testSuite',
        name: target.name || '(unnamed)',
        pass: r.pass,
        subtitle: `${r.cases.filter((c) => c.pass).length}/${r.cases.length} cases · ${r.completedAt - r.startedAt} ms`,
        body: <RunResultView result={r} ixByStep={ixMap} project={project} />,
      });
      const passed = r.cases.filter((c) => c.pass).length;
      if (r.pass) toast.success(`all ${r.cases.length} cases passed`);
      else toast.error(`${passed}/${r.cases.length} cases passed (see results)`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <SuiteEditor
        suite={editing}
        project={project}
        busy={busy}
        onChange={setEditing}
        onSave={save}
        onCancel={() => {
          setEditing(null);
          onBackToHome?.();
        }}
        onRun={() => void run()}
        result={result}
        ranIxs={ranIxs}
        suggestions={suggestions}
      />
    );
  }

  if (viewing) {
    return (
      <SuiteDetail
        suite={viewing}
        busy={busy}
        onEdit={() => {
          setEditing(viewing);
          setViewing(null);
        }}
        onRun={() => void run(viewing)}
        onDuplicate={() => {
          const clone: TestSuite = {
            ...viewing,
            id: '',
            name: `${viewing.name} (copy)`,
            cases: viewing.cases.map((c) => ({
              ...c,
              id: crypto.randomUUID(),
              steps: c.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
            })),
            updatedAt: Date.now(),
          };
          setEditing(clone);
          setViewing(null);
        }}
        onDelete={async () => {
          const ok = await dialogs.confirm({
            title: `Delete "${viewing.name}"?`,
            message: 'Permanent. The test suite JSON is removed from disk.',
            danger: true,
            confirmText: 'Delete',
          });
          if (!ok) return;
          await remove(viewing.id);
          setViewing(null);
        }}
        onBack={() => {
          setViewing(null);
          onBackToHome?.();
        }}
        result={result}
        ranIxs={ranIxs}
        project={project}
      />
    );
  }

  // No specific suite open — bounce to home so user sees recent runs / CTAs.
  return (
    <div className="entity-detail">
      <Empty
        size="sm"
        title="Pick a test suite"
        description="Choose one from the sidebar, or go back to recent runs."
        action={
          <Button variant="primary" size="sm" onClick={() => onBackToHome?.()}>
            Back to Automations
          </Button>
        }
      />
    </div>
  );
}

/**
 * Institution-level read-only detail view for a test suite. Hero header +
 * KPI tiles + last-run banner with pass/fail metrics + case cards. Edit gated
 * behind explicit "Edit" button.
 */
function SuiteDetail({
  suite,
  busy,
  onEdit,
  onRun,
  onDuplicate,
  onDelete,
  onBack,
  result,
  ranIxs,
  project,
}: {
  suite: TestSuite;
  busy: boolean;
  onEdit: () => void;
  onRun: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBack: () => void;
  result: RunResult | null;
  ranIxs: Map<string, TxIxLite[]>;
  project: Project;
}): JSX.Element {
  const totalSteps = suite.cases.reduce((n, c) => n + c.steps.length, 0);
  const totalExpectations = suite.cases.reduce(
    (n, c) =>
      n +
      c.steps.reduce(
        (m, s) =>
          m + (s.txExpectations?.length ?? 0) + (s.accountExpectations?.length ?? 0),
        0,
      ),
    0,
  );
  const casePass = result ? result.cases.filter((c) => c.pass).length : 0;
  const totalDuration = result
    ? result.cases.reduce(
        (n, c) => n + c.steps.reduce((m, s) => m + s.durationMs, 0),
        0,
      )
    : 0;
  const passRate =
    result && result.cases.length > 0
      ? Math.round((casePass / result.cases.length) * 100)
      : null;

  return (
    <div className="entity-detail">
      <div className="entity-detail-breadcrumb">
        <IconButton
          icon={<ArrowLeft size={13} />}
          label="Back"
          size="sm"
          variant="ghost"
          onClick={onBack}
        />
        <span className="entity-detail-crumb">Automations</span>
        <ChevronRight size={11} aria-hidden className="entity-detail-crumb-sep" />
        <span className="entity-detail-crumb">Test Suites</span>
        <ChevronRight size={11} aria-hidden className="entity-detail-crumb-sep" />
        <span className="entity-detail-crumb entity-detail-crumb-active">
          {suite.name || '(unnamed)'}
        </span>
      </div>

      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon entity-hero-icon-test" aria-hidden>
            <FlaskConical size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">{suite.name || '(unnamed)'}</h1>
              <span className="entity-pill entity-pill-suite">Test Suite</span>
            </div>
            {suite.description ? (
              <p className="entity-detail-hero-desc">{suite.description}</p>
            ) : (
              <p className="entity-detail-hero-desc entity-detail-hero-desc-muted">
                No description.
              </p>
            )}
          </div>
        </div>

        <div className="entity-detail-hero-actions">
          <Button variant="primary" size="md" onClick={onRun} disabled={busy}>
            <Play size={13} aria-hidden /> Run
          </Button>
          <Button variant="outline" size="md" onClick={onEdit} disabled={busy}>
            <Pencil size={13} aria-hidden /> Edit
          </Button>
          <Button variant="ghost" size="md" onClick={onDuplicate} disabled={busy}>
            <Copy size={13} aria-hidden /> Duplicate
          </Button>
          <Button variant="ghost" size="md" onClick={onDelete} disabled={busy}>
            <Trash2 size={13} aria-hidden />
          </Button>
        </div>
      </div>

      <div className="entity-detail-kpis">
        <KpiTile
          icon={<Layers size={14} />}
          label="Cases"
          value={String(suite.cases.length)}
        />
        <KpiTile
          icon={<Activity size={14} />}
          label="Steps"
          value={String(totalSteps)}
        />
        <KpiTile
          icon={<ListChecks size={14} />}
          label="Expectations"
          value={String(totalExpectations)}
        />
        <KpiTile
          icon={<CheckCircle2 size={14} />}
          label="Last run"
          value={passRate === null ? '—' : `${passRate}% pass`}
          tone={passRate === null ? 'neutral' : passRate === 100 ? 'good' : 'bad'}
        />
      </div>

      {result && (
        <div
          className={`entity-runbanner ${
            result.cases.every((c) => c.pass) ? 'ok' : 'fail'
          }`}
        >
          <span className="entity-runbanner-icon" aria-hidden>
            {result.cases.every((c) => c.pass) ? (
              <CheckCircle2 size={16} />
            ) : (
              <XCircle size={16} />
            )}
          </span>
          <div className="entity-runbanner-body">
            <div className="entity-runbanner-title">
              {casePass}/{result.cases.length} case{result.cases.length === 1 ? '' : 's'}{' '}
              {result.cases.every((c) => c.pass) ? 'passed' : 'with failures'}
            </div>
            <div className="entity-runbanner-sub">
              {totalDuration} ms · ran at{' '}
              {new Date(result.startedAt).toISOString().slice(11, 19)} UTC
            </div>
          </div>
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Cases</h3>
          <span className="entity-detail-section-meta">
            {suite.cases.length} case{suite.cases.length === 1 ? '' : 's'} · never halts
            on fail
          </span>
        </div>
        {suite.cases.length === 0 ? (
          <Empty
            size="sm"
            title="No cases yet"
            description="Open the editor to add a test case."
            action={
              <Button variant="primary" size="sm" onClick={onEdit} disabled={busy}>
                <Pencil size={11} aria-hidden /> Edit
              </Button>
            }
          />
        ) : (
          <ol className="entity-case-grid">
            {suite.cases.map((c, idx) => {
              const caseResult = result?.cases.find((cr) => cr.caseId === c.id);
              const expCount = c.steps.reduce(
                (n, s) =>
                  n +
                  (s.txExpectations?.length ?? 0) +
                  (s.accountExpectations?.length ?? 0),
                0,
              );
              return (
                <li key={c.id} className="entity-case-card">
                  <div className="entity-case-card-head">
                    <span className="entity-case-idx">#{idx + 1}</span>
                    <span className="entity-case-name">{c.name || '(unnamed)'}</span>
                    {caseResult ? (
                      <span
                        className={`entity-case-status ${caseResult.pass ? 'ok' : 'fail'}`}
                      >
                        {caseResult.pass ? (
                          <CheckCircle2 size={11} aria-hidden />
                        ) : (
                          <XCircle size={11} aria-hidden />
                        )}
                        {caseResult.pass ? 'pass' : 'fail'}
                      </span>
                    ) : null}
                  </div>
                  {c.description && (
                    <p className="entity-case-desc">{c.description}</p>
                  )}
                  <div className="entity-case-meta">
                    <span>
                      <Activity size={10} aria-hidden /> {c.steps.length} step
                      {c.steps.length === 1 ? '' : 's'}
                    </span>
                    <span>
                      <ListChecks size={10} aria-hidden /> {expCount} expectation
                      {expCount === 1 ? '' : 's'}
                    </span>
                    {c.resetBefore && (
                      <span>
                        <RotateCcw size={10} aria-hidden /> reset before
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="entity-detail-footchips">
        <span className="entity-footchip">
          <Calendar size={11} aria-hidden /> Created{' '}
          {new Date(suite.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
        </span>
        <span className="entity-footchip">
          <Clock size={11} aria-hidden /> Updated{' '}
          {new Date(suite.updatedAt).toISOString().slice(0, 19).replace('T', ' ')}
        </span>
      </div>

    </div>
  );
}

/** Single KPI metric tile. Mirrors the WorkflowsPanel variant. */
function KpiTile({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad';
}): JSX.Element {
  return (
    <div className={`entity-kpi tone-${tone}`}>
      <div className="entity-kpi-head">
        <span className="entity-kpi-icon" aria-hidden>
          {icon}
        </span>
        <span className="entity-kpi-label">{label}</span>
      </div>
      <div className="entity-kpi-value">{value}</div>
    </div>
  );
}

function SuiteEditor({
  suite,
  project,
  busy,
  onChange,
  onSave,
  onCancel,
  onRun,
  result,
  ranIxs,
  suggestions,
}: {
  suite: TestSuite;
  project: Project;
  busy: boolean;
  onChange: (s: TestSuite) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onRun: () => void;
  result: RunResult | null;
  ranIxs: Map<string, TxIxLite[]>;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
}): JSX.Element {
  const update = (patch: Partial<TestSuite>): void => onChange({ ...suite, ...patch });
  const addCase = (): void => update({ cases: [...suite.cases, defaultCase()] });
  const removeCase = (id: string): void =>
    update({ cases: suite.cases.filter((c) => c.id !== id) });
  const updateCase = (id: string, patch: Partial<TestCase>): void => {
    update({ cases: suite.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const isNew = !suite.id;

  return (
    <div className="entity-detail entity-editor">
      <div className="entity-editor-toolbar">
        <div className="entity-editor-toolbar-left">
          <IconButton
            icon={<ArrowLeft size={13} />}
            label="Back"
            size="sm"
            variant="ghost"
            onClick={onCancel}
          />
          <span className="entity-detail-crumb">Test Suites</span>
          <ChevronRight size={11} className="entity-detail-crumb-sep" aria-hidden />
          <span className="entity-detail-crumb entity-detail-crumb-active">
            {suite.id ? 'Edit' : 'New'}
          </span>
        </div>
        <div className="entity-editor-toolbar-right">
          <Button variant="outline" size="sm" onClick={onRun} disabled={busy}>
            <Play size={12} aria-hidden /> Run
          </Button>
          <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={busy}>
            {busy ? (
              <>
                <Spinner size={12} /> Saving
              </>
            ) : (
              <>
                <Save size={12} aria-hidden /> Save
              </>
            )}
          </Button>
        </div>
      </div>

      {isNew && (
        <div className="entity-detail-section">
          <FirstRunGuide kind="testSuite" />
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-editor-name-row">
          <input
            type="text"
            className="entity-editor-name-input"
            value={suite.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Untitled test suite"
            autoFocus
          />
          <span className="entity-pill entity-pill-suite">Test Suite</span>
        </div>
        <input
          type="text"
          className="entity-editor-desc-input"
          value={suite.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="What does this test suite verify?"
        />
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">
            Test cases <span className="entity-editor-count">({suite.cases.length})</span>
          </h3>
          <Button variant="ghost" size="xs" onClick={addCase}>
            <Plus size={11} aria-hidden /> Add case
          </Button>
        </div>
        {suite.cases.length === 0 ? (
          <Empty
            size="sm"
            title="No test cases yet"
            description="Add a case to assert behavior."
            action={
              <Button variant="primary" size="sm" onClick={addCase}>
                <Plus size={12} aria-hidden /> Add case
              </Button>
            }
          />
        ) : (
          <SuiteCases
            cases={suite.cases}
            project={project}
            suggestions={suggestions}
            onPatch={updateCase}
            onRemove={removeCase}
            lastResult={result}
          />
        )}
      </div>

    </div>
  );
}

function SuiteCases({
  cases,
  project,
  suggestions,
  onPatch,
  onRemove,
  lastResult,
}: {
  cases: TestCase[];
  project: Project;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  onPatch: (id: string, patch: Partial<TestCase>) => void;
  onRemove: (id: string) => void;
  lastResult: RunResult | null;
}): JSX.Element {
  const [activeId, setActiveId] = useState<string>(cases[0]?.id ?? '');
  // If active case got deleted, fall back to first remaining.
  useEffect(() => {
    if (!cases.some((c) => c.id === activeId) && cases[0]) setActiveId(cases[0].id);
  }, [cases, activeId]);

  // Per-case pass/fail badge from the last run (if any).
  const caseStatus = (id: string): 'pass' | 'fail' | null => {
    const r = lastResult?.cases.find((c) => c.caseId === id);
    if (!r) return null;
    return r.pass ? 'pass' : 'fail';
  };

  const activeIdx = cases.findIndex((c) => c.id === activeId);
  const active = cases[activeIdx >= 0 ? activeIdx : 0];

  return (
    <div className="flex flex-col gap-3">
      {/* Horizontal tab strip — one chip per case, click to switch. */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2 -mx-1 px-1">
        {cases.map((tc, idx) => {
          const isActive = tc.id === activeId;
          const status = caseStatus(tc.id);
          return (
            <button
              key={tc.id}
              type="button"
              onClick={() => setActiveId(tc.id)}
              className={[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
                isActive
                  ? 'bg-accent/15 text-accent border border-accent/40'
                  : 'bg-surface-0 text-text-muted border border-border hover:text-text hover:bg-surface-1',
              ].join(' ')}
              title={tc.description || tc.name}
            >
              <span className="font-mono text-text-subtle">#{idx + 1}</span>
              <span className="truncate max-w-[160px]">{tc.name}</span>
              {status === 'pass' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" aria-label="pass" />
              )}
              {status === 'fail' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger" aria-label="fail" />
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <CaseEditor
          key={active.id}
          index={activeIdx}
          testCase={active}
          project={project}
          suggestions={suggestions}
          onPatch={(patch) => onPatch(active.id, patch)}
          onRemove={() => onRemove(active.id)}
        />
      )}
    </div>
  );
}

function CaseEditor({
  index,
  testCase,
  project,
  suggestions,
  onPatch,
  onRemove,
}: {
  index: number;
  testCase: TestCase;
  project: Project;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  onPatch: (patch: Partial<TestCase>) => void;
  onRemove: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const addStep = (kind: StepKind): void =>
    onPatch({ steps: [...testCase.steps, defaultStep(kind)] });
  const removeStep = (id: string): void =>
    onPatch({ steps: testCase.steps.filter((s) => s.id !== id) });
  // Clone a step under the source step, generating a fresh id so it can be
  // edited / reordered independently.
  const duplicateStep = (id: string): void => {
    const idx = testCase.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const src = testCase.steps[idx]!;
    const clone = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
    } as TestStep;
    const next = testCase.steps.slice();
    next.splice(idx + 1, 0, clone);
    onPatch({ steps: next });
  };
  const moveStep = (id: string, dir: -1 | 1): void => {
    const i = testCase.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    const t = i + dir;
    if (t < 0 || t >= testCase.steps.length) return;
    const next = testCase.steps.slice();
    const tmp = next[i]!;
    next[i] = next[t]!;
    next[t] = tmp;
    onPatch({ steps: next });
  };
  const updateStep = (id: string, patch: Partial<TestStep>): void => {
    onPatch({
      steps: testCase.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as TestStep) : s)),
    });
  };

  const allTemplates = (project.txTemplates ?? []) as Array<{
    id: string;
    name: string;
    ixs: TxIxLite[];
  }>;

  return (
    <li className="rounded-md border border-border bg-surface-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-1/60 border-b border-border">
        <IconButton
          icon={open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          label={open ? 'Collapse' : 'Expand'}
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
        />
        <Badge size="sm" variant="default" className="font-mono">
          #{index + 1}
        </Badge>
        <Badge size="sm" variant="accent">
          {testCase.steps.length} step{testCase.steps.length === 1 ? '' : 's'}
        </Badge>
        <Input
          value={testCase.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          sizeVariant="sm"
          className="flex-1"
        />
        <label
          className="inline-flex items-center gap-1 text-2xs text-text-muted shrink-0 select-none cursor-pointer"
          title="Reset sandbox state before this case (fresh slate)"
        >
          <input
            type="checkbox"
            checked={!!testCase.resetBefore}
            onChange={(e) => onPatch({ resetBefore: e.target.checked || undefined })}
          />
          reset
        </label>
        <IconButton
          icon={<X size={12} />}
          label="Remove case"
          size="sm"
          variant="danger"
          onClick={onRemove}
        />
      </div>

      {open && (
        <div className="px-3 py-3">
          <Field label="Description">
            <Input
              value={testCase.description}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder="What does this case verify?"
              sizeVariant="sm"
            />
          </Field>

          <div className="mt-3 text-2xs text-text-subtle uppercase tracking-wider">
            Steps · runs top to bottom, never halts on fail
          </div>
          <div className="step-add-bar mt-2">
            {STEP_GROUPS.map((g) => (
              <div key={g.label} className="step-add-group">
                <div className="step-add-group-label">{g.label}</div>
                <div className="step-add-group-buttons">
                  {g.kinds.map((k) => (
                    <Button key={k} variant="ghost" size="xs" onClick={() => addStep(k)}>
                      {stepIcon(k, 11)} {prettyKind(k)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {testCase.steps.length === 0 ? (
            <div className="mt-3">
              <Empty size="sm" title="No steps yet" description="Add a step above." />
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {testCase.steps.map((step, idx) => (
                <li
                  key={step.id}
                  className="rounded-md border border-border bg-bg overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2 bg-surface-1/40 border-b border-border">
                    <Badge size="sm" variant="default" className="font-mono">
                      #{idx + 1}
                    </Badge>
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded bg-surface-2 text-text-muted shrink-0"
                      aria-hidden
                    >
                      {stepIcon(step.kind)}
                    </span>
                    <Badge size="sm" variant="accent">
                      {prettyKind(step.kind)}
                    </Badge>
                    <Input
                      value={step.name}
                      onChange={(e) => updateStep(step.id, { name: e.target.value })}
                      sizeVariant="sm"
                      className="flex-1"
                    />
                    <IconButton
                      icon={<ChevronUp size={12} />}
                      label="Move up"
                      size="sm"
                      variant="ghost"
                      disabled={idx === 0}
                      onClick={() => moveStep(step.id, -1)}
                    />
                    <IconButton
                      icon={<ChevronDown size={12} />}
                      label="Move down"
                      size="sm"
                      variant="ghost"
                      disabled={idx === testCase.steps.length - 1}
                      onClick={() => moveStep(step.id, 1)}
                    />
                    <IconButton
                      icon={<Copy size={12} />}
                      label="Duplicate step"
                      size="sm"
                      variant="ghost"
                      onClick={() => duplicateStep(step.id)}
                    />
                    <IconButton
                      icon={<X size={12} />}
                      label="Remove step"
                      size="sm"
                      variant="danger"
                      onClick={() => removeStep(step.id)}
                    />
                  </div>
                  <div className="px-3 py-3 flex flex-col gap-3">
                    <StepBody
                      step={step}
                      templates={allTemplates}
                      onPatch={(patch) => updateStep(step.id, patch)}
                      suggestions={suggestions}
                      project={project}
                    />
                    <ExpectationsEditor
                      step={step}
                      suggestions={suggestions}
                      onPatch={(patch) => updateStep(step.id, patch)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function StepBody({
  step,
  templates,
  onPatch,
  suggestions,
  project,
}: {
  step: TestStep;
  templates: Array<{ id: string; name: string; ixs: TxIxLite[] }>;
  onPatch: (patch: Partial<TestStep>) => void;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  project: Project;
}): JSX.Element {
  if (step.kind === 'airdrop') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
        <Field label="Recipient">
          <AddressInput
            value={step.pubkey}
            onChange={(v) => onPatch({ pubkey: v } as Partial<TestStep>)}
            suggestions={suggestions}
            placeholder="recipient pubkey"
          />
        </Field>
        <Field label="Lamports">
          <Input
            value={step.lamports}
            onChange={(e) => onPatch({ lamports: e.target.value } as Partial<TestStep>)}
            placeholder="lamports"
            className="font-mono"
          />
        </Field>
      </div>
    );
  }
  if (step.kind === 'warpTime') {
    return (
      <Field label="Seconds">
        <Input
          value={String(step.seconds)}
          onChange={(e) =>
            onPatch({ seconds: Number(e.target.value) || 0 } as Partial<TestStep>)
          }
          placeholder="seconds"
          className="font-mono max-w-[200px]"
        />
      </Field>
    );
  }
  if (step.kind === 'warpSlot') {
    return (
      <Field label="Absolute slot">
        <Input
          value={step.slot}
          onChange={(e) => onPatch({ slot: e.target.value } as Partial<TestStep>)}
          placeholder="absolute slot"
          className="font-mono max-w-[260px]"
        />
      </Field>
    );
  }
  if (
    step.kind === 'expireBlockhash' ||
    step.kind === 'resetSession' ||
    step.kind === 'resetSandbox'
  ) {
    return <div className="text-2xs text-text-subtle italic">no parameters</div>;
  }
  if (step.kind === 'setProgramVersion') {
    return <SetProgramVersionBody step={step} project={project} onPatch={onPatch} />;
  }
  return <TxStepBody step={step} templates={templates} onPatch={onPatch} project={project} />;
}

function SetProgramVersionBody({
  step,
  project,
  onPatch,
}: {
  step: TestStep & { kind: 'setProgramVersion' };
  project: Project;
  onPatch: (patch: Partial<TestStep>) => void;
}): JSX.Element {
  const programs = Object.values(project.programs);
  const selected = step.programId ? project.programs[step.programId] : undefined;
  const versions = selected?.versions ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-2xs text-text-muted">
        Switches the sandbox-level program-version pin. Persistent — all
        subsequent tx steps use the new version until another setProgramVersion
        step (or end of run). Use V1 → V2 then V2 → V1 to flip-test upgrade /
        downgrade behavior.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Program">
          <Select
            value={step.programId}
            onChange={(e) =>
              onPatch({
                programId: e.target.value,
                versionId: null,
              } as Partial<TestStep>)
            }
          >
            <option value="">— pick a program —</option>
            {programs.map((p) => (
              <option key={p.programId} value={p.programId}>
                {p.label} · {p.versions.length} versions
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Version to pin">
          <Select
            value={step.versionId ?? ''}
            disabled={!step.programId}
            onChange={(e) =>
              onPatch({ versionId: e.target.value || null } as Partial<TestStep>)
            }
          >
            <option value="">(unpin → follow project active)</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {selected?.activeVersionId === v.id ? ' (project active)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}

function TxStepBody({
  step,
  templates,
  onPatch,
  project,
}: {
  step: TestStep & { kind: 'tx' };
  templates: Array<{ id: string; name: string; ixs: TxIxLite[] }>;
  onPatch: (patch: Partial<TestStep>) => void;
  project: Project;
}): JSX.Element {
  const [keypairs, setKeypairs] = useState<Array<{ id: string; label: string; pubkey: string }>>(
    [],
  );
  useEffect(() => {
    void api
      .call<Array<{ id: string; label: string; pubkey: string }>>('keypair.list')
      .then(setKeypairs)
      .catch(() => setKeypairs([]));
  }, []);

  const multiVersionPrograms = Object.values(project.programs).filter(
    (p) => Array.isArray(p.versions) && p.versions.length >= 2,
  );
  const overrides = step.programVersionOverrides ?? {};

  return (
    <div className="flex flex-col gap-3">
      <Field label="Template">
        <div className="flex items-center gap-2">
          <Select
            value={step.templateId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                onPatch({ templateId: null } as Partial<TestStep>);
                return;
              }
              const tpl = templates.find((t) => t.id === id);
              if (!tpl) return;
              onPatch({ templateId: id, ixs: tpl.ixs } as Partial<TestStep>);
            }}
            className="flex-1"
          >
            <option value="">— pick a template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.ixs.length} ix)
              </option>
            ))}
          </Select>
          {step.templateId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const tpl = templates.find((t) => t.id === step.templateId);
                if (!tpl) return;
                onPatch({ ixs: tpl.ixs } as Partial<TestStep>);
              }}
              title="Re-sync ixs from the linked template"
            >
              <RefreshCcw size={12} aria-hidden /> Reload
            </Button>
          )}
        </div>
      </Field>

      <Field label="Pay fees with">
        <Select
          value={step.payerKeypairId ?? ''}
          onChange={(e) =>
            onPatch({ payerKeypairId: e.target.value || null } as Partial<TestStep>)
          }
        >
          <option value="">— ephemeral (auto-generate + airdrop) —</option>
          {keypairs.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} · {k.pubkey.slice(0, 8)}…
            </option>
          ))}
        </Select>
      </Field>

      {keypairs.length > 0 && (
        <Field label="Additional signers">
          <div className="flex flex-wrap gap-1.5">
            {keypairs
              .filter((k) => k.id !== (step.payerKeypairId ?? ''))
              .map((k) => {
                const current = step.additionalSignerKeypairIds ?? [];
                const checked = current.includes(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => {
                      const next = checked
                        ? current.filter((x) => x !== k.id)
                        : [...current, k.id];
                      onPatch({
                        additionalSignerKeypairIds: next.length > 0 ? next : undefined,
                      } as Partial<TestStep>);
                    }}
                    className={[
                      'inline-flex items-center gap-1 px-2 h-6 rounded-full border text-2xs transition-colors',
                      checked
                        ? 'bg-accent/20 border-accent text-text'
                        : 'bg-surface-0 border-border text-text-muted hover:bg-surface-1 hover:text-text',
                    ].join(' ')}
                    title={k.pubkey}
                  >
                    <span
                      className={[
                        'inline-block w-1.5 h-1.5 rounded-full',
                        checked ? 'bg-accent' : 'bg-text-subtle',
                      ].join(' ')}
                      aria-hidden
                    />
                    {k.label} · {k.pubkey.slice(0, 4)}…{k.pubkey.slice(-4)}
                  </button>
                );
              })}
          </div>
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="CU limit">
          <Input
            value={step.computeUnitLimit ?? ''}
            onChange={(e) =>
              onPatch({
                computeUnitLimit: e.target.value ? Number(e.target.value) : null,
              } as Partial<TestStep>)
            }
            placeholder="(default)"
          />
        </Field>
        <Field label="Payer airdrop (lamports)">
          <Input
            value={step.airdropPayerLamports ?? ''}
            onChange={(e) =>
              onPatch({
                airdropPayerLamports: e.target.value || null,
              } as Partial<TestStep>)
            }
            placeholder="(skip)"
            className="font-mono"
          />
        </Field>
      </div>

      <div className="rounded border border-border bg-bg p-2.5">
        <div className="text-2xs text-text-subtle mb-1.5">
          Linked instructions{' '}
          <Badge size="sm" variant="default">
            {step.ixs.length}
          </Badge>
        </div>
        {step.ixs.length === 0 ? (
          <div className="text-2xs text-text-subtle italic">no ixs — pick a template above</div>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {step.ixs.map((ix, i) => (
              <li key={i} className="text-2xs text-text-muted flex items-center gap-2">
                <span className="font-mono text-text-subtle">{i + 1}.</span>
                <span className="flex-1 min-w-0">
                  <span className="text-accent">{ix.instructionName}</span>{' '}
                  <span className="text-text-subtle">on</span>{' '}
                  <span className="font-mono">{ix.programLabel}</span>{' '}
                  <span className="text-text-subtle">·</span> {ix.summary}
                </span>
                <IxInspectButton ix={ix} project={project} />
              </li>
            ))}
          </ol>
        )}
      </div>

      {multiVersionPrograms.length > 0 && (
        <div className="rounded border border-border bg-bg p-2.5">
          <div className="text-2xs text-text-subtle mb-1.5">
            Program version pins{' '}
            <Badge size="sm" variant="default">
              {Object.keys(overrides).length}
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            {multiVersionPrograms.map((prog) => {
              const current = overrides[prog.programId] ?? '';
              return (
                <div
                  key={prog.programId}
                  className="grid grid-cols-[1fr_180px] gap-2 items-center"
                >
                  <div className="text-2xs text-text-muted truncate">{prog.label}</div>
                  <Select
                    value={current}
                    sizeVariant="sm"
                    onChange={(e) => {
                      const next = { ...overrides };
                      if (e.target.value) next[prog.programId] = e.target.value;
                      else delete next[prog.programId];
                      onPatch({
                        programVersionOverrides:
                          Object.keys(next).length > 0 ? next : undefined,
                      } as Partial<TestStep>);
                    }}
                  >
                    <option value="">(follow sandbox)</option>
                    {prog.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpectationsEditor({
  step,
  suggestions,
  onPatch,
}: {
  step: TestStep;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  onPatch: (patch: Partial<TestStep>) => void;
}): JSX.Element {
  const txExps = step.txExpectations ?? [];
  const accExps = step.accountExpectations ?? [];

  const setTx = (next: TxExpectation[]): void =>
    onPatch({ txExpectations: next.length > 0 ? next : undefined } as Partial<TestStep>);
  const setAcc = (next: AccountExpectation[]): void =>
    onPatch({ accountExpectations: next.length > 0 ? next : undefined } as Partial<TestStep>);

  const addTx = (kind: TxExpectation['kind']): void => {
    let nx: TxExpectation;
    switch (kind) {
      case 'shouldSucceed':
        nx = { kind, value: true };
        break;
      case 'errorMessageContains':
        nx = { kind, substring: '' };
        break;
      case 'logContains':
        nx = { kind, substring: '' };
        break;
      case 'cuRange':
        nx = { kind, min: null, max: null };
        break;
    }
    setTx([...txExps, nx]);
  };

  const addAcc = (kind: AccountExpectation['kind']): void => {
    let nx: AccountExpectation;
    switch (kind) {
      case 'accountExists':
        nx = { kind, address: '', exists: true };
        break;
      case 'lamports':
        nx = { kind, address: '', op: 'ge', value: '0' };
        break;
      case 'tokenBalance':
        nx = { kind, ata: '', op: 'ge', value: '0' };
        break;
      case 'fieldEquals':
        nx = { kind, address: '', path: '', op: 'eq', value: '' };
        break;
    }
    setAcc([...accExps, nx]);
  };

  return (
    <div className="rounded border border-border bg-bg p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs uppercase tracking-wider text-text-subtle inline-flex items-center gap-1">
          <ListChecks size={11} aria-hidden /> Expectations
          <Badge size="sm" variant="default">
            {txExps.length + accExps.length}
          </Badge>
        </div>
      </div>

      {step.kind === 'tx' && (
        <>
          <div className="text-2xs text-text-subtle mb-1">Tx expectations</div>
          <div className="flex flex-wrap gap-1 mb-2">
            <Button variant="ghost" size="xs" onClick={() => addTx('shouldSucceed')}>
              <Plus size={10} /> success/fail
            </Button>
            <Button variant="ghost" size="xs" onClick={() => addTx('errorMessageContains')}>
              <Plus size={10} /> error contains
            </Button>
            <Button variant="ghost" size="xs" onClick={() => addTx('logContains')}>
              <Plus size={10} /> log contains
            </Button>
            <Button variant="ghost" size="xs" onClick={() => addTx('cuRange')}>
              <Plus size={10} /> CU range
            </Button>
          </div>
          {txExps.length > 0 && (
            <ul className="flex flex-col gap-1.5 mb-3">
              {txExps.map((e, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded border border-border bg-surface-0 px-2 py-1.5"
                >
                  <TxExpForm
                    value={e}
                    onChange={(nx) =>
                      setTx(txExps.map((x, j) => (j === i ? nx : x)))
                    }
                  />
                  <IconButton
                    icon={<X size={11} />}
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    onClick={() => setTx(txExps.filter((_, j) => j !== i))}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="text-2xs text-text-subtle mb-1">Account expectations</div>
      <div className="flex flex-wrap gap-1 mb-2">
        <Button variant="ghost" size="xs" onClick={() => addAcc('accountExists')}>
          <Plus size={10} /> exists
        </Button>
        <Button variant="ghost" size="xs" onClick={() => addAcc('lamports')}>
          <Plus size={10} /> lamports
        </Button>
        <Button variant="ghost" size="xs" onClick={() => addAcc('tokenBalance')}>
          <Plus size={10} /> token balance
        </Button>
        <Button variant="ghost" size="xs" onClick={() => addAcc('fieldEquals')}>
          <Plus size={10} /> field
        </Button>
      </div>
      {accExps.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {accExps.map((e, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded border border-border bg-surface-0 px-2 py-1.5"
            >
              <AccExpForm
                value={e}
                suggestions={suggestions}
                onChange={(nx) =>
                  setAcc(accExps.map((x, j) => (j === i ? nx : x)))
                }
              />
              <IconButton
                icon={<X size={11} />}
                label="Remove"
                size="sm"
                variant="ghost"
                onClick={() => setAcc(accExps.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TxExpForm({
  value,
  onChange,
}: {
  value: TxExpectation;
  onChange: (v: TxExpectation) => void;
}): JSX.Element {
  if (value.kind === 'shouldSucceed') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">tx</span>
        <Select
          sizeVariant="sm"
          value={value.value ? 'true' : 'false'}
          onChange={(e) => onChange({ ...value, value: e.target.value === 'true' })}
          className="max-w-[140px]"
        >
          <option value="true">should succeed</option>
          <option value="false">should fail</option>
        </Select>
      </>
    );
  }
  if (value.kind === 'errorMessageContains') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">error/log contains</span>
        <Input
          sizeVariant="sm"
          value={value.substring}
          onChange={(e) => onChange({ ...value, substring: e.target.value })}
          placeholder="e.g. InsufficientFunds"
          className="font-mono flex-1"
        />
      </>
    );
  }
  if (value.kind === 'logContains') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">log contains</span>
        <Input
          sizeVariant="sm"
          value={value.substring}
          onChange={(e) => onChange({ ...value, substring: e.target.value })}
          placeholder="substring"
          className="font-mono flex-1"
        />
      </>
    );
  }
  // cuRange
  return (
    <>
      <span className="text-2xs text-text-muted shrink-0">cu range</span>
      <Input
        sizeVariant="sm"
        value={value.min ?? ''}
        onChange={(e) =>
          onChange({ ...value, min: e.target.value ? Number(e.target.value) : null })
        }
        placeholder="min"
        className="font-mono w-[80px]"
      />
      <span className="text-2xs text-text-subtle">…</span>
      <Input
        sizeVariant="sm"
        value={value.max ?? ''}
        onChange={(e) =>
          onChange({ ...value, max: e.target.value ? Number(e.target.value) : null })
        }
        placeholder="max"
        className="font-mono w-[80px]"
      />
    </>
  );
}

function AccExpForm({
  value,
  suggestions,
  onChange,
}: {
  value: AccountExpectation;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  onChange: (v: AccountExpectation) => void;
}): JSX.Element {
  if (value.kind === 'accountExists') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">account</span>
        <div className="flex-1 min-w-[160px]">
          <AddressInput
            value={value.address}
            onChange={(v) => onChange({ ...value, address: v })}
            suggestions={suggestions}
            placeholder="address"
          />
        </div>
        <Select
          sizeVariant="sm"
          value={value.exists ? 'true' : 'false'}
          onChange={(e) => onChange({ ...value, exists: e.target.value === 'true' })}
          className="max-w-[110px]"
        >
          <option value="true">exists</option>
          <option value="false">missing</option>
        </Select>
      </>
    );
  }
  if (value.kind === 'lamports') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">lamports</span>
        <div className="flex-1 min-w-[160px]">
          <AddressInput
            value={value.address}
            onChange={(v) => onChange({ ...value, address: v })}
            suggestions={suggestions}
            placeholder="address"
          />
        </div>
        <OpSelect value={value.op} onChange={(op) => onChange({ ...value, op })} />
        <Input
          sizeVariant="sm"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder="lamports"
          className="font-mono w-[120px]"
        />
      </>
    );
  }
  if (value.kind === 'tokenBalance') {
    return (
      <>
        <span className="text-2xs text-text-muted shrink-0">token bal</span>
        <div className="flex-1 min-w-[160px]">
          <AddressInput
            value={value.ata}
            onChange={(v) => onChange({ ...value, ata: v })}
            suggestions={suggestions}
            placeholder="ATA address"
          />
        </div>
        <OpSelect value={value.op} onChange={(op) => onChange({ ...value, op })} />
        <Input
          sizeVariant="sm"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder="amount"
          className="font-mono w-[120px]"
        />
      </>
    );
  }
  // fieldEquals
  return (
    <>
      <span className="text-2xs text-text-muted shrink-0">field</span>
      <div className="min-w-[140px] flex-1">
        <AddressInput
          value={value.address}
          onChange={(v) => onChange({ ...value, address: v })}
          suggestions={suggestions}
          placeholder="address"
        />
      </div>
      <Input
        sizeVariant="sm"
        value={value.path}
        onChange={(e) => onChange({ ...value, path: e.target.value })}
        placeholder="path e.g. amount"
        className="font-mono w-[140px]"
      />
      <OpSelect value={value.op} onChange={(op) => onChange({ ...value, op })} />
      <Input
        sizeVariant="sm"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder="value"
        className="font-mono w-[120px]"
      />
    </>
  );
}

function OpSelect({
  value,
  onChange,
}: {
  value: NumericOp;
  onChange: (op: NumericOp) => void;
}): JSX.Element {
  return (
    <Select
      sizeVariant="sm"
      value={value}
      onChange={(e) => onChange(e.target.value as NumericOp)}
      className="max-w-[70px]"
    >
      {NUMERIC_OPS.map((op) => (
        <option key={op} value={op}>
          {op}
        </option>
      ))}
    </Select>
  );
}

function RunResultView({
  result,
  ixByStep,
  project,
}: {
  result: RunResult;
  ixByStep: Map<string, TxIxLite[]>;
  project: Project;
}): JSX.Element {
  const passed = result.cases.filter((c) => c.pass).length;
  const failed = result.cases.length - passed;
  const totalMs = result.completedAt - result.startedAt;
  const totalSteps = result.cases.reduce((n, c) => n + c.steps.length, 0);
  const stepsPassed = result.cases.reduce(
    (n, c) => n + c.steps.filter((s) => s.pass).length,
    0,
  );

  return (
    <div className="run-result">
      <div className={`run-result-banner ${result.pass ? 'ok' : 'fail'}`}>
        <span className="run-result-banner-icon" aria-hidden>
          {result.pass ? (
            <CheckCircle2 size={18} strokeWidth={2.5} />
          ) : (
            <XCircle size={18} strokeWidth={2.5} />
          )}
        </span>
        <div className="run-result-banner-body">
          <div className="run-result-banner-title">
            {result.pass ? 'Test suite passed' : 'Test suite has failures'}
          </div>
          <div className="run-result-banner-sub">
            {passed}/{result.cases.length} cases · {stepsPassed}/{totalSteps} steps
          </div>
        </div>
        <div className="run-result-banner-stats">
          <RunStat label="Cases" value={`${passed}/${result.cases.length}`} tone={failed > 0 ? 'bad' : 'good'} />
          <RunStat label="Steps" value={`${stepsPassed}/${totalSteps}`} />
          <RunStat label="Duration" value={`${totalMs} ms`} />
        </div>
      </div>

      <ol className="run-result-cases">
        {result.cases.map((c, i) => (
          <CaseResultView
            key={c.caseId}
            index={i + 1}
            value={c}
            ixByStep={ixByStep}
            project={project}
          />
        ))}
      </ol>
    </div>
  );
}

function RunStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad';
}): JSX.Element {
  return (
    <div className={`run-stat tone-${tone}`}>
      <span className="run-stat-label">{label}</span>
      <span className="run-stat-value">{value}</span>
    </div>
  );
}

function CaseResultView({
  index,
  value,
  ixByStep,
  project,
}: {
  index: number;
  value: CaseResult;
  ixByStep: Map<string, TxIxLite[]>;
  project: Project;
}): JSX.Element {
  const [open, setOpen] = useState(!value.pass);
  const passed = value.steps.filter((s) => s.pass).length;
  return (
    <li className={`run-case${value.pass ? '' : ' fail'}${open ? ' open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="run-case-head"
      >
        <span className="run-step-chev">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="run-step-idx">#{index}</span>
        <span className="run-case-name">{value.name}</span>
        <span className="run-case-stats font-mono">
          {passed}/{value.steps.length} steps · {value.completedAt - value.startedAt} ms
        </span>
        <span className={`run-step-status ${value.pass ? 'ok' : 'fail'}`}>
          {value.pass ? <Check size={12} /> : <XCircle size={12} />}
        </span>
      </button>
      {open && (
        <ul className="run-case-steps">
          {value.steps.map((s, i) => (
            <StepResultRow
              key={s.stepId}
              index={i + 1}
              step={s}
              ixs={ixByStep.get(s.stepId)}
              project={project}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function StepResultRow({
  index,
  step,
  ixs,
  project,
}: {
  index: number;
  step: StepResult;
  ixs?: TxIxLite[];
  project: Project;
}): JSX.Element {
  const [open, setOpen] = useState(!step.pass);
  const hasLogs = !!(step.tx && step.tx.logs.length > 0);
  const expandable = hasLogs || !!step.errorMessage || step.expectations.length > 0;
  return (
    <li className={`run-step${step.pass ? '' : ' fail'}${open ? ' open' : ''}`}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        className="run-step-head"
      >
        <span className="run-step-chev">
          {expandable ? (
            open ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : (
            <span className="run-step-dot" />
          )}
        </span>
        <span className="run-step-idx">#{index}</span>
        <span className={`run-step-icon kind-${step.kind}`} aria-hidden>
          {stepIcon(step.kind, 11)}
        </span>
        <span className="run-step-kind">{prettyKind(step.kind)}</span>
        <span className="run-step-name">{step.name}</span>
        {step.txOk !== null && (
          <span className={`run-step-tx-pill ${step.txOk ? 'ok' : 'fail'}`}>
            tx {step.txOk ? 'ok' : 'failed'}
          </span>
        )}
        <span className="run-step-stats">
          {step.tx && <span className="run-step-cu font-mono">cu {step.tx.cuConsumed}</span>}
          <span className="run-step-dur font-mono">{step.durationMs.toFixed(1)} ms</span>
        </span>
        <span className={`run-step-status ${step.pass ? 'ok' : 'fail'}`}>
          {step.pass ? <Check size={12} /> : <XCircle size={12} />}
        </span>
      </button>

      {open && expandable && (
        <div className="run-step-body">
          {ixs && ixs.length > 0 && (
            <div className="run-step-ixs">
              <div className="run-step-ixs-label">Instructions sent</div>
              <ol className="run-step-ixs-list">
                {ixs.map((ix, i) => (
                  <li key={i} className="run-step-ix">
                    <span className="run-step-ix-idx font-mono">{i + 1}.</span>
                    <span className="run-step-ix-name">
                      <span className="text-accent">{ix.instructionName}</span>{' '}
                      <span className="text-text-subtle">on</span>{' '}
                      <span className="font-mono">{ix.programLabel}</span>
                    </span>
                    <IxInspectButton ix={ix} project={project} />
                  </li>
                ))}
              </ol>
            </div>
          )}
          {step.errorMessage && (
            <div className="run-step-error font-mono">
              <XCircle size={11} aria-hidden /> {step.errorMessage}
            </div>
          )}
          {step.expectations.length > 0 && (
            <ul className="run-step-exps">
              {step.expectations.map((x, i) => (
                <li key={i} className={`run-step-exp ${x.pass ? 'ok' : 'fail'}`}>
                  <span className="run-step-exp-icon">
                    {x.pass ? <Check size={11} /> : <XCircle size={11} />}
                  </span>
                  <div className="run-step-exp-body">
                    <div className="run-step-exp-desc">{x.description}</div>
                    <div className="run-step-exp-meta font-mono">
                      actual: {x.actual ?? '(null)'} · expected: {x.expected}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasLogs && (
            <pre className="run-step-logs font-mono">{step.tx!.logs.join('\n')}</pre>
          )}
        </div>
      )}
    </li>
  );
}
