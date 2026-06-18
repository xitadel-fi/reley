import {
  Box,
  Coins,
  Eye,
  EyeOff,
  Info,
  Layers,
  Layers3,
  PenLine,
  Trash2,
  User,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Button, Empty } from '../ui';
import { useToast } from '../components/Toast';
import type { Project } from '../types';

export interface PatchRecord {
  id: string;
  target: string;
  op:
    | { kind: 'setField'; fieldPath: string; valueJson: string }
    | { kind: 'rawSplice'; offset: number; bytes: unknown }
    | { kind: 'setLamports'; lamports: bigint | string }
    | { kind: 'setOwner'; owner: string };
  createdAt: number;
  enabled: boolean;
}

type Scope = 'project' | 'session';

/** Friendlier op label + detail. Surface this in the table instead of raw
 *  IPC kind names ("setField", "setLamports") which leak implementation. */
function opLabel(op: PatchRecord['op']): { label: string; detail: string; full: string } {
  if (op.kind === 'setField') {
    const trimmed = op.valueJson.length > 32 ? `${op.valueJson.slice(0, 32)}…` : op.valueJson;
    return {
      label: 'Edit field',
      detail: `${op.fieldPath} = ${trimmed}`,
      full: `${op.fieldPath} = ${op.valueJson}`,
    };
  }
  if (op.kind === 'setLamports') {
    const n = BigInt(String(op.lamports));
    const abs = n < 0n ? -n : n;
    if (abs >= 1_000_000n) {
      const sol = Number(n) / 1e9;
      const fmt =
        Math.abs(sol) >= 1 ? sol.toFixed(3) : sol.toFixed(6).replace(/\.?0+$/, '');
      return {
        label: 'Set balance',
        detail: `${fmt} SOL`,
        full: `${n.toString()} lamports`,
      };
    }
    return {
      label: 'Set balance',
      detail: `${n.toString()} lamports`,
      full: `${n.toString()} lamports`,
    };
  }
  if (op.kind === 'setOwner') {
    return {
      label: 'Set owner',
      detail: `${op.owner.slice(0, 4)}…${op.owner.slice(-4)}`,
      full: op.owner,
    };
  }
  return {
    label: 'Edit bytes',
    detail: `offset ${op.offset}`,
    full: JSON.stringify(op),
  };
}

function opIcon(kind: PatchRecord['op']['kind']): JSX.Element {
  switch (kind) {
    case 'setLamports':
      return <Coins size={12} aria-hidden />;
    case 'setField':
      return <PenLine size={12} aria-hidden />;
    case 'rawSplice':
      return <Layers size={12} aria-hidden />;
    case 'setOwner':
      return <User size={12} aria-hidden />;
  }
}

/** Shared patch row — institutional list-item style with toggle + delete. */
function PatchRow({
  patch,
  scope,
  scopeId,
  onChange,
}: {
  patch: PatchRecord;
  scope: Scope;
  scopeId: string;
  onChange: () => void;
}): JSX.Element {
  const toast = useToast();
  const summary = opLabel(patch.op);

  const toggle = async (): Promise<void> => {
    try {
      await api.call('patch.toggle', {
        scope,
        scopeId,
        patchId: patch.id,
        enabled: !patch.enabled,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await api.call('patch.remove', { scope, scopeId, patchId: patch.id });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className={`patch-list-row${patch.enabled ? '' : ' patch-list-row-off'}`}>
      <span className={`patch-list-icon op-${patch.op.kind}`} aria-hidden>
        {opIcon(patch.op.kind)}
      </span>
      <div className="patch-list-main">
        <div className="patch-list-head">
          <span className="patch-list-label">{summary.label}</span>
          <span className="patch-list-target font-mono" title={patch.target}>
            {patch.target.slice(0, 4)}…{patch.target.slice(-4)}
          </span>
        </div>
        <div className="patch-list-detail font-mono" title={summary.full}>
          {summary.detail}
        </div>
      </div>
      <button
        type="button"
        className="patch-list-toggle"
        onClick={() => void toggle()}
        title={patch.enabled ? 'Disable' : 'Enable'}
        aria-label={patch.enabled ? 'Disable patch' : 'Enable patch'}
      >
        {patch.enabled ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
      </button>
      <button
        type="button"
        className="patch-list-trash"
        onClick={() => void remove()}
        title="Delete"
        aria-label="Delete patch"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}

/** Group rows by target address for institutional readability. */
function groupByTarget(list: PatchRecord[]): Array<{ target: string; rows: PatchRecord[] }> {
  const map = new Map<string, PatchRecord[]>();
  for (const p of list) {
    const arr = map.get(p.target) ?? [];
    arr.push(p);
    map.set(p.target, arr);
  }
  return Array.from(map.entries()).map(([target, rows]) => ({ target, rows }));
}

/** Project-scope patches page. Re-applied on every sandbox open. */
export function ProjectPatchesPanel({
  project,
  onChange,
}: {
  project: Project;
  onChange: () => void;
}): JSX.Element {
  const list = (project.patches ?? []) as PatchRecord[];
  const groups = useMemo(() => groupByTarget(list), [list]);
  const activeCount = list.filter((p) => p.enabled).length;

  return (
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <Layers3 size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Project patches</h1>
              <span className="entity-pill entity-pill-workflow">Project scope</span>
            </div>
            <p className="entity-detail-hero-desc">
              Re-apply on every sandbox open. Use to bake fixtures into the project baseline.
            </p>
          </div>
        </div>
      </div>

      <div className="entity-detail-kpis">
        <div className="entity-kpi">
          <div className="entity-kpi-head">
            <span className="entity-kpi-icon" aria-hidden>
              <Layers3 size={14} />
            </span>
            <span className="entity-kpi-label">Total</span>
          </div>
          <div className="entity-kpi-value">{list.length}</div>
        </div>
        <div className="entity-kpi tone-good">
          <div className="entity-kpi-head">
            <span className="entity-kpi-icon" aria-hidden>
              <Eye size={14} />
            </span>
            <span className="entity-kpi-label">Active</span>
          </div>
          <div className="entity-kpi-value">{activeCount}</div>
        </div>
        <div className="entity-kpi">
          <div className="entity-kpi-head">
            <span className="entity-kpi-icon" aria-hidden>
              <Box size={14} />
            </span>
            <span className="entity-kpi-label">Accounts</span>
          </div>
          <div className="entity-kpi-value">{groups.length}</div>
        </div>
        <div className="entity-kpi tone-bad" style={{ opacity: 0.7 }}>
          <div className="entity-kpi-head">
            <span className="entity-kpi-icon" aria-hidden>
              <EyeOff size={14} />
            </span>
            <span className="entity-kpi-label">Disabled</span>
          </div>
          <div className="entity-kpi-value">{list.length - activeCount}</div>
        </div>
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Patches</h3>
          <span className="entity-detail-section-meta">grouped by target account</span>
        </div>
        {list.length === 0 ? (
          <Empty
            size="sm"
            title="No project patches yet"
            description='Right-click an account in the sidebar → "Patch fields…" to create one.'
          />
        ) : (
          <div className="patch-group-list">
            {groups.map((g) => (
              <div key={g.target} className="patch-group">
                <div className="patch-group-head">
                  <Box size={11} className="text-text-subtle" aria-hidden />
                  <span className="font-mono">
                    {g.target.slice(0, 4)}…{g.target.slice(-4)}
                  </span>
                  <span className="patch-group-count">
                    {g.rows.length} patch{g.rows.length === 1 ? '' : 'es'}
                  </span>
                </div>
                <div className="patch-group-rows">
                  {g.rows.map((p) => (
                    <PatchRow
                      key={p.id}
                      patch={p}
                      scope="project"
                      scopeId={project.id}
                      onChange={onChange}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="entity-detail-footchips">
        <span className="entity-footchip">
          <Info size={11} aria-hidden /> Right-click an account in the sidebar → "Patch
          fields…" to add a new one
        </span>
      </div>
    </div>
  );
}

/** Sandbox-scope patches page. Scratch patches scoped to the active sandbox. */
export function SandboxPatchesPanel({
  project,
  activeSessionId,
  onChange,
}: {
  project: Project;
  activeSessionId: string | null;
  onChange: () => void;
}): JSX.Element {
  const toast = useToast();
  const [list, setList] = useState<PatchRecord[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Refetch on sandbox change + on project id change. Previous version had
  // `project` + `toast` in deps, which thrashed (project reference changes
  // on every reload, toast object recreated per render) → effect cleanup
  // cancelled the in-flight fetch before its `then` ran → loaded stayed
  // false forever ("loading…").
  useEffect(() => {
    if (!activeSessionId) {
      setList([]);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    void api
      .call<PatchRecord[]>('patch.list', { scope: 'session', scopeId: activeSessionId })
      .then((rows) => {
        if (cancelled) return;
        setList(rows ?? []);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoaded(true); // unblock UI even on error
        toast.error(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, project.id]);

  const refetch = (): void => {
    onChange();
    if (!activeSessionId) return;
    void api
      .call<PatchRecord[]>('patch.list', { scope: 'session', scopeId: activeSessionId })
      .then((rows) => setList(rows ?? []));
  };

  const groups = useMemo(() => groupByTarget(list), [list]);
  const activeCount = list.filter((p) => p.enabled).length;

  return (
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon entity-hero-icon-test" aria-hidden>
            <Layers3 size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Sandbox patches</h1>
              <span className="entity-pill entity-pill-suite">Sandbox scope</span>
            </div>
            <p className="entity-detail-hero-desc">
              Live only in the active sandbox. Cleared on sandbox reset; never re-apply to
              other sandboxes.
            </p>
          </div>
        </div>
      </div>

      {activeSessionId && (
        <div className="entity-detail-kpis">
          <div className="entity-kpi">
            <div className="entity-kpi-head">
              <span className="entity-kpi-icon" aria-hidden>
                <Layers3 size={14} />
              </span>
              <span className="entity-kpi-label">Total</span>
            </div>
            <div className="entity-kpi-value">{list.length}</div>
          </div>
          <div className="entity-kpi tone-good">
            <div className="entity-kpi-head">
              <span className="entity-kpi-icon" aria-hidden>
                <Eye size={14} />
              </span>
              <span className="entity-kpi-label">Active</span>
            </div>
            <div className="entity-kpi-value">{activeCount}</div>
          </div>
          <div className="entity-kpi">
            <div className="entity-kpi-head">
              <span className="entity-kpi-icon" aria-hidden>
                <Box size={14} />
              </span>
              <span className="entity-kpi-label">Accounts</span>
            </div>
            <div className="entity-kpi-value">{groups.length}</div>
          </div>
          <div className="entity-kpi tone-bad" style={{ opacity: 0.7 }}>
            <div className="entity-kpi-head">
              <span className="entity-kpi-icon" aria-hidden>
                <EyeOff size={14} />
              </span>
              <span className="entity-kpi-label">Disabled</span>
            </div>
            <div className="entity-kpi-value">{list.length - activeCount}</div>
          </div>
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Patches</h3>
          <span className="entity-detail-section-meta">
            {activeSessionId ? 'grouped by target account' : 'pick a sandbox to begin'}
          </span>
        </div>
        {!activeSessionId ? (
          <Empty
            size="sm"
            title="No sandbox selected"
            description="Pick a sandbox from the top of the sidebar."
          />
        ) : !loaded ? (
          <div className="text-xs text-text-dim p-2">loading…</div>
        ) : list.length === 0 ? (
          <Empty
            size="sm"
            title="No sandbox patches"
            description="Right-click an account → 'Patch fields…' (scope: sandbox) to add one."
          />
        ) : (
          <div className="patch-group-list">
            {groups.map((g) => (
              <div key={g.target} className="patch-group">
                <div className="patch-group-head">
                  <Box size={11} className="text-text-subtle" aria-hidden />
                  <span className="font-mono">
                    {g.target.slice(0, 4)}…{g.target.slice(-4)}
                  </span>
                  <span className="patch-group-count">
                    {g.rows.length} patch{g.rows.length === 1 ? '' : 'es'}
                  </span>
                </div>
                <div className="patch-group-rows">
                  {g.rows.map((p) => (
                    <PatchRow
                      key={p.id}
                      patch={p}
                      scope="session"
                      scopeId={activeSessionId}
                      onChange={refetch}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="entity-detail-footchips">
        <span className="entity-footchip">
          <Info size={11} aria-hidden /> Cleared on sandbox reset · never re-apply to
          other sandboxes
        </span>
      </div>
    </div>
  );
}
