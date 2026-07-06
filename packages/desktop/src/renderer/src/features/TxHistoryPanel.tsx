import {
  Check,
  Columns,
  Download,
  History,
  Save,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Input,
  Pubkey,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  VirtualList,
} from '../ui';

const VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT = 32;
import { TxResultView, type TraceNode } from './TxResultView';

interface TxRecord {
  id: string;
  signature: string | null;
  submittedAt: number;
  success: boolean;
  errorMessage: string | null;
  cuConsumed: bigint | string | number;
  trace: TraceNode;
  touchedAccounts: string[];
  rawTxBase64?: string;
  autoCloned?: {
    cloned: string[];
    injectedAsSystem: string[];
    clonedPrograms?: string[];
    resolvedAlts?: string[];
    slot: string | null;
  };
}

type StatusFilter = 'all' | 'ok' | 'err';
type TimeFilter = 'all' | '5m' | '1h' | '24h';

const TIME_WINDOWS_MS: Record<TimeFilter, number | null> = {
  all: null,
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export function TxHistoryPanel({
  activeSessionId,
}: {
  activeSessionId: string | null;
}): JSX.Element {
  const [items, setItems] = useState<TxRecord[]>([]);
  const [selected, setSelected] = useState<TxRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [timeWindow, setTimeWindow] = useState<TimeFilter>('all');
  const [programFilter, setProgramFilter] = useState<string>('');
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const toast = useToast();
  const dialogs = useDialogs();

  const toggleCompareId = (id: string): void => {
    setCompareIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      // Cap at 2 — pushing a third drops the oldest.
      if (cur.length >= 2) return [cur[1]!, id];
      return [...cur, id];
    });
  };
  const exitCompareMode = (): void => {
    setCompareMode(false);
    setCompareIds([]);
  };

  const reload = (): void => {
    setErr(null);
    if (!activeSessionId) {
      setItems([]);
      return;
    }
    void api
      .call<TxRecord[]>('tx.history', { sessionId: activeSessionId })
      .then(setItems)
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => {
    reload();
  }, [activeSessionId]);

  const programOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.trace.programId);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const window = TIME_WINDOWS_MS[timeWindow];
    const now = Date.now();
    return items
      .filter((it) => {
        if (status === 'ok' && !it.success) return false;
        if (status === 'err' && it.success) return false;
        if (window != null && now - it.submittedAt > window) return false;
        if (programFilter && it.trace.programId !== programFilter) return false;
        if (q) {
          const hay = [
            it.id,
            it.signature ?? '',
            it.trace.programId,
            it.errorMessage ?? '',
            ...it.touchedAccounts,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .reverse();
  }, [items, query, status, timeWindow, programFilter]);

  const saveAsTemplate = async (tx: TxRecord): Promise<void> => {
    if (!activeSessionId || !tx.rawTxBase64) return;
    const name = await dialogs.prompt({
      title: 'Save as template',
      label: 'Template name',
      placeholder: 'e.g. transfer-100-USDC',
      confirmText: 'Save',
    });
    if (!name?.trim()) return;
    try {
      await api.call('tx.historyToTemplate', {
        sessionId: activeSessionId,
        recordId: tx.id,
        name: name.trim(),
      });
      toast.success(`template saved: ${name.trim()}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const clearAll = async (): Promise<void> => {
    if (!activeSessionId) return;
    const ok = await dialogs.confirm({
      title: 'Clear transaction history',
      message: `Drop all ${items.length} tx records for this sandbox? State stays intact, only the log is wiped.`,
      danger: true,
      confirmText: 'Clear',
    });
    if (!ok) return;
    try {
      await api.call('tx.historyClear', { sessionId: activeSessionId });
      setSelected(null);
      reload();
      toast.success('history cleared');
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (!activeSessionId) {
    return (
      <Empty
        icon={<History size={20} aria-hidden />}
        title="No sandbox selected"
        description="Pick a sandbox in the sidebar to view its transaction history."
      />
    );
  }

  const okCount = items.filter((i) => i.success).length;
  const errCount = items.length - okCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="m-0">
            Transaction history{' '}
            <span className="text-text-muted text-sm font-normal">({items.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            {okCount > 0 && (
              <Badge size="sm" variant="success">
                {okCount} ok
              </Badge>
            )}
            {errCount > 0 && (
              <Badge size="sm" variant="danger">
                {errCount} err
              </Badge>
            )}
            {items.length >= 2 && (
              <Button
                variant={compareMode ? 'accent' : 'ghost'}
                size="sm"
                onClick={() => (compareMode ? exitCompareMode() : setCompareMode(true))}
                title="Pick 2 rows to compare side-by-side"
              >
                <Columns size={12} aria-hidden /> Compare
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="danger" size="sm" onClick={() => void clearAll()}>
                <Trash2 size={12} aria-hidden /> Clear all
              </Button>
            )}
          </div>
        </div>

        {compareMode && (
          <div className="rounded border border-accent/40 bg-accent/5 px-3 py-2 mb-3 flex items-center gap-3 text-xs">
            <Columns size={12} className="text-accent shrink-0" aria-hidden />
            <span className="flex-1 text-text">
              Compare mode — pick {2 - compareIds.length} more row{compareIds.length === 1 ? '' : 's'}.
              <span className="text-text-subtle">
                {' '}
                ({compareIds.length}/2 selected)
              </span>
            </span>
            <Button
              variant="primary"
              size="xs"
              disabled={compareIds.length !== 2}
              onClick={() => setCompareOpen(true)}
            >
              Compare ▸
            </Button>
            <button
              type="button"
              onClick={exitCompareMode}
              className="inline-flex w-5 h-5 items-center justify-center text-text-muted hover:text-text"
              title="Exit compare mode"
              aria-label="Exit compare mode"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        )}

        {err && <ErrorState title="Failed to load history" message={err} />}

        {items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_auto_auto_auto] gap-2 mb-3">
            <div className="relative">
              <Search
                size={11}
                aria-hidden
                className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search id, signature, program, account, error…"
                sizeVariant="sm"
                className="pl-7"
              />
            </div>
            <Select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              sizeVariant="sm"
              className="min-w-[160px]"
            >
              <option value="">all programs</option>
              {programOptions.map((p) => (
                <option key={p} value={p}>
                  {p.slice(0, 4)}…{p.slice(-4)}
                </option>
              ))}
            </Select>
            <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="ok">OK</TabsTrigger>
                <TabsTrigger value="err">Err</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={timeWindow} onValueChange={(v) => setTimeWindow(v as TimeFilter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="24h">24h</TabsTrigger>
                <TabsTrigger value="1h">1h</TabsTrigger>
                <TabsTrigger value="5m">5m</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {items.length === 0 ? (
          <Empty
            size="sm"
            icon={<History size={18} aria-hidden />}
            title="No transactions yet"
            description="Use Tx Builder → Simulate or Submit to populate."
          />
        ) : filtered.length === 0 ? (
          <Empty
            size="sm"
            title="No matches"
            description="Adjust filters or clear the search query."
          />
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-[80px_70px_90px_1fr_1fr_60px] bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle font-medium">
              <div className="px-3 py-1.5">When</div>
              <div className="px-3 py-1.5">Status</div>
              <div className="px-3 py-1.5">CU</div>
              <div className="px-3 py-1.5">Program</div>
              <div className="px-3 py-1.5">Error</div>
              <div className="px-3 py-1.5" />
            </div>
            {filtered.length > VIRTUAL_THRESHOLD ? (
              <VirtualList
                items={filtered}
                estimateSize={ROW_HEIGHT}
                height={Math.min(560, filtered.length * ROW_HEIGHT)}
                getKey={(tx) => tx.id}
                renderItem={(tx) => (
                  <HistoryRow
                    tx={tx}
                    selected={selected?.id === tx.id}
                    onSelect={() => setSelected(tx)}
                    onSaveAsTemplate={() => void saveAsTemplate(tx)}
                    compareMode={compareMode}
                    compareChecked={compareIds.includes(tx.id)}
                    onToggleCompare={() => toggleCompareId(tx.id)}
                  />
                )}
              />
            ) : (
              <div>
                {filtered.map((tx) => (
                  <HistoryRow
                    key={tx.id}
                    tx={tx}
                    selected={selected?.id === tx.id}
                    onSelect={() => setSelected(tx)}
                    onSaveAsTemplate={() => void saveAsTemplate(tx)}
                    compareMode={compareMode}
                    compareChecked={compareIds.includes(tx.id)}
                    onToggleCompare={() => toggleCompareId(tx.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && !compareMode && (
        <TxResultView
          result={{
            success: selected.success,
            errorMessage: selected.errorMessage,
            cuConsumed: selected.cuConsumed,
            returnData: null,
            logs: selected.trace.logs.map((l) => l.raw),
            trace: [selected.trace],
            recordId: selected.id,
          }}
        />
      )}

      {compareOpen && compareIds.length === 2 && (
        <CompareDiff
          left={items.find((i) => i.id === compareIds[0])!}
          right={items.find((i) => i.id === compareIds[1])!}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}

function CompareDiff({
  left,
  right,
  onClose,
}: {
  left: TxRecord;
  right: TxRecord;
  onClose: () => void;
}): JSX.Element {
  const fmtCu = (v: bigint | string | number): string => String(v);
  const cuLeft = Number(left.cuConsumed);
  const cuRight = Number(right.cuConsumed);
  const cuDelta = cuRight - cuLeft;
  const cuPct = cuLeft > 0 ? ((cuDelta / cuLeft) * 100).toFixed(1) : '∞';
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border rounded-lg shadow-elev-3 w-full max-w-6xl mt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Columns size={14} className="text-accent" aria-hidden />
          <h3 className="m-0 text-md font-semibold">Compare 2 txs</h3>
          <div className="ml-auto text-2xs text-text-subtle">
            ΔCU = {cuDelta >= 0 ? '+' : ''}
            {cuDelta} ({cuPct}%)
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-7 h-7 items-center justify-center rounded text-text-muted hover:bg-surface-1 hover:text-text"
            aria-label="Close"
          >
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className="grid grid-cols-2 divide-x divide-border max-h-[80vh] overflow-auto">
          {[left, right].map((tx, i) => (
            <div key={tx.id} className="p-4 flex flex-col gap-2 min-w-0">
              <div className="text-2xs text-text-subtle uppercase tracking-wider">
                {i === 0 ? 'LEFT' : 'RIGHT'} ·{' '}
                <span className="font-mono">
                  {new Date(tx.submittedAt).toISOString().slice(11, 19)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {tx.success ? (
                  <Badge size="sm" variant="success">
                    <Check size={10} aria-hidden /> OK
                  </Badge>
                ) : (
                  <Badge size="sm" variant="danger">
                    <XCircle size={10} aria-hidden /> ERR
                  </Badge>
                )}
                <span className="font-mono text-text-muted">CU {fmtCu(tx.cuConsumed)}</span>
              </div>
              <div className="text-2xs text-text-subtle font-mono break-all">
                {tx.trace.programId}
              </div>
              {tx.errorMessage && (
                <div className="text-2xs text-danger font-mono break-words">
                  {tx.errorMessage}
                </div>
              )}
              <pre className="font-mono text-2xs bg-surface-0 border border-border rounded p-2 max-h-[55vh] overflow-auto m-0 whitespace-pre-wrap break-all">
                {tx.trace.logs.map((l) => l.raw).join('\n')}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  tx,
  selected,
  onSelect,
  onSaveAsTemplate,
  compareMode = false,
  compareChecked = false,
  onToggleCompare,
}: {
  tx: TxRecord;
  selected: boolean;
  onSelect: () => void;
  onSaveAsTemplate: () => void;
  compareMode?: boolean;
  compareChecked?: boolean;
  onToggleCompare?: () => void;
}): JSX.Element {
  return (
    <div
      className={[
        compareMode
          ? 'grid grid-cols-[28px_80px_70px_90px_1fr_1fr_60px] border-t border-border'
          : 'grid grid-cols-[80px_70px_90px_1fr_1fr_60px] border-t border-border',
        'cursor-pointer hover:bg-surface-1/40 items-center',
        selected && !compareMode ? 'bg-surface-2/40' : '',
        compareChecked ? 'bg-accent/10' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={compareMode ? onToggleCompare : onSelect}
      style={{ height: ROW_HEIGHT }}
    >
      {compareMode && (
        <div className="px-3 flex items-center justify-center">
          <input
            type="checkbox"
            checked={compareChecked}
            onChange={onToggleCompare}
            onClick={(e) => e.stopPropagation()}
            aria-label="Pick for compare"
          />
        </div>
      )}
      <div className="px-3 font-mono text-2xs text-text-muted">
        {new Date(tx.submittedAt).toISOString().slice(11, 19)}
      </div>
      <div className="px-3">
        {tx.success ? (
          <span className="inline-flex items-center gap-1 text-success text-xs">
            <Check size={11} aria-hidden /> OK
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-danger text-xs">
            <XCircle size={11} aria-hidden /> ERR
          </span>
        )}
      </div>
      <div className="px-3 font-mono text-xs text-text">{tx.cuConsumed.toString()}</div>
      <div className="px-3">
        <Pubkey value={tx.trace.programId} className="text-text-muted" />
      </div>
      <div className="px-3 text-2xs text-danger truncate flex items-center gap-1.5 min-w-0">
        {tx.autoCloned &&
          (tx.autoCloned.cloned.length > 0 ||
            (tx.autoCloned.clonedPrograms?.length ?? 0) > 0 ||
            (tx.autoCloned.resolvedAlts?.length ?? 0) > 0 ||
            tx.autoCloned.injectedAsSystem.length > 0) && (
            <span
              className="tx-autoclone-chip shrink-0"
              title={[
                tx.autoCloned.cloned.length
                  ? `${tx.autoCloned.cloned.length} cloned`
                  : '',
                tx.autoCloned.clonedPrograms?.length
                  ? `${tx.autoCloned.clonedPrograms.length} programs`
                  : '',
                tx.autoCloned.resolvedAlts?.length
                  ? `${tx.autoCloned.resolvedAlts.length} ALTs`
                  : '',
                tx.autoCloned.injectedAsSystem.length
                  ? `${tx.autoCloned.injectedAsSystem.length} system stubs`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <Download size={9} aria-hidden /> auto-cloned
            </span>
          )}
        <span className="truncate">{tx.errorMessage ?? ''}</span>
      </div>
      <div className="px-3 text-right flex items-center justify-end gap-1">
        {tx.rawTxBase64 && (
          <Button
            variant="ghost"
            size="xs"
            title="Save this tx as a reusable template"
            onClick={(e) => {
              e.stopPropagation();
              onSaveAsTemplate();
            }}
          >
            <Save size={11} aria-hidden />
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          View
        </Button>
      </div>
    </div>
  );
}
