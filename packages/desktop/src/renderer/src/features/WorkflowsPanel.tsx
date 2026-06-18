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
  GitBranch,
  Layers,
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

interface BaseStep {
  id: string;
  name: string;
  kind: StepKind;
}

interface TxIxLite {
  programId: string;
  programLabel: string;
  instructionName: string;
  summary: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

type Step =
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

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

interface StepResult {
  stepId: string;
  kind: StepKind;
  name: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  tx?: {
    cuConsumed: string;
    logs: string[];
    errorMessage: string | null;
    success: boolean;
  };
}

interface RunResult {
  workflowId: string | null;
  sessionId: string;
  startedAt: number;
  completedAt: number;
  success: boolean;
  steps: StepResult[];
}

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const defaultStep = (kind: StepKind): Step => {
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

const prettyKind = (k: StepKind): string => {
  switch (k) {
    case 'tx':
      return 'Submit tx';
    case 'airdrop':
      return 'Airdrop SOL';
    case 'warpTime':
      return 'Warp by time';
    case 'warpSlot':
      return 'Warp to slot';
    case 'expireBlockhash':
      return 'Expire blockhash';
    case 'resetSession':
    case 'resetSandbox':
      return 'Reset sandbox';
    case 'setProgramVersion':
      return 'Set program version';
  }
};

/**
 * Compute a human one-liner from the step's filled fields. Used in the
 * collapsed card header so users can scan a long workflow at a glance.
 */
const stepSummary = (step: Step): string => {
  const short = (s: string): string =>
    s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
  switch (step.kind) {
    case 'tx': {
      if (!step.ixs.length) return '(no ixs — pick a template)';
      const first = step.ixs[0];
      const rest = step.ixs.length > 1 ? ` +${step.ixs.length - 1}` : '';
      return `${first?.instructionName ?? '?'} @ ${first?.programLabel ?? '?'}${rest}`;
    }
    case 'airdrop': {
      const sol = Number(step.lamports) / 1e9;
      return `${sol} SOL → ${short(step.pubkey || '?')}`;
    }
    case 'warpTime':
      return `+${step.seconds}s`;
    case 'warpSlot':
      return `slot → ${step.slot}`;
    case 'expireBlockhash':
      return 'force new blockhash';
    case 'resetSession':
    case 'resetSandbox':
      return 'wipe sandbox to baseline';
    case 'setProgramVersion':
      return step.versionId ? `pin ${short(step.programId)} → version` : 'unpin';
  }
};

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

const STEP_KINDS: StepKind[] = [
  'tx',
  'airdrop',
  'warpTime',
  'warpSlot',
  'expireBlockhash',
  // 'resetSandbox' is the canonical new kind; 'resetSession' still parses
  // for old workflow JSON.
  'resetSandbox',
  'setProgramVersion',
];

/** Step kinds grouped by intent. Used by the "+ Add step" menu so newbies
 *  can scan by category instead of staring at a flat row of 7 buttons. */
const STEP_GROUPS: Array<{ label: string; kinds: StepKind[] }> = [
  { label: 'Tx ops', kinds: ['tx', 'airdrop'] },
  { label: 'Time ops', kinds: ['warpTime', 'warpSlot', 'expireBlockhash'] },
  { label: 'Reset ops', kinds: ['resetSandbox'] },
  { label: 'Version ops', kinds: ['setProgramVersion'] },
];

export function WorkflowsPanel({
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
  /** When set, auto-open the matching workflow in the editor view. Null = blank new. */
  pendingOpenId?: string | null | undefined;
  onConsumePending?: () => void;
  /** Back from detail/editor → Automations home. */
  onBackToHome?: () => void;
  /** Push a run result up to App so it surfaces in the bottom console dock. */
  onPushRunRecord?: (rec: {
    kind: 'workflow';
    name: string;
    pass: boolean;
    body: JSX.Element;
    subtitle: string;
  }) => void;
}): JSX.Element {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);
  // Sidebar click opens a read-only detail view first. User must explicitly
  // click Edit to enter the full editor — avoids implicit "started editing"
  // state that's easy to dirty by accident.
  const [viewing, setViewing] = useState<Workflow | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialogs = useDialogs();
  const suggestions = useAddressSuggestions(project);

  const reload = (): void => {
    void api
      .call<Workflow[]>('workflow.list', { projectId: project.id })
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  };
  useEffect(() => {
    reload();
  }, [project.id]);

  // Sidebar click → pendingOpenId. Wait until workflows have loaded, then
  // open the detail/view pane (NOT the editor). User clicks Edit to enter
  // editor mode explicitly.
  useEffect(() => {
    if (pendingOpenId === undefined) return;
    if (pendingOpenId === null) {
      // Blank new — open prompt flow + jump straight to editor since there's
      // nothing to view yet.
      void newWorkflow();
      onConsumePending?.();
      return;
    }
    const wf = workflows.find((w) => w.id === pendingOpenId);
    if (wf) {
      setViewing(wf);
      setEditing(null);
      onConsumePending?.();
    }
    // Otherwise re-fires when workflows updates.
  }, [pendingOpenId, workflows]);

  // Keep viewing pane in sync with sidebar renames + step count updates.
  // Returns the same reference when nothing meaningful changed so React
  // skips the re-render — avoids cascading updates on every workflows refetch.
  useEffect(() => {
    setViewing((prev) => {
      if (!prev) return prev;
      const live = workflows.find((w) => w.id === prev.id);
      if (!live) return null;
      if (live === prev) return prev;
      // Shallow-stable check on the fields the detail view actually renders.
      if (
        live.name === prev.name &&
        live.description === prev.description &&
        live.updatedAt === prev.updatedAt &&
        live.steps.length === prev.steps.length
      ) {
        return prev;
      }
      return live;
    });
  }, [workflows]);

  // External update sync — when the open workflow's name (or other meta)
  // changes via sidebar inline rename, refresh the name field in the editor
  // without clobbering in-progress step edits.
  useEffect(() => {
    setEditing((prev) => {
      if (!prev) return prev;
      const live = workflows.find((w) => w.id === prev.id);
      if (!live) return prev;
      if (live.name === prev.name && live.description === prev.description) return prev;
      return { ...prev, name: live.name, description: live.description };
    });
  }, [workflows]);

  const newWorkflow = async (): Promise<void> => {
    const name = await dialogs.prompt({
      title: 'New workflow',
      label: 'Name',
      placeholder: 'e.g. setup-and-swap',
    });
    if (!name?.trim()) return;
    setEditing({
      id: '',
      name: name.trim(),
      description: '',
      steps: [],
      createdAt: 0,
      updatedAt: 0,
    });
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    setBusy(true);
    try {
      const saved = await api.call<Workflow>('workflow.save', {
        projectId: project.id,
        ...(editing.id && { id: editing.id }),
        name: editing.name,
        description: editing.description,
        steps: editing.steps,
      });
      setEditing(saved);
      reload();
      toast.success('workflow saved');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Delete workflow',
      message: 'Permanently remove this workflow?',
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    await api.call('workflow.delete', { projectId: project.id, id });
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

  const run = async (wf?: Workflow): Promise<void> => {
    let sid = activeSessionId;
    if (!sid) {
      sid = await pickSessionViaModal();
      if (!sid) return;
    }
    const target = wf ?? editing;
    if (!target) return;
    if (target.steps.length === 0) {
      toast.error('workflow has no steps');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await api.call<RunResult>('workflow.run', {
        sessionId: sid,
        ...(target.id && { workflowId: target.id }),
        ...(!target.id && { steps: target.steps }),
      });
      setResult(r);
      if (target.id) recordRun('workflow', target.id);
      onPushRunRecord?.({
        kind: 'workflow',
        name: target.name || '(unnamed)',
        pass: r.success,
        subtitle: `${r.steps.filter((s) => s.success).length}/${r.steps.length} steps · ${r.completedAt - r.startedAt} ms`,
        body: <RunResultView result={r} />,
      });
      if (r.success) {
        toast.success(`workflow done · ${r.steps.length} steps`);
        // Newbie cue: workflows + expectations = test suite. Hint at next step.
        toast.info('Tip: turn this into a Test Suite to assert outcomes & state');
      } else toast.error('workflow halted (see results below)');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <WorkflowEditor
        workflow={editing}
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
        suggestions={suggestions}
      />
    );
  }

  if (viewing) {
    return (
      <WorkflowDetail
        workflow={viewing}
        busy={busy}
        onEdit={() => {
          setEditing(viewing);
          setViewing(null);
        }}
        onRun={() => void run(viewing)}
        onDuplicate={async () => {
          const clone: Workflow = {
            ...viewing,
            id: '',
            name: `${viewing.name} (copy)`,
            steps: viewing.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
            updatedAt: Date.now(),
          };
          setEditing(clone);
          setViewing(null);
        }}
        onDelete={async () => {
          const ok = await dialogs.confirm({
            title: `Delete "${viewing.name}"?`,
            message: 'Permanent. The workflow JSON is removed from disk.',
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
      />
    );
  }

  // No specific workflow open + no editor — bounce back to home so user sees
  // recent runs / CTAs rather than a redundant table. App.tsx routes mount
  // to this panel only on automationsMode='workflow', so this is rare.
  return (
    <div className="entity-detail">
      <Empty
        size="sm"
        title="Pick a workflow"
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
 * Institution-level read-only detail view for a workflow. Shows hero header,
 * KPI tiles, last-run summary banner, and a vertical step timeline. Edits
 * gated behind explicit "Edit" — sidebar click never dirties state.
 */
function WorkflowDetail({
  workflow,
  busy,
  onEdit,
  onRun,
  onDuplicate,
  onDelete,
  onBack,
  result,
}: {
  workflow: Workflow;
  busy: boolean;
  onEdit: () => void;
  onRun: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBack: () => void;
  result: RunResult | null;
}): JSX.Element {
  const totalCu = result
    ? result.steps.reduce((n, s) => n + Number(s.tx?.cuConsumed ?? 0), 0)
    : 0;
  const successCount = result ? result.steps.filter((s) => s.success).length : 0;
  const totalDuration = result
    ? result.steps.reduce((n, s) => n + s.durationMs, 0)
    : 0;

  return (
    <div className="entity-detail">
      {/* ── Breadcrumb + back ────────────────────────────────────────── */}
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
        <span className="entity-detail-crumb">Workflows</span>
        <ChevronRight size={11} aria-hidden className="entity-detail-crumb-sep" />
        <span className="entity-detail-crumb entity-detail-crumb-active">
          {workflow.name || '(unnamed)'}
        </span>
      </div>

      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <Activity size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">{workflow.name || '(unnamed)'}</h1>
              <span className="entity-pill entity-pill-workflow">Workflow</span>
            </div>
            {workflow.description ? (
              <p className="entity-detail-hero-desc">{workflow.description}</p>
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

      {/* ── KPI tiles ────────────────────────────────────────────────── */}
      <div className="entity-detail-kpis">
        <KpiTile
          icon={<Layers size={14} />}
          label="Steps"
          value={String(workflow.steps.length)}
        />
        <KpiTile
          icon={<CheckCircle2 size={14} />}
          label="Last run"
          value={result ? (result.success ? 'Passed' : 'Halted') : '—'}
          tone={result ? (result.success ? 'good' : 'bad') : 'neutral'}
        />
        <KpiTile
          icon={<Timer size={14} />}
          label="Duration"
          value={result ? `${totalDuration} ms` : '—'}
        />
        <KpiTile
          icon={<Activity size={14} />}
          label="Total CU"
          value={result ? totalCu.toLocaleString() : '—'}
        />
      </div>

      {/* ── Last-run banner ──────────────────────────────────────────── */}
      {result && (
        <div className={`entity-runbanner ${result.success ? 'ok' : 'fail'}`}>
          <span className="entity-runbanner-icon" aria-hidden>
            {result.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          </span>
          <div className="entity-runbanner-body">
            <div className="entity-runbanner-title">
              {result.success
                ? 'Last run succeeded'
                : 'Last run halted on a failed step'}
            </div>
            <div className="entity-runbanner-sub">
              {successCount}/{result.steps.length} steps passed · {totalDuration} ms
              · {totalCu.toLocaleString()} CU
            </div>
          </div>
        </div>
      )}

      {/* ── Step timeline ────────────────────────────────────────────── */}
      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Steps</h3>
          <span className="entity-detail-section-meta">
            {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'} · run in order
          </span>
        </div>
        {workflow.steps.length === 0 ? (
          <Empty
            size="sm"
            title="No steps yet"
            description="Open the editor to add steps."
            action={
              <Button variant="primary" size="sm" onClick={onEdit} disabled={busy}>
                <Pencil size={11} aria-hidden /> Edit
              </Button>
            }
          />
        ) : (
          <ol className="entity-timeline">
            {workflow.steps.map((step, idx) => (
              <li key={step.id} className="entity-timeline-row">
                <span className="entity-timeline-rail" aria-hidden>
                  <span className="entity-timeline-dot">{stepIcon(step.kind, 12)}</span>
                </span>
                <div className="entity-timeline-card">
                  <div className="entity-timeline-card-head">
                    <span className="entity-timeline-idx">#{idx + 1}</span>
                    <span className="entity-timeline-kind">{prettyKind(step.kind)}</span>
                    <span className="entity-timeline-name">{step.name}</span>
                  </div>
                  <div className="entity-timeline-card-body">{stepSummary(step)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Footer chips: timestamps ─────────────────────────────────── */}
      <div className="entity-detail-footchips">
        <span className="entity-footchip">
          <Calendar size={11} aria-hidden /> Created{' '}
          {new Date(workflow.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
        </span>
        <span className="entity-footchip">
          <Clock size={11} aria-hidden /> Updated{' '}
          {new Date(workflow.updatedAt).toISOString().slice(0, 19).replace('T', ' ')}
        </span>
      </div>

    </div>
  );
}

/** Single KPI metric tile. Used by both Workflow + Suite detail views. */
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

function WorkflowEditor({
  workflow,
  project,
  busy,
  onChange,
  onSave,
  onCancel,
  onRun,
  suggestions,
}: {
  workflow: Workflow;
  project: Project;
  busy: boolean;
  onChange: (w: Workflow) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onRun: () => void;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
}): JSX.Element {
  const update = (patch: Partial<Workflow>): void => onChange({ ...workflow, ...patch });

  // Per-step collapse state — by default the first step is expanded so the
  // user lands in a working state, every subsequent step is collapsed so
  // long workflows fit on screen.
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (workflow.steps[0]) s.add(workflow.steps[0].id);
    return s;
  });
  const isExpanded = (id: string): boolean => expandedSteps.has(id);
  const toggleExpanded = (id: string): void =>
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addStep = (kind: StepKind): void =>
    update({ steps: [...workflow.steps, defaultStep(kind)] });
  const removeStep = (id: string): void =>
    update({ steps: workflow.steps.filter((s) => s.id !== id) });
  // Clone a step under the source step, generating a fresh id so it can be
  // edited / reordered independently.
  const duplicateStep = (id: string): void => {
    const idx = workflow.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const src = workflow.steps[idx]!;
    const clone = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
    } as Step;
    const next = workflow.steps.slice();
    next.splice(idx + 1, 0, clone);
    update({ steps: next });
  };
  const moveStep = (id: string, dir: -1 | 1): void => {
    const idx = workflow.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= workflow.steps.length) return;
    const next = workflow.steps.slice();
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    update({ steps: next });
  };
  const updateStep = (id: string, patch: Partial<Step>): void => {
    update({
      steps: workflow.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s)),
    });
  };

  const allTemplates = (project.txTemplates ?? []) as Array<{
    id: string;
    name: string;
    ixs: TxIxLite[];
  }>;

  // First-time guide banner — visible inside the New workflow editor until
  // the user dismisses it (persisted). Helps newbies understand the flow
  // before staring at a blank form.
  const isNew = !workflow.id;

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
          <span className="entity-detail-crumb">Workflows</span>
          <ChevronRight size={11} className="entity-detail-crumb-sep" aria-hidden />
          <span className="entity-detail-crumb entity-detail-crumb-active">
            {workflow.id ? 'Edit' : 'New'}
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
          <FirstRunGuide kind="workflow" />
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-editor-name-row">
          <input
            type="text"
            className="entity-editor-name-input"
            value={workflow.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Untitled workflow"
            autoFocus
          />
          <span className="entity-pill entity-pill-workflow">Workflow</span>
        </div>
        <input
          type="text"
          className="entity-editor-desc-input"
          value={workflow.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="What does this workflow do?"
        />
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">
            Steps{' '}
            <span className="entity-editor-count">({workflow.steps.length})</span>
          </h3>
          <span className="entity-detail-section-meta">runs top-to-bottom, halts on fail</span>
        </div>
        <div className="step-add-bar">
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

        {workflow.steps.length === 0 ? (
          <Empty
            size="sm"
            title="No steps yet"
            description="Add a step above. Steps run top-to-bottom in the active sandbox."
          />
        ) : (
          <ul className="step-list">
            {workflow.steps.map((step, idx) => {
              const open = isExpanded(step.id);
              return (
                <li key={step.id} className={`step-card${open ? ' open' : ''}`}>
                  <div className="step-card-head">
                    <IconButton
                      icon={open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      label={open ? 'Collapse step' : 'Expand step'}
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpanded(step.id)}
                    />
                    <span className="step-card-idx">#{idx + 1}</span>
                    <span className={`step-card-icon kind-${step.kind}`} aria-hidden>
                      {stepIcon(step.kind, 12)}
                    </span>
                    <span className="step-card-kind">{prettyKind(step.kind)}</span>
                    {open ? (
                      <input
                        type="text"
                        className="step-card-name-input"
                        value={step.name}
                        onChange={(e) => updateStep(step.id, { name: e.target.value })}
                        placeholder="Step name"
                      />
                    ) : (
                      <div className="step-card-collapsed">
                        <span className="step-card-name">{step.name}</span>
                        <span className="step-card-summary font-mono">
                          {stepSummary(step)}
                        </span>
                      </div>
                    )}
                    <div className="step-card-actions">
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
                        disabled={idx === workflow.steps.length - 1}
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
                  </div>
                  {open && (
                    <div className="step-card-body">
                      <StepForm
                        step={step}
                        templates={allTemplates}
                        onPatch={(patch) => updateStep(step.id, patch)}
                        suggestions={suggestions}
                        project={project}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}

function StepForm({
  step,
  templates,
  onPatch,
  suggestions,
  project,
}: {
  step: Step;
  templates: Array<{ id: string; name: string; ixs: TxIxLite[] }>;
  onPatch: (patch: Partial<Step>) => void;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
  project: Project;
}): JSX.Element {
  if (step.kind === 'airdrop') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
        <Field label="Recipient">
          <AddressInput
            value={step.pubkey}
            onChange={(v) => onPatch({ pubkey: v } as Partial<Step>)}
            suggestions={suggestions}
            placeholder="recipient pubkey"
          />
        </Field>
        <Field label="Lamports">
          <Input
            value={step.lamports}
            onChange={(e) => onPatch({ lamports: e.target.value } as Partial<Step>)}
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
            onPatch({ seconds: Number(e.target.value) || 0 } as Partial<Step>)
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
          onChange={(e) => onPatch({ slot: e.target.value } as Partial<Step>)}
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
    return <SetProgramVersionForm step={step} project={project} onPatch={onPatch} />;
  }

  return <TxStepForm step={step} templates={templates} onPatch={onPatch} project={project} />;
}

function SetProgramVersionForm({
  step,
  project,
  onPatch,
}: {
  step: Step & { kind: 'setProgramVersion' };
  project: Project;
  onPatch: (patch: Partial<Step>) => void;
}): JSX.Element {
  const programs = Object.values(project.programs);
  const selected = step.programId ? project.programs[step.programId] : undefined;
  const versions = selected?.versions ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-2xs text-text-muted">
        Persistently switches the sandbox-level version pin for one program.
        All subsequent steps use the new version until another
        setProgramVersion step. Use V1→V2 then V2→V1 to flip-test upgrade and
        downgrade behavior in one run.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Program">
          <Select
            value={step.programId}
            onChange={(e) =>
              onPatch({
                programId: e.target.value,
                versionId: null,
              } as Partial<Step>)
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
              onPatch({ versionId: e.target.value || null } as Partial<Step>)
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

function TxStepForm({
  step,
  templates,
  onPatch,
  project,
}: {
  step: Step & { kind: 'tx' };
  templates: Array<{ id: string; name: string; ixs: TxIxLite[] }>;
  onPatch: (patch: Partial<Step>) => void;
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

  return (
    <div className="flex flex-col gap-3">
      <div className="text-2xs text-text-muted">
        Pulls instructions from a saved template. Build templates from the Tx Builder tab.
      </div>

      <Field label="Template">
        <div className="flex items-center gap-2">
          <Select
            value={step.templateId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                onPatch({ templateId: null } as Partial<Step>);
                return;
              }
              const tpl = templates.find((t) => t.id === id);
              if (!tpl) return;
              onPatch({ templateId: id, ixs: tpl.ixs } as Partial<Step>);
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
                onPatch({ ixs: tpl.ixs } as Partial<Step>);
              }}
              title="Re-sync ixs from the linked template (in case template was edited)"
            >
              <RefreshCcw size={12} aria-hidden /> Reload
            </Button>
          )}
        </div>
      </Field>

      <Field
        label="Pay fees with"
        help="Sandbox-only signing. Ephemeral payer recommended unless ix requires a specific signer."
      >
        <Select
          value={step.payerKeypairId ?? ''}
          onChange={(e) =>
            onPatch({ payerKeypairId: e.target.value || null } as Partial<Step>)
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
        <Field
          label="Additional signers"
          help="Click to toggle. Required when an ix lists more than one signer account."
        >
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
                      } as Partial<Step>);
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
              } as Partial<Step>)
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
              } as Partial<Step>)
            }
            placeholder="(skip)"
            className="font-mono"
          />
        </Field>
      </div>

      <div className="rounded border border-border bg-bg p-2.5 mt-1">
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

      <ProgramVersionOverridesEditor step={step} project={project} onPatch={onPatch} />
    </div>
  );
}

function ProgramVersionOverridesEditor({
  step,
  project,
  onPatch,
}: {
  step: Step & { kind: 'tx' };
  project: Project;
  onPatch: (patch: Partial<Step>) => void;
}): JSX.Element | null {
  const multiVersionPrograms = Object.values(project.programs).filter(
    (p) => Array.isArray(p.versions) && p.versions.length >= 2,
  );
  if (multiVersionPrograms.length === 0) return null;
  const overrides = step.programVersionOverrides ?? {};
  return (
    <div className="rounded border border-border bg-bg p-2.5 mt-2">
      <div className="text-2xs text-text-subtle mb-1.5">
        Program version pins for this step{' '}
        <Badge size="sm" variant="default">
          {Object.keys(overrides).length}
        </Badge>
      </div>
      <div className="text-2xs text-text-subtle mb-2">
        Optional. Pins the chosen version for the duration of this step only — restored after.
      </div>
      <div className="flex flex-col gap-2">
        {multiVersionPrograms.map((prog) => {
          const current = overrides[prog.programId] ?? '';
          return (
            <div key={prog.programId} className="grid grid-cols-[1fr_180px] gap-2 items-center">
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
                  } as Partial<Step>);
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
  );
}

function RunResultView({ result }: { result: RunResult }): JSX.Element {
  const succeeded = result.steps.filter((s) => s.success).length;
  const failed = result.steps.length - succeeded;
  const totalMs = result.completedAt - result.startedAt;
  const totalCu = result.steps.reduce((n, s) => n + Number(s.tx?.cuConsumed ?? 0), 0);

  return (
    <div className="run-result">
      <div className={`run-result-banner ${result.success ? 'ok' : 'fail'}`}>
        <span className="run-result-banner-icon" aria-hidden>
          {result.success ? (
            <Check size={18} strokeWidth={2.5} />
          ) : (
            <XCircle size={18} strokeWidth={2.5} />
          )}
        </span>
        <div className="run-result-banner-body">
          <div className="run-result-banner-title">
            {result.success ? 'Workflow completed' : 'Workflow halted'}
          </div>
          <div className="run-result-banner-sub">
            {result.success
              ? `All ${result.steps.length} steps passed.`
              : `Halted at step ${succeeded + 1} of ${result.steps.length}.`}
          </div>
        </div>
        <div className="run-result-banner-stats">
          <RunStat label="Passed" value={String(succeeded)} tone="good" />
          <RunStat label="Failed" value={String(failed)} tone={failed > 0 ? 'bad' : 'neutral'} />
          <RunStat label="Duration" value={`${totalMs} ms`} />
          <RunStat label="CU" value={totalCu.toLocaleString()} />
        </div>
      </div>

      <ol className="run-result-steps">
        {result.steps.map((s, i) => (
          <StepResultRow key={s.stepId} index={i + 1} step={s} />
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

function StepResultRow({ index, step }: { index: number; step: StepResult }): JSX.Element {
  const [open, setOpen] = useState(!step.success); // auto-expand failures
  const hasLogs = !!(step.tx && step.tx.logs.length > 0);
  const expandable = hasLogs || !!step.errorMessage;
  return (
    <li className={`run-step${step.success ? '' : ' fail'}${open ? ' open' : ''}`}>
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
        <span className="run-step-stats">
          {step.tx && <span className="run-step-cu font-mono">cu {step.tx.cuConsumed}</span>}
          <span className="run-step-dur font-mono">{step.durationMs.toFixed(1)} ms</span>
        </span>
        <span className={`run-step-status ${step.success ? 'ok' : 'fail'}`}>
          {step.success ? <Check size={12} /> : <XCircle size={12} />}
        </span>
      </button>

      {open && expandable && (
        <div className="run-step-body">
          {step.errorMessage && (
            <div className="run-step-error font-mono">
              <XCircle size={11} aria-hidden /> {step.errorMessage}
            </div>
          )}
          {hasLogs && (
            <pre className="run-step-logs font-mono">{step.tx!.logs.join('\n')}</pre>
          )}
        </div>
      )}
    </li>
  );
}
