import {
  ChevronDown,
  FileText,
  History,
  ListChecks,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { TxHistoryPanel } from './TxHistoryPanel';

interface TxRecord {
  id: string;
  submittedAt: number;
  success: boolean;
  errorMessage: string | null;
  cuConsumed: bigint | string | number;
  trace: { programId: string; logs: Array<{ raw: string }> };
}

export interface RunRecord {
  kind: 'workflow' | 'testSuite' | 'tx';
  name: string;
  pass: boolean;
  /** Already-rendered result body (a RunResultView from the panel) so the
   *  dock stays decoupled from the workflow/test result schemas. */
  body: ReactNode;
  /** Top-line summary (e.g. "5/5 steps · 320 ms"). */
  subtitle: string;
}

type Tab = 'history' | 'logs' | 'results';

const STORAGE_KEY = 'relay:console-tab';

/**
 * VSCode-style bottom console dock. Two tabs:
 *   - History: the full TxHistoryPanel (filters, compare, save-as-template)
 *   - Logs: chronological flat log stream concatenated from every tx record
 *     in the current sandbox, newest first, with tx separators.
 */
export function ConsoleDock({
  activeSessionId,
  onClose,
  runRecord,
  runRecordId,
}: {
  activeSessionId: string | null;
  onClose: () => void;
  /** Latest workflow/test-suite run result, surfaced by App. Null when none. */
  runRecord?: RunRecord | null;
  /** Counter bumped per new run — flip to Results tab once on bump. */
  runRecordId?: number;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof localStorage === 'undefined') return 'history';
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'logs' || v === 'results') return v;
    return 'history';
  });

  // Dock height — persisted across sessions + tab switches so the panel size
  // stays consistent. Clamped to [120, 80% viewport] to avoid edge cases.
  const HEIGHT_KEY = 'relay:console-height';
  const [height, setHeight] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return 280;
    const raw = localStorage.getItem(HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 120) return Math.min(n, window.innerHeight * 0.8);
    return 280;
  });
  const [dragging, setDragging] = useState(false);

  const beginResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    setDragging(true);
    // Lock global cursor + suppress text selection while dragging — keeps the
    // ns-resize cursor visible even when the mouse strays off the handle.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent): void => {
      const delta = startY - ev.clientY;
      // Allow shrinking down to 80px (just enough for the tab strip), and
      // growing up to 92% of the viewport — matches the CSS clamp.
      const next = Math.max(80, Math.min(window.innerHeight * 0.92, startH + delta));
      setHeight(next);
    };
    const onUp = (): void => {
      setDragging(false);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setHeight((h) => {
        if (typeof localStorage !== 'undefined') localStorage.setItem(HEIGHT_KEY, String(h));
        return h;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // One-shot: when runRecordId bumps (new run completed), flip to Results.
  // Tracks lastSeen id to ensure each bump only fires once — avoids the
  // controlled-tab two-way loop the previous design had.
  const lastSeenRunId = useRef<number | undefined>(runRecordId);
  useEffect(() => {
    if (runRecordId === undefined) return;
    if (lastSeenRunId.current !== runRecordId) {
      lastSeenRunId.current = runRecordId;
      setTab('results');
    }
  }, [runRecordId]);
  // Persist tab selection. No callback up — App doesn't need to mirror state,
  // which kills the loop that previously caused glitchy re-renders.
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, tab);
  }, [tab]);

  return (
    <div className="workspace-dock" style={{ height }}>
      <div
        className={`workspace-dock-resize${dragging ? ' dragging' : ''}`}
        onMouseDown={beginResize}
        title="Drag to resize"
        aria-label="Resize console panel"
        role="separator"
      />
      <div className="workspace-dock-tabs">
        <button
          type="button"
          className={`workspace-dock-tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          <History size={11} aria-hidden />
          <span>Tx History</span>
        </button>
        <button
          type="button"
          className={`workspace-dock-tab${tab === 'logs' ? ' active' : ''}`}
          onClick={() => setTab('logs')}
        >
          <FileText size={11} aria-hidden />
          <span>Logs</span>
        </button>
        <button
          type="button"
          className={`workspace-dock-tab${tab === 'results' ? ' active' : ''}${
            runRecord ? (runRecord.pass ? ' tone-ok' : ' tone-fail') : ''
          }`}
          onClick={() => setTab('results')}
          title={runRecord ? `${runRecord.name} · ${runRecord.subtitle}` : 'Run results'}
        >
          {runRecord ? (
            runRecord.pass ? (
              <CheckCircle2 size={11} aria-hidden />
            ) : (
              <XCircle size={11} aria-hidden />
            )
          ) : (
            <ListChecks size={11} aria-hidden />
          )}
          <span>Results</span>
          {runRecord && (
            <span className="workspace-dock-badge">{runRecord.pass ? 'OK' : 'FAIL'}</span>
          )}
        </button>
        <span className="workspace-dock-spacer" />
        <button
          type="button"
          className="workspace-dock-close"
          onClick={onClose}
          aria-label="Close bottom panel"
          title="Close (⌘J)"
        >
          <ChevronDown size={12} aria-hidden />
        </button>
      </div>
      <div className="workspace-dock-body">
        {tab === 'history' && <TxHistoryPanel activeSessionId={activeSessionId} />}
        {tab === 'logs' && <LogsTab activeSessionId={activeSessionId} />}
        {tab === 'results' && <ResultsTab record={runRecord ?? null} runId={runRecordId ?? 0} />}
      </div>
    </div>
  );
}

function ResultsTab({
  record,
  runId,
}: {
  record: RunRecord | null;
  runId: number;
}): JSX.Element {
  if (!record) {
    return (
      <div className="logs-empty">
        <ListChecks size={22} aria-hidden />
        <div className="logs-empty-title">No runs yet</div>
        <div className="logs-empty-sub">
          Click <span className="font-mono text-text">Run</span> on a workflow or test
          suite — results land here.
        </div>
      </div>
    );
  }
  return (
    <div className="results-tab" key={runId}>
      <div className={`results-tab-banner ${record.pass ? 'ok' : 'fail'}`}>
        <span className="results-tab-banner-icon" aria-hidden>
          {record.pass ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        </span>
        <div className="results-tab-banner-body">
          <span className="results-tab-banner-title">
            <span className="results-tab-banner-kind">
              {record.kind === 'workflow'
                ? 'Workflow'
                : record.kind === 'testSuite'
                  ? 'Test Suite'
                  : 'Tx Simulation'}
            </span>
            <span className="results-tab-banner-name">{record.name}</span>
          </span>
          <span className="results-tab-banner-sub">{record.subtitle}</span>
        </div>
        <span className={`results-tab-banner-pill ${record.pass ? 'ok' : 'fail'}`}>
          {record.pass ? 'PASS' : 'FAIL'}
        </span>
      </div>
      <div className="results-tab-body">{record.body}</div>
    </div>
  );
}

function LogsTab({ activeSessionId }: { activeSessionId: string | null }): JSX.Element {
  const [records, setRecords] = useState<TxRecord[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Default to "all" so user sees everything; flip to "latest" to focus on
  // just the most recent tx (the one they likely just submitted).
  const [scope, setScope] = useState<'all' | 'latest'>('all');

  useEffect(() => {
    if (!activeSessionId) {
      setRecords([]);
      return;
    }
    void api
      .call<TxRecord[]>('tx.history', { sessionId: activeSessionId })
      .then(setRecords)
      .catch((e) => setErr(String(e)));
  }, [activeSessionId]);

  const lines = useMemo<Array<{ ts: number; ok: boolean; pid: string; line: string }>>(() => {
    const out: Array<{ ts: number; ok: boolean; pid: string; line: string }> = [];
    const source = scope === 'latest' && records.length > 0
      ? [records[records.length - 1]!]
      : records.slice().reverse();
    for (const r of source) {
      for (const l of r.trace.logs) {
        if (query.trim() && !l.raw.toLowerCase().includes(query.toLowerCase())) continue;
        out.push({ ts: r.submittedAt, ok: r.success, pid: r.trace.programId, line: l.raw });
      }
    }
    return out;
  }, [records, query, scope]);

  if (!activeSessionId) {
    return (
      <div className="logs-empty">
        <FileText size={22} aria-hidden />
        <div className="logs-empty-title">No sandbox selected</div>
        <div className="logs-empty-sub">Pick a sandbox from the sidebar to stream its tx logs.</div>
      </div>
    );
  }

  return (
    <div className="logs-tab">
      <div className="logs-toolbar">
        <div className="logs-search">
          <FileText size={11} aria-hidden className="logs-search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter log lines…"
            className="logs-search-input"
          />
        </div>
        <div className="logs-scope-group" role="tablist" aria-label="Log scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'all'}
            className={`logs-scope${scope === 'all' ? ' active' : ''}`}
            onClick={() => setScope('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'latest'}
            className={`logs-scope${scope === 'latest' ? ' active' : ''}`}
            onClick={() => setScope('latest')}
            title="Show logs from the most recent tx only"
          >
            Latest
          </button>
        </div>
        <span className="logs-count">
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </span>
      </div>
      {err && <div className="logs-error font-mono">{err}</div>}
      {lines.length === 0 ? (
        <div className="logs-empty">
          <FileText size={22} aria-hidden />
          <div className="logs-empty-title">No logs yet</div>
          <div className="logs-empty-sub">
            Send a tx and the output streams here.
          </div>
        </div>
      ) : (
        <div className="logs-list font-mono">
          {lines.map((l, i) => (
            <div key={i} className={`logs-row ${l.ok ? 'ok' : 'err'}`}>
              <span className="logs-row-badge">{l.ok ? 'OK' : 'ERR'}</span>
              <span className="logs-row-line">{l.line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
