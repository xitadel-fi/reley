import { Check, History, Search, Trash2, XCircle } from 'lucide-react';
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
  const toast = useToast();
  const dialogs = useDialogs();

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

  const clearAll = async (): Promise<void> => {
    if (!activeSessionId) return;
    const ok = await dialogs.confirm({
      title: 'Clear transaction history',
      message: `Drop all ${items.length} tx records for this session? State stays intact, only the log is wiped.`,
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
        title="No session selected"
        description="Pick a session in the sidebar to view its transaction history."
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
            {items.length > 0 && (
              <Button variant="danger" size="sm" onClick={() => void clearAll()}>
                <Trash2 size={12} aria-hidden /> Clear all
              </Button>
            )}
          </div>
        </div>

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
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
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
    </div>
  );
}

function HistoryRow({
  tx,
  selected,
  onSelect,
}: {
  tx: TxRecord;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <div
      className={[
        'grid grid-cols-[80px_70px_90px_1fr_1fr_60px] border-t border-border',
        'cursor-pointer hover:bg-surface-1/40 items-center',
        selected && 'bg-surface-2/40',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
      style={{ height: ROW_HEIGHT }}
    >
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
      <div className="px-3 text-2xs text-danger truncate">{tx.errorMessage ?? ''}</div>
      <div className="px-3 text-right">
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
