import { ArrowRight, Diff, Minus, Plus, RefreshCw, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Pubkey,
  Select,
  Spinner,
} from '../ui';

interface NameSetDiff {
  added: string[];
  removed: string[];
}
interface FieldDelta {
  name: string;
  leftType: string | null;
  rightType: string | null;
}
interface ChangedItem {
  name: string;
  args?: { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] };
  fields?: { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] };
  accounts?: NameSetDiff & { propsChanged: string[] };
}
interface IdlDiff {
  leftName: string;
  rightName: string;
  instructions: { added: string[]; removed: string[]; changed: ChangedItem[] };
  accounts: { added: string[]; removed: string[]; changed: ChangedItem[] };
  errors: NameSetDiff;
  events: NameSetDiff;
  summary: {
    instructionsAdded: number;
    instructionsRemoved: number;
    instructionsChanged: number;
    accountsAdded: number;
    accountsRemoved: number;
    accountsChanged: number;
    errorsAdded: number;
    errorsRemoved: number;
    eventsAdded: number;
    eventsRemoved: number;
    totalChanges: number;
  };
}

interface IdlEntry {
  programId: string;
  idlName: string;
  source: string;
  updatedAt: number;
}

export interface IdlDiffPanelProps {
  onClose: () => void;
}

export function IdlDiffPanel({ onClose }: IdlDiffPanelProps): JSX.Element {
  const [attached, setAttached] = useState<IdlEntry[] | null>(null);
  const [leftProgramId, setLeftProgramId] = useState<string>('');
  const [rightProgramId, setRightProgramId] = useState<string>('');
  const [diff, setDiff] = useState<IdlDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<IdlEntry[]>('idl.list')
      .then((list) => {
        setAttached(list);
        if (list.length >= 1 && !leftProgramId) setLeftProgramId(list[0]!.programId);
        if (list.length >= 2 && !rightProgramId) setRightProgramId(list[1]!.programId);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const run = async (): Promise<void> => {
    if (!leftProgramId || !rightProgramId) {
      setErr('Pick both IDLs first');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.call<IdlDiff>('idl.diffPrograms', {
        leftProgramId,
        rightProgramId,
      });
      setDiff(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[760px] max-w-[960px]">
      <header>
        <h3 className="m-0 text-md font-semibold inline-flex items-center gap-2">
          <Diff size={14} className="text-text-muted" aria-hidden /> IDL diff
        </h3>
        <div className="mt-1 text-xs text-text-muted">
          Compare two attached Anchor IDLs structurally. Useful for spotting
          API breaks before swapping program versions.
        </div>
      </header>

      {err && <ErrorState title="Diff failed" message={err} />}

      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
        <Field label="Left (baseline)">
          <Select
            value={leftProgramId}
            onChange={(e) => {
              setLeftProgramId(e.target.value);
              setDiff(null);
            }}
            disabled={!attached || attached.length === 0}
          >
            <option value="">— pick an IDL —</option>
            {(attached ?? []).map((i) => (
              <option key={i.programId} value={i.programId}>
                {i.idlName} · {i.programId.slice(0, 6)}…{i.programId.slice(-4)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="text-text-subtle pb-2">
          <ArrowRight size={16} />
        </div>
        <Field label="Right (target)">
          <Select
            value={rightProgramId}
            onChange={(e) => {
              setRightProgramId(e.target.value);
              setDiff(null);
            }}
            disabled={!attached || attached.length === 0}
          >
            <option value="">— pick an IDL —</option>
            {(attached ?? []).map((i) => (
              <option key={i.programId} value={i.programId}>
                {i.idlName} · {i.programId.slice(0, 6)}…{i.programId.slice(-4)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          size="md"
          disabled={busy || !leftProgramId || !rightProgramId || leftProgramId === rightProgramId}
          onClick={() => void run()}
        >
          {busy ? <Spinner size={12} /> : <RefreshCw size={12} aria-hidden />}
          Compare
        </Button>
      </div>

      {leftProgramId && rightProgramId && leftProgramId === rightProgramId && (
        <div className="text-2xs text-warning">Left and right are the same IDL.</div>
      )}

      {!attached ? (
        <Spinner label="Loading IDLs…" />
      ) : attached.length < 2 ? (
        <Empty
          size="sm"
          title="Need at least two attached IDLs"
          description="Attach IDLs to two programs first (right-click program → Attach IDL…)."
        />
      ) : null}

      {diff && <DiffView diff={diff} />}

      <div className="flex items-center justify-end pt-1">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: IdlDiff }): JSX.Element {
  const totalChanges = diff.summary.totalChanges;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-0 p-3 flex items-center gap-3 flex-wrap text-xs">
        <span className="text-text-muted">
          <Pubkey value={diff.leftName} noCopy className="text-text" /> vs{' '}
          <Pubkey value={diff.rightName} noCopy className="text-text" />
        </span>
        <span className="text-text-subtle">·</span>
        {totalChanges === 0 ? (
          <Badge size="sm" variant="success">
            No differences
          </Badge>
        ) : (
          <Badge size="sm" variant="warning">
            {totalChanges} changes
          </Badge>
        )}
      </div>

      <Section
        title="Instructions"
        added={diff.instructions.added}
        removed={diff.instructions.removed}
        changed={diff.instructions.changed}
        changedRender={(ci) => (
          <>
            {ci.args && renderFieldDelta('Args', ci.args)}
            {ci.accounts && renderAccountDelta(ci.accounts)}
          </>
        )}
      />

      <Section
        title="Accounts"
        added={diff.accounts.added}
        removed={diff.accounts.removed}
        changed={diff.accounts.changed}
        changedRender={(ci) => <>{ci.fields && renderFieldDelta('Fields', ci.fields)}</>}
      />

      <Section
        title="Errors"
        added={diff.errors.added}
        removed={diff.errors.removed}
        changed={[]}
        changedRender={() => null}
      />

      <Section
        title="Events"
        added={diff.events.added}
        removed={diff.events.removed}
        changed={[]}
        changedRender={() => null}
      />
    </div>
  );
}

function Section({
  title,
  added,
  removed,
  changed,
  changedRender,
}: {
  title: string;
  added: string[];
  removed: string[];
  changed: ChangedItem[];
  changedRender: (ci: ChangedItem) => React.ReactNode;
}): JSX.Element | null {
  const total = added.length + removed.length + changed.length;
  if (total === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface-0 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-1/50">
        <h4 className="m-0 text-sm font-semibold flex-1 min-w-0">{title}</h4>
        {added.length > 0 && (
          <Badge size="sm" variant="success">
            <Plus size={9} aria-hidden /> {added.length}
          </Badge>
        )}
        {removed.length > 0 && (
          <Badge size="sm" variant="danger">
            <Minus size={9} aria-hidden /> {removed.length}
          </Badge>
        )}
        {changed.length > 0 && (
          <Badge size="sm" variant="warning">
            <Pencil size={9} aria-hidden /> {changed.length}
          </Badge>
        )}
      </header>
      <ul className="flex flex-col">
        {added.map((n) => (
          <li
            key={`a-${n}`}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-b-0 text-xs"
          >
            <Plus size={11} className="text-success" aria-hidden />
            <span className="font-mono text-text">{n}</span>
          </li>
        ))}
        {removed.map((n) => (
          <li
            key={`r-${n}`}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-b-0 text-xs"
          >
            <Minus size={11} className="text-danger" aria-hidden />
            <span className="font-mono text-text line-through">{n}</span>
          </li>
        ))}
        {changed.map((ci) => (
          <li
            key={`c-${ci.name}`}
            className="px-3 py-2 border-b border-border last:border-b-0 text-xs"
          >
            <div className="flex items-center gap-2 mb-1">
              <Pencil size={11} className="text-warning" aria-hidden />
              <span className="font-mono text-text">{ci.name}</span>
            </div>
            <div className="pl-5">{changedRender(ci)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderFieldDelta(
  label: string,
  delta: { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] },
): JSX.Element | null {
  if (
    delta.added.length === 0 &&
    delta.removed.length === 0 &&
    delta.typeChanged.length === 0
  ) {
    return null;
  }
  return (
    <div className="text-2xs text-text-muted">
      <div className="font-medium mb-0.5">{label}</div>
      {delta.added.map((d) => (
        <div key={`a-${d.name}`} className="font-mono">
          <span className="text-success">+ </span>
          {d.name}: <span className="text-text-subtle">{d.rightType}</span>
        </div>
      ))}
      {delta.removed.map((d) => (
        <div key={`r-${d.name}`} className="font-mono">
          <span className="text-danger">− </span>
          {d.name}: <span className="text-text-subtle">{d.leftType}</span>
        </div>
      ))}
      {delta.typeChanged.map((d) => (
        <div key={`t-${d.name}`} className="font-mono">
          <span className="text-warning">~ </span>
          {d.name}:{' '}
          <span className="text-text-subtle line-through">{d.leftType}</span>{' '}
          <ArrowRight size={9} className="inline" />{' '}
          <span className="text-text">{d.rightType}</span>
        </div>
      ))}
    </div>
  );
}

function renderAccountDelta(d: NameSetDiff & { propsChanged: string[] }): JSX.Element | null {
  if (d.added.length === 0 && d.removed.length === 0 && d.propsChanged.length === 0) return null;
  return (
    <div className="text-2xs text-text-muted mt-1">
      <div className="font-medium mb-0.5">Accounts</div>
      {d.added.map((n) => (
        <div key={`a-${n}`} className="font-mono">
          <span className="text-success">+ </span>
          {n}
        </div>
      ))}
      {d.removed.map((n) => (
        <div key={`r-${n}`} className="font-mono">
          <span className="text-danger">− </span>
          {n}
        </div>
      ))}
      {d.propsChanged.map((n) => (
        <div key={`t-${n}`} className="font-mono">
          <span className="text-warning">~ </span>
          {n}{' '}
          <span className="text-text-subtle">(signer/writable/optional changed)</span>
        </div>
      ))}
    </div>
  );
}
