import {
  Activity as ActivityIcon,
  Check,
  Command,
  Copy,
  Globe,
  Network,
  Play,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Project, SessionMeta } from '../types';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Input,
  Kbd,
  Pubkey,
  Spinner,
} from '../ui';
import type { TraceNode } from './TxResultView';

export type InspectorTab = 'details' | 'activity' | 'shortcuts';

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

export function InspectorPane({
  project,
  sessions,
  activeSessionId,
  tab,
}: {
  project: Project | null;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  tab: InspectorTab;
}): JSX.Element {
  const [activity, setActivity] = useState<TxRecord[]>([]);

  useEffect(() => {
    if (tab !== 'activity' || !activeSessionId) {
      setActivity([]);
      return;
    }
    void api
      .call<TxRecord[]>('tx.history', { sessionId: activeSessionId })
      .then((list) => setActivity(list.slice(-10).reverse()))
      .catch(() => setActivity([]));
  }, [tab, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const accountCount = project
    ? Object.values(project.programs).reduce((n, p) => n + p.accounts.length, 0)
    : 0;

  const tabLabel = tab === 'details' ? 'Details' : tab === 'activity' ? 'Activity' : 'Shortcuts';

  return (
    <aside className="inspector">
      <div className="text-2xs uppercase tracking-widest text-text-subtle font-semibold pb-3 mb-3 border-b border-border">
        {tabLabel}
      </div>

      {tab === 'details' &&
        (project ? (
          <DetailsTab
            project={project}
            sessions={sessions}
            activeSession={activeSession ?? null}
            accountCount={accountCount}
          />
        ) : (
          <Empty size="sm" title="No project" description="Open or create one to inspect." />
        ))}

      {tab === 'activity' && (
        <ActivityTab activeSessionId={activeSessionId} activity={activity} />
      )}

      {tab === 'shortcuts' && <ShortcutsTab />}
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-2xs uppercase tracking-widest text-text-subtle font-semibold mb-2">
      {children}
    </div>
  );
}

function CopyChip({ value, label }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? <Check size={11} /> : <Copy size={11} />}
      label={label ?? `Copy ${value}`}
      size="sm"
      variant="ghost"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    />
  );
}

function DetailsTab({
  project,
  sessions,
  activeSession,
  accountCount,
}: {
  project: Project;
  sessions: SessionMeta[];
  activeSession: SessionMeta | null;
  accountCount: number;
}): JSX.Element {
  const [rpcStatus, setRpcStatus] = useState<{ running: boolean; port: number | null }>({
    running: false,
    port: null,
  });
  const [rpcPort, setRpcPort] = useState('8899');
  const [rpcBusy, setRpcBusy] = useState(false);
  const [rpcErr, setRpcErr] = useState<string | null>(null);

  const refreshRpc = (): void => {
    void api
      .call<{ running: boolean; port: number | null; host: string | null }>('rpcServer.status')
      .then((s) => setRpcStatus({ running: s.running, port: s.port }))
      .catch(() => setRpcStatus({ running: false, port: null }));
  };
  useEffect(refreshRpc, []);

  const startRpc = async (): Promise<void> => {
    setRpcBusy(true);
    setRpcErr(null);
    try {
      await api.call('rpcServer.start', { port: Number(rpcPort) || 8899 });
      refreshRpc();
    } catch (e) {
      setRpcErr(String(e));
    } finally {
      setRpcBusy(false);
    }
  };
  const stopRpc = async (): Promise<void> => {
    setRpcBusy(true);
    try {
      await api.call('rpcServer.stop');
      refreshRpc();
    } finally {
      setRpcBusy(false);
    }
  };

  const sessionUrl =
    rpcStatus.running && rpcStatus.port && activeSession
      ? `http://127.0.0.1:${rpcStatus.port}/session/${activeSession.id}`
      : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Project */}
      <section>
        <SectionTitle>Project</SectionTitle>
        <div className="text-sm font-medium text-text">{project.name}</div>
        <div className="mt-1">
          <Pubkey value={project.id} className="text-text-muted" />
        </div>
        {project.description && (
          <div className="mt-2 text-xs text-text-muted leading-relaxed">{project.description}</div>
        )}
      </section>

      {/* Network */}
      <section>
        <SectionTitle>Network</SectionTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge size="md" variant="default" className="font-mono">
            {project.network}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <span className="font-mono text-2xs text-text-subtle truncate min-w-0 flex-1">
            {project.rpcEndpointId}
          </span>
          <CopyChip value={project.rpcEndpointId} label="Copy RPC id" />
        </div>
      </section>

      {/* Counts */}
      <section>
        <SectionTitle>Counts</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="programs" value={Object.keys(project.programs).length} />
          <StatCard label="accounts" value={accountCount} />
          <StatCard label="sessions" value={sessions.length} />
          <StatCard label="patches" value={project.patches.length} />
        </div>
      </section>

      {/* Active session */}
      {activeSession && (
        <section>
          <SectionTitle>Active session</SectionTitle>
          <div className="text-sm font-medium text-text">{activeSession.name}</div>
          <div className="mt-1 text-2xs text-text-muted font-mono">
            {activeSession.accountCount} accounts · {activeSession.mutationCount} mutations
          </div>
        </section>
      )}

      {/* RPC server */}
      <section>
        <SectionTitle>RPC endpoint</SectionTitle>
        <div className="text-xs text-text-muted leading-relaxed mb-3">
          Expose the active session via Solana-compatible JSON-RPC. Point @solana/web3.js or
          anchor tests at the URL.
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span
            aria-hidden
            className={[
              'inline-block w-2 h-2 rounded-full',
              rpcStatus.running ? 'bg-success' : 'bg-text-subtle',
            ].join(' ')}
          />
          <span className="text-xs">
            {rpcStatus.running ? (
              <>
                running on{' '}
                <span className="font-mono">:{rpcStatus.port}</span>
              </>
            ) : (
              <span className="text-text-muted">stopped</span>
            )}
          </span>
        </div>

        <div className="flex items-end gap-2">
          <Field label="Port" className="w-24">
            <Input
              value={rpcPort}
              onChange={(e) => setRpcPort(e.target.value)}
              placeholder="8899"
              disabled={rpcStatus.running || rpcBusy}
              sizeVariant="sm"
            />
          </Field>
          {rpcStatus.running ? (
            <Button variant="danger" size="sm" disabled={rpcBusy} onClick={() => void stopRpc()}>
              {rpcBusy ? (
                <Spinner size={11} />
              ) : (
                <>
                  <Square size={11} aria-hidden /> Stop
                </>
              )}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={rpcBusy} onClick={() => void startRpc()}>
              {rpcBusy ? (
                <Spinner size={11} />
              ) : (
                <>
                  <Play size={11} aria-hidden /> Start
                </>
              )}
            </Button>
          )}
        </div>

        {rpcErr && (
          <div className="mt-2">
            <ErrorState title="RPC failed to start" message={rpcErr} />
          </div>
        )}

        {rpcStatus.running && rpcStatus.port && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <Globe size={11} className="text-text-muted" aria-hidden />
            <span className="font-mono text-text-muted truncate min-w-0 flex-1">
              http://127.0.0.1:{rpcStatus.port}
            </span>
            <CopyChip value={`http://127.0.0.1:${rpcStatus.port}`} label="Copy server URL" />
          </div>
        )}

        {sessionUrl && (
          <div className="mt-3">
            <SectionTitle>Session URL</SectionTitle>
            <div className="flex items-center gap-1 rounded border border-border bg-bg p-2">
              <Network size={11} className="text-text-muted shrink-0" aria-hidden />
              <span className="font-mono text-2xs text-text break-all flex-1 min-w-0">
                {sessionUrl}
              </span>
              <CopyChip value={sessionUrl} label="Copy session URL" />
            </div>
            <div className="mt-2 text-2xs text-text-subtle">
              Example:{' '}
              <code className="font-mono text-text-muted">
                new Connection(&quot;{sessionUrl}&quot;)
              </code>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded border border-border bg-surface-1 px-2.5 py-2">
      <div className="text-lg font-semibold leading-none text-text">{value}</div>
      <div className="mt-1 text-2xs uppercase tracking-wider text-text-subtle">{label}</div>
    </div>
  );
}

function ActivityTab({
  activeSessionId,
  activity,
}: {
  activeSessionId: string | null;
  activity: TxRecord[];
}): JSX.Element {
  const clear = async (): Promise<void> => {
    if (!activeSessionId) return;
    try {
      await api.call('tx.historyClear', { sessionId: activeSessionId });
    } catch {
      /* ignore */
    }
  };
  if (!activeSessionId) {
    return (
      <Empty
        size="sm"
        icon={<ActivityIcon size={18} aria-hidden />}
        title="No session selected"
        description="Pick a session in the sidebar to see its activity."
      />
    );
  }
  if (activity.length === 0) {
    return (
      <Empty
        size="sm"
        icon={<ActivityIcon size={18} aria-hidden />}
        title="No transactions yet"
        description="Use Tx Builder → Simulate or Submit to populate."
      />
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <SectionTitle>Recent transactions</SectionTitle>
        <Button variant="ghost" size="xs" onClick={() => void clear()} title="Clear activity">
          <Trash2 size={11} aria-hidden /> clear
        </Button>
      </div>

      <ul className="flex flex-col gap-1">
        {activity.map((tx) => (
          <li
            key={tx.id}
            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-1/50"
          >
            <div className="flex items-center gap-2 min-w-0">
              {tx.success ? (
                <Check size={12} className="text-success shrink-0" aria-label="success" />
              ) : (
                <XCircle size={12} className="text-danger shrink-0" aria-label="failure" />
              )}
              <Pubkey value={tx.trace.programId} className="text-text-muted" />
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-2xs text-text-muted">
                cu {tx.cuConsumed.toString()}
              </div>
              <div className="font-mono text-2xs text-text-subtle">
                {new Date(tx.submittedAt).toISOString().slice(11, 19)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShortcutsTab(): JSX.Element {
  const shortcuts: Array<{ keys: string; what: string }> = [
    { keys: '⌘K', what: 'Open command palette' },
    { keys: '⌘B', what: 'Toggle left sidebar' },
    { keys: '⌘⌥B', what: 'Toggle right inspector' },
    { keys: 'Right-click', what: 'Show actions for project / program / account / session' },
    { keys: 'Click account', what: 'Open Inspector modal' },
    { keys: 'Click session', what: 'Set as active session' },
    { keys: 'Click program', what: 'Expand / collapse accounts' },
    { keys: 'Esc', what: 'Close modal' },
    { keys: 'Enter', what: 'Submit prompt' },
    { keys: 'Drag sidebar edge', what: 'Resize left sidebar' },
  ];
  const concepts: Array<{ title: string; body: string }> = [
    {
      title: 'Simulate vs Submit',
      body: 'Simulate runs read-only — no state change. Submit persists state + appends to tx history. Both produce logs + trace.',
    },
    {
      title: 'Patch scopes',
      body: 'Project patches apply to every session. Session patches apply to one session. Eval order: project → session.',
    },
    {
      title: 'Built-in programs',
      body: 'SPL Token / Token-2022 / Memo / System / ATA / Compute Budget / ALT are in LiteSVM — attach with zero clone cost.',
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Command size={11} aria-hidden /> Shortcuts
          </span>
        </SectionTitle>
        <ul className="flex flex-col gap-1">
          {shortcuts.map((s) => (
            <li key={s.keys} className="flex items-center gap-3 py-1 text-xs">
              <Kbd className="shrink-0">{s.keys}</Kbd>
              <span className="text-text-muted flex-1 min-w-0">{s.what}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <SectionTitle>Concepts</SectionTitle>
        <div className="flex flex-col gap-3">
          {concepts.map((c) => (
            <div key={c.title}>
              <div className="text-xs font-medium text-text">{c.title}</div>
              <div className="text-xs text-text-muted mt-0.5 leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

