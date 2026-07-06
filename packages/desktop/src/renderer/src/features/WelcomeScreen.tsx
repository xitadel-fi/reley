import {
  Clock,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitCompare,
  History as HistoryIcon,
  Pin,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Empty,
  Field,
  Input,
  Kbd,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '../ui';

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

interface RpcEndpoint {
  id: string;
  label: string;
  url: string;
  network: string;
}

const isMac = api.platform === 'darwin';
const cmdKey = isMac ? '⌘' : 'Ctrl';

function formatRelative(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function networkBadgeVariant(net: string): 'success' | 'warning' | 'accent' | 'default' {
  if (net === 'mainnet-beta') return 'success';
  if (net === 'devnet') return 'warning';
  if (net === 'testnet') return 'accent';
  return 'default';
}

export function WelcomeScreen(): JSX.Element {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [rpcEndpoints, setRpcEndpoints] = useState<RpcEndpoint[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNetwork, setNewNetwork] = useState<'mainnet-beta' | 'devnet' | 'testnet'>(
    'mainnet-beta',
  );
  const [newRpc, setNewRpc] = useState<string>('mainnet-public');
  const toast = useToast();
  const dialogs = useDialogs();

  const reload = async (): Promise<void> => {
    try {
      const [r, e] = await Promise.all([
        api.call<RecentProject[]>('app.recentProjects'),
        api.call<RpcEndpoint[]>('app.rpcEndpoints'),
      ]);
      setRecents(r);
      setRpcEndpoints(e);
      if (e[0] && !e.find((ep) => ep.id === newRpc)) setNewRpc(e[0].id);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoadingRecents(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Welcome intro cards ("What is Reley?" + "Try the demo") auto-hide after
  // 5 launches so returning users get straight to recents. User can also
  // manually dismiss earlier via the × button.
  const [introVisible, setIntroVisible] = useState<boolean>(true);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('relay:welcome-intro-dismissed') === '1') {
      setIntroVisible(false);
      return;
    }
    const opens = Number(localStorage.getItem('relay:welcome-open-count') ?? '0') + 1;
    localStorage.setItem('relay:welcome-open-count', String(opens));
    if (opens > 5) {
      setIntroVisible(false);
      localStorage.setItem('relay:welcome-intro-dismissed', '1');
    }
  }, []);

  // System-menu hook — View → "Show Welcome Intro Again" clears the flag +
  // forces the intro back on for the current Welcome window. Also handles
  // "Import Project from .zip" so users can import without an open project.
  useEffect(() => {
    return api.onMenu?.((cmd) => {
      if (cmd === 'show-welcome-intro') restoreIntro();
      if (cmd === 'import-project') {
        void api.call('app.importProjectZip', {}).catch((e: unknown) => {
          console.error('import failed', e);
        });
      }
    });
  }, []);
  const dismissIntro = (): void => {
    setIntroVisible(false);
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('relay:welcome-intro-dismissed', '1');
  };
  const restoreIntro = (): void => {
    setIntroVisible(true);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('relay:welcome-intro-dismissed');
      localStorage.setItem('relay:welcome-open-count', '0');
    }
  };

  const filteredRpcs = useMemo(
    () => rpcEndpoints.filter((r) => r.network === newNetwork),
    [rpcEndpoints, newNetwork],
  );

  useEffect(() => {
    if (filteredRpcs.length === 0) return;
    if (!filteredRpcs.find((r) => r.id === newRpc)) setNewRpc(filteredRpcs[0]!.id);
  }, [filteredRpcs, newRpc]);

  const openPicker = async (): Promise<void> => {
    try {
      const r = await api.call<{ canceled?: boolean; path?: string }>('app.openProjectPicker');
      if (!r.canceled) await reload();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const submitNew = async (): Promise<void> => {
    if (!newName.trim()) {
      toast.error('Project name required');
      return;
    }
    setCreating(true);
    try {
      await api.call('app.newProjectPicker', {
        name: newName.trim(),
        network: newNetwork,
        rpcEndpointId: newRpc,
      });
      setSheetOpen(false);
      setNewName('');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setCreating(false);
    }
  };

  const openRecent = async (p: RecentProject): Promise<void> => {
    try {
      await api.call('app.openProjectByPath', { path: p.path });
    } catch (err) {
      toast.error(String(err));
      await reload();
    }
  };

  const removeRecent = async (p: RecentProject): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Remove from recents?',
      message: `${p.name} (${p.path})`,
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await api.call('app.removeRecent', { path: p.path });
      await reload();
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-bg text-text">
      {/* drag region */}
      <div
        className="shrink-0 h-7"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-10 pt-16 pb-20">
          {/* Primary actions */}
          <section className="mb-14">
            <div className="text-2xs uppercase tracking-widest text-text-subtle font-semibold mb-4">
              Get started
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                size="lg"
                variant="primary"
                onClick={() => void openPicker()}
                className="gap-2 min-w-[180px] justify-start"
              >
                <FolderOpen size={15} aria-hidden />
                <span className="flex-1 text-left">Open Project…</span>
                <Kbd className="ml-1 bg-white/15 border-white/25 text-white/90">{cmdKey}O</Kbd>
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setSheetOpen(true)}
                className="gap-2 min-w-[180px] justify-start"
              >
                <FolderPlus size={15} aria-hidden />
                <span className="flex-1 text-left">New Project…</span>
              </Button>
            </div>
          </section>

          {introVisible && (
            <section className="mb-10 relative">
              <button
                type="button"
                onClick={dismissIntro}
                className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded text-text-subtle hover:text-text hover:bg-surface-1"
                title="Hide intro (auto-hides after 5 launches anyway)"
                aria-label="Hide intro"
              >
                ×
              </button>
              <div className="rounded-lg border border-border bg-surface-0 p-4 mb-3">
                <div className="text-sm font-medium text-text mb-1">
                  What is Reley?
                </div>
                <div className="text-xs text-text-muted leading-relaxed">
                  A local Solana sandbox + tx builder. Clone programs and accounts
                  from chain, mutate state via patches, chain transactions in
                  workflows, assert behavior with test suites, and replay mainnet
                  transactions — all offline. Start with the demo if you've
                  never used it.
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.call('app.newDemoProject');
                  } catch (e) {
                    toast.error(String(e));
                  }
                }}
                className={[
                  'w-full text-left rounded-lg border border-accent/30 bg-accent/5 p-4',
                  'hover:border-accent hover:bg-accent/10 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex items-center justify-center w-10 h-10 rounded bg-accent/20 text-accent shrink-0"
                    aria-hidden
                  >
                    <FlaskConical size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text">
                      Try the demo — zero setup
                    </div>
                    <div className="text-2xs text-text-muted mt-0.5 leading-relaxed">
                      Spins up a fresh project with SPL Token, Token-2022, ATA, System programs
                      pre-attached, a funded default-payer keypair, and a sandbox ready for
                      txs. Lands in <code className="font-mono">~/Documents/Reley/</code>.
                    </div>
                  </div>
                  <span className="text-2xs text-accent shrink-0 font-mono">→</span>
                </div>
              </button>
            </section>
          )}
          {/* Hidden intro can be brought back via the system menu:
              View → "Show Welcome Intro Again". No inline restore link to
              keep the recents view clean. */}

          {/* Recents — surfaced above the concept tiles since returning users
              jump straight to one of their existing projects. */}
          <section className="mb-14">
            <div className="flex items-baseline justify-between mb-4">
              <div className="text-2xs uppercase tracking-widest text-text-subtle font-semibold">
                Recent projects
              </div>
              {recents.length > 0 && (
                <div className="text-2xs text-text-subtle font-mono">
                  {recents.length}
                </div>
              )}
            </div>

            {loadingRecents ? (
              <div className="py-10 flex justify-center">
                <Spinner label="Loading recents…" />
              </div>
            ) : recents.length === 0 ? (
              <Empty
                icon={<Clock size={24} aria-hidden />}
                title="No recent projects"
                description="Open or create a project to get started."
                action={
                  <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
                    Create your first
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col rounded-lg border border-border overflow-hidden divide-y divide-border">
                {recents.map((r) => (
                  <li key={r.path}>
                    <RecentRow
                      project={r}
                      onOpen={() => void openRecent(r)}
                      onRemove={() => void removeRecent(r)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* What can Reley do? — three concept tiles. Click any to open the
              new-project sheet preloaded with that intent so the goal picker
              inside the project lands on the right tab. */}
          <section>
            <div className="text-2xs uppercase tracking-widest text-text-subtle font-semibold mb-4">
              What can Reley do?
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <UseCaseTile
                icon={<FlaskConical size={18} aria-hidden />}
                title="Test a program"
                description="Multi-case test suites with per-step expectations on tx outcome + account state. Never halts on tx fail."
                onClick={() => setSheetOpen(true)}
              />
              <UseCaseTile
                icon={<GitCompare size={18} aria-hidden />}
                title="Compare V1 vs V2"
                description="Pin two program versions to one sandbox. Diff CU, logs, decoded state side-by-side."
                onClick={() => setSheetOpen(true)}
              />
              <UseCaseTile
                icon={<HistoryIcon size={18} aria-hidden />}
                title="Replay a mainnet tx"
                description="Paste a signature → auto-clone deps → patch state → re-run locally."
                onClick={() => setSheetOpen(true)}
              />
            </div>
          </section>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface-0/60 backdrop-blur-md">
        <div className="mx-auto w-full max-w-3xl px-10 py-3 flex items-center justify-between text-2xs">
          <span className="text-text-subtle">
            SVM sandbox for Solana programs
          </span>
          <a
            href="https://xitadel.fi"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 text-text-muted hover:text-text transition-colors"
            title="Reley is built by Xitadel"
          >
            <span
              className="text-text-subtle group-hover:text-accent transition-colors"
              style={{ letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}
            >
              Built by
            </span>
            <span
              style={{
                fontFamily: 'Satoshi, Figtree, sans-serif',
                fontWeight: 900,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              Xitadel
            </span>
            <span className="text-accent">↗</span>
          </a>
        </div>
      </div>

      {/* New project sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[460px] gap-5">
          <SheetHeader>
            <SheetTitle>New project</SheetTitle>
            <SheetDescription>
              Reley writes <code className="font-mono text-text">.reley.json</code> +{' '}
              <code className="font-mono text-text">.reley/</code> in the folder you pick.
            </SheetDescription>
          </SheetHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNew();
            }}
          >
            <Field label="Project name" required htmlFor="welcome-name">
              <Input
                id="welcome-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-program-sandbox"
                autoFocus
                sizeVariant="lg"
              />
            </Field>

            <Field label="Network" htmlFor="welcome-network">
              <Select
                id="welcome-network"
                value={newNetwork}
                sizeVariant="lg"
                onChange={(e) => setNewNetwork(e.target.value as typeof newNetwork)}
              >
                <option value="mainnet-beta">mainnet-beta</option>
                <option value="devnet">devnet</option>
                <option value="testnet">testnet</option>
              </Select>
            </Field>

            <Field
              label="RPC endpoint"
              htmlFor="welcome-rpc"
              help={
                filteredRpcs.length === 0
                  ? 'No endpoints registered for this network yet.'
                  : undefined
              }
            >
              <Select
                id="welcome-rpc"
                value={newRpc}
                sizeVariant="lg"
                onChange={(e) => setNewRpc(e.target.value)}
                disabled={filteredRpcs.length === 0}
              >
                {filteredRpcs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setSheetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={creating || !newName.trim()}>
                {creating ? (
                  <>
                    <Spinner size={12} /> Creating…
                  </>
                ) : (
                  'Pick folder & create'
                )}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function UseCaseTile({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex flex-col gap-2 text-left rounded-md border border-border bg-surface-0 p-4',
        'hover:border-accent hover:bg-accent/5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
      ].join(' ')}
    >
      <span
        className="inline-flex items-center justify-center w-8 h-8 rounded bg-accent/15 text-accent shrink-0"
        aria-hidden
      >
        {icon}
      </span>
      <div className="font-medium text-sm text-text">{title}</div>
      <div className="text-2xs text-text-muted leading-relaxed">{description}</div>
    </button>
  );
}

function RecentRow({
  project,
  onOpen,
  onRemove,
}: {
  project: RecentProject;
  onOpen: () => void;
  onRemove: () => void;
}): JSX.Element {
  const [meta, setMeta] = useState<{ network?: string; pinned?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await api.call<{ network?: string; pinned?: boolean } | null>(
          'app.recentProjectMeta',
          { path: project.path },
        );
        if (!cancelled) setMeta(m ?? null);
      } catch {
        /* optional endpoint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.path]);

  return (
    <div
      className={[
        'group relative flex items-stretch',
        'bg-transparent hover:bg-surface-1 transition-colors duration-fast ease-out',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 min-w-0 items-center gap-3 text-left bg-transparent border-0 pl-4 pr-3 py-3 focus-visible:outline-none"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-1 text-text-muted group-hover:bg-surface-2 group-hover:text-text transition-colors">
          <FolderOpen size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-text truncate">{project.name}</span>
            {meta?.network && (
              <Badge size="sm" variant={networkBadgeVariant(meta.network)}>
                {meta.network}
              </Badge>
            )}
            {meta?.pinned && <Pin size={11} className="text-accent" aria-label="pinned" />}
          </div>
          <div className="text-2xs text-text-subtle font-mono truncate mt-0.5">{project.path}</div>
        </div>
        <span className="text-2xs text-text-subtle whitespace-nowrap ml-2 shrink-0">
          {formatRelative(project.lastOpened)}
        </span>
      </button>
      <button
        type="button"
        aria-label="Remove from recents"
        title="Remove from recents"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={[
          'shrink-0 inline-flex items-center justify-center w-11 border-l border-border/60',
          'text-text-subtle hover:text-danger hover:bg-danger/10',
          'transition-colors duration-fast ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70',
        ].join(' ')}
      >
        <Trash2 size={15} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

