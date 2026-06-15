import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Droplets,
  GitBranch,
  ListChecks,
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
  'resetSession',
  'setProgramVersion',
];

const NUMERIC_OPS: NumericOp[] = ['eq', 'neq', 'ge', 'le', 'gt', 'lt'];

const prettyKind = (k: StepKind): string =>
  ({
    tx: 'Submit tx',
    airdrop: 'Airdrop SOL',
    warpTime: 'Warp by time',
    warpSlot: 'Warp to slot',
    expireBlockhash: 'Expire blockhash',
    resetSession: 'Reset session',
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
}: {
  project: Project;
  activeSessionId: string | null;
  onSelectSession?: (id: string) => void;
}): JSX.Element {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [editing, setEditing] = useState<TestSuite | null>(null);
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
        onCancel={() => setEditing(null)}
        onRun={() => void run()}
        result={result}
        ranIxs={ranIxs}
        suggestions={suggestions}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="m-0">Test Suites</h2>
          <span className="text-2xs text-text-subtle">{suites.length} saved</span>
        </div>
        <div className="text-xs text-text-muted mb-3">
          Group multiple testcases. Each case runs all steps regardless of tx
          failures — failed tx never halts the suite. Use expectations to assert
          outcomes (success/failure, error text, CU range, account state).
        </div>
        <div>
          <Button variant="primary" size="sm" onClick={() => void newSuite()}>
            <Plus size={12} aria-hidden /> New test suite
          </Button>
        </div>
        {suites.length === 0 ? (
          <div className="mt-3">
            <Empty
              size="sm"
              title="No test suites yet"
              description="Create one to assert program behavior across multiple scenarios."
            />
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Name</th>
                  <th className="text-left font-medium px-3 py-1.5 w-16">Cases</th>
                  <th className="text-left font-medium px-3 py-1.5">Updated</th>
                  <th className="px-3 py-1.5 w-40" />
                </tr>
              </thead>
              <tbody>
                {suites.map((s) => (
                  <tr key={s.id} className="border-t border-border hover:bg-surface-1/50">
                    <td className="px-3 py-1.5 text-text">{s.name}</td>
                    <td className="px-3 py-1.5 text-text-muted">{s.cases.length}</td>
                    <td className="px-3 py-1.5 font-mono text-2xs text-text-subtle">
                      {new Date(s.updatedAt).toISOString().slice(0, 19)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1 justify-end">
                        <Button variant="outline" size="xs" onClick={() => void run(s)}>
                          <Play size={11} aria-hidden /> Run
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="xs" onClick={() => void remove(s.id)}>
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

      {result && <RunResultView result={result} ixByStep={ranIxs} project={project} />}
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
            <h2 className="m-0">{suite.id ? 'Edit test suite' : 'New test suite'}</h2>
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
            <Input value={suite.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input
              value={suite.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What does this test suite verify?"
            />
          </Field>
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="m-0">
              Testcases <span className="text-text-muted">({suite.cases.length})</span>
            </h2>
            <Button variant="ghost" size="xs" onClick={addCase}>
              <Plus size={11} aria-hidden /> Add testcase
            </Button>
          </div>

          {suite.cases.length === 0 ? (
            <Empty size="sm" title="No testcases yet" description="Add a testcase." />
          ) : (
            <ul className="flex flex-col gap-3">
              {suite.cases.map((tc, idx) => (
                <CaseEditor
                  key={tc.id}
                  index={idx}
                  testCase={tc}
                  project={project}
                  suggestions={suggestions}
                  onPatch={(patch) => updateCase(tc.id, patch)}
                  onRemove={() => removeCase(tc.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {result && <RunResultView result={result} ixByStep={ranIxs} project={project} />}
    </div>
  );
}

// Removed earlier duplicate; pass-through wired above.

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
          title="Reset session state before this case (fresh slate)"
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

          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-2xs text-text-subtle uppercase tracking-wider">
              Steps · runs top to bottom, never halts on fail
            </div>
            <div className="flex flex-wrap gap-1">
              {STEP_KINDS.map((k) => (
                <Button key={k} variant="ghost" size="xs" onClick={() => addStep(k)}>
                  {stepIcon(k, 11)} {prettyKind(k)}
                </Button>
              ))}
            </div>
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
  if (step.kind === 'expireBlockhash' || step.kind === 'resetSession') {
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
        Switches the session-level program-version pin. Persistent — all
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
  return (
    <div className="panel">
      <header className="flex items-start gap-3 mb-3 flex-wrap">
        <span
          className={[
            'inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0',
            result.pass ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
          ].join(' ')}
          aria-hidden
        >
          {result.pass ? (
            <CheckCircle2 size={16} strokeWidth={2.5} />
          ) : (
            <XCircle size={16} strokeWidth={2.5} />
          )}
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-md font-semibold">
            Suite run ·{' '}
            <span className={result.pass ? 'text-success' : 'text-danger'}>
              {result.pass ? 'PASSED' : 'FAILED'}
            </span>
          </h2>
          <div className="text-xs text-text-muted mt-0.5">
            {passed}/{result.cases.length} cases ·{' '}
            <span className="font-mono">{result.completedAt - result.startedAt} ms</span>
          </div>
        </div>
      </header>
      <ul className="flex flex-col gap-2">
        {result.cases.map((c, i) => (
          <CaseResultView
            key={c.caseId}
            index={i + 1}
            value={c}
            ixByStep={ixByStep}
            project={project}
          />
        ))}
      </ul>
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
    <li className="rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'w-full flex items-center gap-2 px-3 py-2 text-left bg-transparent border-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
          'cursor-pointer hover:bg-surface-1/40',
        ].join(' ')}
      >
        <span className="w-3.5 text-text-muted inline-flex justify-center">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Badge size="sm" variant="default" className="font-mono">
          #{index}
        </Badge>
        <span className="flex-1 min-w-0 truncate text-xs text-text">{value.name}</span>
        <span
          className={['shrink-0', value.pass ? 'text-success' : 'text-danger'].join(' ')}
          aria-label={value.pass ? 'pass' : 'fail'}
        >
          {value.pass ? <Check size={13} /> : <XCircle size={13} />}
        </span>
        <span className="font-mono text-2xs text-text-subtle min-w-[80px] text-right">
          {passed}/{value.steps.length} steps · {value.completedAt - value.startedAt}ms
        </span>
      </button>
      {open && (
        <ul className="border-t border-border">
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
        {step.txOk !== null && (
          <span
            className={[
              'shrink-0 text-2xs px-1.5 py-0.5 rounded',
              step.txOk ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
            ].join(' ')}
          >
            tx {step.txOk ? 'ok' : 'failed'}
          </span>
        )}
        <span
          className={['shrink-0', step.pass ? 'text-success' : 'text-danger'].join(' ')}
          aria-label={step.pass ? 'pass' : 'fail'}
        >
          {step.pass ? <Check size={13} /> : <XCircle size={13} />}
        </span>
        <span className="font-mono text-2xs text-text-subtle min-w-[70px] text-right">
          {step.tx ? `cu ${step.tx.cuConsumed} · ` : ''}
          {step.durationMs.toFixed(1)}ms
        </span>
      </button>

      {open && expandable && (
        <div className="px-3 pb-3 pl-10 flex flex-col gap-2">
          {ixs && ixs.length > 0 && (
            <div className="rounded border border-border bg-bg p-2">
              <div className="text-2xs text-text-subtle mb-1">Instructions sent</div>
              <ol className="flex flex-col gap-1">
                {ixs.map((ix, i) => (
                  <li
                    key={i}
                    className="text-2xs text-text-muted flex items-center gap-2"
                  >
                    <span className="font-mono text-text-subtle">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate">
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
            <div className="text-2xs text-danger break-words font-mono">
              error: {step.errorMessage}
            </div>
          )}
          {step.expectations.length > 0 && (
            <ul className="flex flex-col gap-1">
              {step.expectations.map((x, i) => (
                <li
                  key={i}
                  className={[
                    'flex items-start gap-2 text-2xs rounded px-2 py-1 border',
                    x.pass
                      ? 'border-success/30 bg-success/5 text-text'
                      : 'border-danger/30 bg-danger/5 text-text',
                  ].join(' ')}
                >
                  <span
                    className={['shrink-0 mt-0.5', x.pass ? 'text-success' : 'text-danger'].join(
                      ' ',
                    )}
                  >
                    {x.pass ? <Check size={11} /> : <XCircle size={11} />}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium">{x.description}</div>
                    <div className="font-mono text-text-muted">
                      actual: {x.actual ?? '(null)'} · expected: {x.expected}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasLogs && (
            <pre className="font-mono text-2xs bg-bg border border-border rounded p-2 max-h-[260px] overflow-auto m-0 whitespace-pre-wrap">
              {step.tx!.logs.join('\n')}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
