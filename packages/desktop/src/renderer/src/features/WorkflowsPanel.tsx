import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Droplets,
  GitBranch,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  SkipForward,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { AddressInput } from '../components/AddressInput';
import { useDialogs } from '../components/Dialogs';
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
      return 'Reset session';
    case 'setProgramVersion':
      return 'Set program version';
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
  'resetSession',
  'setProgramVersion',
];

export function WorkflowsPanel({
  project,
  activeSessionId,
  onSelectSession,
}: {
  project: Project;
  activeSessionId: string | null;
  onSelectSession?: (id: string) => void;
}): JSX.Element {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);
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
      title: 'Select session',
      message: 'Pick which session to run against.',
      items: sessions.map((s) => ({
        id: s.id,
        label: s.name + (s.isDefault ? ' (default)' : ''),
        hint: `${s.accountCount} accounts`,
      })),
      emptyMessage: 'No sessions in this project. Create one from the sidebar.',
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
      if (r.success) toast.success(`workflow done · ${r.steps.length} steps`);
      else toast.error('workflow halted (see results below)');
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
        onCancel={() => setEditing(null)}
        onRun={() => void run()}
        result={result}
        suggestions={suggestions}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="m-0">Workflows</h2>
          <span className="text-2xs text-text-subtle">{workflows.length} saved</span>
        </div>
        <div className="text-xs text-text-muted mb-3">
          A named sequence of steps run against a session — tx submits, airdrops, time warps,
          blockhash expiry, session reset.
        </div>
        <div>
          <Button variant="primary" size="sm" onClick={() => void newWorkflow()}>
            <Plus size={12} aria-hidden /> New workflow
          </Button>
        </div>
        {workflows.length === 0 ? (
          <div className="mt-3">
            <Empty
              size="sm"
              title="No workflows yet"
              description="Create one to chain tx submits, airdrops, warps, and session resets."
            />
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Name</th>
                  <th className="text-left font-medium px-3 py-1.5 w-16">Steps</th>
                  <th className="text-left font-medium px-3 py-1.5">Updated</th>
                  <th className="px-3 py-1.5 w-40" />
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id} className="border-t border-border hover:bg-surface-1/50">
                    <td className="px-3 py-1.5 text-text">{w.name}</td>
                    <td className="px-3 py-1.5 text-text-muted">{w.steps.length}</td>
                    <td className="px-3 py-1.5 font-mono text-2xs text-text-subtle">
                      {new Date(w.updatedAt).toISOString().slice(0, 19)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1 justify-end">
                        <Button variant="outline" size="xs" onClick={() => void run(w)}>
                          <Play size={11} aria-hidden /> Run
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setEditing(w)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="xs" onClick={() => void remove(w.id)}>
                          <Trash2 size={11} aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {result && <RunResultView result={result} />}
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
  result,
  suggestions,
}: {
  workflow: Workflow;
  project: Project;
  busy: boolean;
  onChange: (w: Workflow) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onRun: () => void;
  result: RunResult | null;
  suggestions: import('../components/useAddressSuggestions').AddressSuggestion[];
}): JSX.Element {
  const update = (patch: Partial<Workflow>): void => onChange({ ...workflow, ...patch });
  const addStep = (kind: StepKind): void =>
    update({ steps: [...workflow.steps, defaultStep(kind)] });
  const removeStep = (id: string): void =>
    update({ steps: workflow.steps.filter((s) => s.id !== id) });
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

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <IconButton
              icon={<ArrowLeft size={14} />}
              label="Back"
              size="sm"
              variant="ghost"
              onClick={onCancel}
            />
            <h2 className="m-0">{workflow.id ? 'Edit workflow' : 'New workflow'}</h2>
          </div>
          <div className="flex gap-1.5">
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

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
          <Field label="Name">
            <Input value={workflow.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input
              value={workflow.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What does this workflow do?"
            />
          </Field>
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="m-0">
              Steps <span className="text-text-muted">({workflow.steps.length})</span>
            </h2>
            <div className="flex flex-wrap gap-1">
              {STEP_KINDS.map((k) => (
                <Button key={k} variant="ghost" size="xs" onClick={() => addStep(k)}>
                  {stepIcon(k, 11)} {prettyKind(k)}
                </Button>
              ))}
            </div>
          </div>

          {workflow.steps.length === 0 ? (
            <Empty
              size="sm"
              title="No steps yet"
              description="Add a step above. Steps run top-to-bottom in the active session."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {workflow.steps.map((step, idx) => (
                <li
                  key={step.id}
                  className="rounded-md border border-border bg-surface-0 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2 bg-surface-1/60 border-b border-border">
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
                      disabled={idx === workflow.steps.length - 1}
                      onClick={() => moveStep(step.id, 1)}
                    />
                    <IconButton
                      icon={<X size={12} />}
                      label="Remove step"
                      size="sm"
                      variant="danger"
                      onClick={() => removeStep(step.id)}
                    />
                  </div>
                  <div className="px-3 py-3">
                    <StepForm
                      step={step}
                      templates={allTemplates}
                      onPatch={(patch) => updateStep(step.id, patch)}
                      suggestions={suggestions}
                      project={project}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {result && <RunResultView result={result} />}
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
  if (step.kind === 'expireBlockhash' || step.kind === 'resetSession') {
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
        Persistently switches the session-level version pin for one program.
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
                <option value="">(follow session)</option>
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
  return (
    <div className="panel">
      <header className="flex items-start gap-3 mb-3 flex-wrap">
        <span
          className={[
            'inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0',
            result.success ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
          ].join(' ')}
          aria-hidden
        >
          {result.success ? (
            <Check size={16} strokeWidth={2.5} />
          ) : (
            <XCircle size={16} strokeWidth={2.5} />
          )}
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-md font-semibold">
            Run result ·{' '}
            <span className={result.success ? 'text-success' : 'text-danger'}>
              {result.success ? 'SUCCESS' : 'FAILED'}
            </span>
          </h2>
          <div className="text-xs text-text-muted mt-0.5">
            {succeeded}/{result.steps.length} steps ok ·{' '}
            <span className="font-mono">{result.completedAt - result.startedAt} ms</span> total
          </div>
        </div>
      </header>
      <ul className="rounded-md border border-border overflow-hidden">
        {result.steps.map((s, i) => (
          <StepResultRow key={s.stepId} index={i + 1} step={s} />
        ))}
      </ul>
    </div>
  );
}

function StepResultRow({ index, step }: { index: number; step: StepResult }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasLogs = !!(step.tx && step.tx.logs.length > 0);
  const expandable = hasLogs || !!step.errorMessage;
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        className={[
          'w-full flex items-center gap-2 px-3 py-2 text-left bg-transparent border-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
          expandable ? 'cursor-pointer hover:bg-surface-1/40' : 'cursor-default',
        ].join(' ')}
      >
        <span className="w-3.5 text-text-muted inline-flex justify-center">
          {expandable ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span className="w-1 h-1 rounded-full bg-text-subtle" />
          )}
        </span>
        <Badge size="sm" variant="default" className="font-mono">
          #{index}
        </Badge>
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted shrink-0"
          aria-hidden
        >
          {stepIcon(step.kind, 11)}
        </span>
        <Badge size="sm" variant="accent">
          {prettyKind(step.kind)}
        </Badge>
        <span className="flex-1 min-w-0 truncate text-xs text-text">{step.name}</span>
        <span
          className={['shrink-0', step.success ? 'text-success' : 'text-danger'].join(' ')}
          aria-label={step.success ? 'success' : 'failure'}
        >
          {step.success ? <Check size={13} /> : <XCircle size={13} />}
        </span>
        <span className="font-mono text-2xs text-text-subtle min-w-[80px] text-right">
          {step.tx ? `cu ${step.tx.cuConsumed} · ` : ''}
          {step.durationMs.toFixed(1)}ms
        </span>
      </button>

      {open && expandable && (
        <div className="px-3 pb-3 pl-10">
          {step.errorMessage && (
            <div className="text-2xs text-danger break-words mb-2 font-mono">
              error: {step.errorMessage}
            </div>
          )}
          {hasLogs && (
            <pre className="font-mono text-2xs bg-bg border border-border rounded p-2 max-h-[320px] overflow-auto m-0 whitespace-pre-wrap">
              {step.tx!.logs.join('\n')}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
