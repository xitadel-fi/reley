import { ChevronRight, Cog, FolderCog, Palette, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  useTheme,
} from '../ui';

type Group = 'app-appearance' | 'app-defaults' | 'project-general' | 'project-network';

interface GroupDef {
  id: Group;
  scope: 'app' | 'project';
  label: string;
  icon: JSX.Element;
}

const GROUPS: GroupDef[] = [
  { id: 'app-appearance', scope: 'app', label: 'Appearance', icon: <Palette size={13} /> },
  { id: 'app-defaults', scope: 'app', label: 'Defaults', icon: <Cog size={13} /> },
  { id: 'project-general', scope: 'project', label: 'General', icon: <FolderCog size={13} /> },
  { id: 'project-network', scope: 'project', label: 'Network & RPC', icon: <FolderCog size={13} /> },
];

interface RpcEndpoint {
  id: string;
  label: string;
  url: string;
  network: string;
  isDefault?: boolean;
}

interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  network: string;
  rpcEndpointId: string;
  autoCloneEnabled?: boolean;
}

export function SettingsPanel(): JSX.Element {
  const [active, setActive] = useState<Group>('app-appearance');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.filter((g) => g.label.toLowerCase().includes(q));
  }, [query]);

  const activeGroup = GROUPS.find((g) => g.id === active);

  return (
    <div className="panel flex flex-col p-0 min-h-[640px]">
      <header className="px-4 py-3 border-b border-border">
        <h2 className="m-0 text-md font-semibold">Settings</h2>
        <div className="text-xs text-text-muted mt-0.5">
          App-level options persist globally. Project-level options live in this
          project's <code className="font-mono">.reley.json</code>.
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 border-r border-border bg-surface-0 flex flex-col">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search
                size={11}
                aria-hidden
                className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings"
                sizeVariant="sm"
                className="pl-7"
              />
            </div>
          </div>

          <nav className="flex-1 overflow-auto py-1">
            {(['app', 'project'] as const).map((scope) => {
              const groups = filtered.filter((g) => g.scope === scope);
              if (groups.length === 0) return null;
              return (
                <div key={scope} className="mb-1">
                  <div className="px-3 py-1 text-2xs uppercase tracking-widest text-text-subtle font-semibold">
                    {scope === 'app' ? 'App settings' : 'Project settings'}
                  </div>
                  {groups.map((g) => {
                    const isActive = g.id === active;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setActive(g.id)}
                        className={[
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                          'transition-colors duration-fast',
                          isActive
                            ? 'bg-surface-2 text-text'
                            : 'text-text-muted hover:bg-surface-1 hover:text-text',
                        ].join(' ')}
                      >
                        <span className="text-text-subtle">{g.icon}</span>
                        <span className="flex-1 min-w-0 truncate">{g.label}</span>
                        {isActive && <ChevronRight size={11} className="text-text-subtle" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <Empty size="sm" title="No matches" description="Try a different search." />
            )}
          </nav>
        </aside>

        <section className="flex-1 overflow-auto p-6">
          {!activeGroup ? (
            <Empty size="sm" title="Pick a group" />
          ) : activeGroup.id === 'app-appearance' ? (
            <AppearanceGroup />
          ) : activeGroup.id === 'app-defaults' ? (
            <DefaultsGroup />
          ) : activeGroup.id === 'project-general' ? (
            <ProjectGeneralGroup />
          ) : (
            <ProjectNetworkGroup />
          )}
        </section>
      </div>
    </div>
  );
}

// ───────── App: Appearance ─────────

function AppearanceGroup(): JSX.Element {
  const { theme, setTheme } = useTheme();
  return (
    <GroupShell title="Appearance" description="How the app looks. Persists across windows.">
      <SettingRow
        label="Theme"
        description="Switch between dark and light. Stored in browser localStorage."
      >
        <Select
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
          className="max-w-[200px]"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </Select>
      </SettingRow>
    </GroupShell>
  );
}

// ───────── App: Defaults ─────────

function DefaultsGroup(): JSX.Element {
  const [endpoints, setEndpoints] = useState<RpcEndpoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<RpcEndpoint[]>('app.rpcEndpoints')
      .then(setEndpoints)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <GroupShell title="Defaults" description="Defaults applied when creating new projects.">
      {err && <ErrorState title="Failed to load endpoints" message={err} />}
      <SettingRow
        label="RPC endpoints"
        description="Endpoints offered when picking a network in the New Project flow."
      >
        {!endpoints ? (
          <Spinner label="Loading…" />
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Label</th>
                  <th className="text-left font-medium px-3 py-1.5">URL</th>
                  <th className="text-left font-medium px-3 py-1.5">Network</th>
                  <th className="text-left font-medium px-3 py-1.5 w-16">Default</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-1.5 text-text">{e.label}</td>
                    <td className="px-3 py-1.5 font-mono text-2xs text-text-muted truncate max-w-[280px]">
                      {e.url}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge size="sm" variant="default">
                        {e.network}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-text-muted">{e.isDefault ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingRow>
    </GroupShell>
  );
}

// ───────── Project: General ─────────

function ProjectGeneralGroup(): JSX.Element {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [autoClone, setAutoClone] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const reload = async (): Promise<void> => {
    setErr(null);
    try {
      const list = await api.call<ProjectMeta[]>('project.list');
      const p = list[0];
      if (!p) {
        setProject(null);
        return;
      }
      const full = await api.call<ProjectMeta>('project.open', { id: p.id });
      setProject(full);
      setName(full.name);
      setDescription(full.description ?? '');
      setAutoClone(full.autoCloneEnabled !== false);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const dirty = project && (name !== project.name || description !== (project.description ?? ''));

  const save = async (): Promise<void> => {
    if (!project) return;
    setSaving(true);
    try {
      if (name !== project.name) {
        await api.call('project.rename', { id: project.id, name });
      }
      // description not in current API; future endpoint. Skip silently.
      await reload();
      toast.success('Project updated');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GroupShell title="General" description="Project metadata stored in .reley.json.">
      {err && <ErrorState title="Failed to load project" message={err} />}
      {!project ? (
        <Empty size="sm" title="No project loaded" />
      ) : (
        <>
          <SettingRow label="Project name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </SettingRow>
          <SettingRow label="Description" description="Free-form notes about the project.">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </SettingRow>
          <SettingRow label="Project ID" description="Stable UUID — read-only.">
            <Input value={project.id} readOnly className="font-mono" />
          </SettingRow>
          <SettingRow
            label="Auto-clone missing accounts"
            description="On tx submit, fetch any referenced accounts + programs not yet in the sandbox from the project's RPC. Disable for hermetic sandboxes that should fail explicitly."
          >
            <label className="autoclone-toggle">
              <input
                type="checkbox"
                checked={autoClone}
                onChange={async (e) => {
                  const next = e.target.checked;
                  setAutoClone(next);
                  try {
                    await api.call('project.setAutoClone', {
                      id: project.id,
                      enabled: next,
                    });
                    toast.success(`Auto-clone ${next ? 'enabled' : 'disabled'}`);
                  } catch (err) {
                    setAutoClone(!next);
                    toast.error(String(err));
                  }
                }}
              />
              <span>{autoClone ? 'Enabled' : 'Disabled'}</span>
            </label>
          </SettingRow>
          <div className="pt-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <Spinner size={11} /> : 'Save changes'}
            </Button>
          </div>
        </>
      )}
    </GroupShell>
  );
}

// ───────── Project: Network ─────────

function ProjectNetworkGroup(): JSX.Element {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [endpoints, setEndpoints] = useState<RpcEndpoint[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [list, eps] = await Promise.all([
          api.call<ProjectMeta[]>('project.list'),
          api.call<RpcEndpoint[]>('app.rpcEndpoints'),
        ]);
        setEndpoints(eps);
        const p = list[0];
        if (p) {
          const full = await api.call<ProjectMeta>('project.open', { id: p.id });
          setProject(full);
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  return (
    <GroupShell title="Network & RPC" description="Which chain and endpoint this project clones from.">
      {err && <ErrorState title="Failed to load" message={err} />}
      {!project ? (
        <Empty size="sm" title="No project loaded" />
      ) : (
        <>
          <SettingRow label="Network" description="Read-only — set at project creation.">
            <Input value={project.network} readOnly className="font-mono max-w-[240px]" />
          </SettingRow>
          <SettingRow label="RPC endpoint id" description="Resolves to a URL via the App → Defaults registry.">
            <Input value={project.rpcEndpointId} readOnly className="font-mono max-w-[280px]" />
          </SettingRow>
          {endpoints.find((e) => e.id === project.rpcEndpointId) && (
            <SettingRow label="Resolved URL" description="Live URL the worker hits.">
              <Input
                value={endpoints.find((e) => e.id === project.rpcEndpointId)?.url ?? ''}
                readOnly
                className="font-mono"
              />
            </SettingRow>
          )}
        </>
      )}
    </GroupShell>
  );
}

// ───────── Shells ─────────

function GroupShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <header>
        <h3 className="m-0 text-md font-semibold">{title}</h3>
        {description && <div className="mt-1 text-xs text-text-muted">{description}</div>}
      </header>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Field label={label} help={description}>
      {children}
    </Field>
  );
}
