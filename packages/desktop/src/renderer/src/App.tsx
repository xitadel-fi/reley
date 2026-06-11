import {
  Activity,
  Camera,
  ChevronDown,
  ChevronRight,
  Command,
  EyeOff,
  FolderOpen,
  History,
  Info,
  KeyRound,
  LayoutGrid,
  LayoutList,
  ListTree,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { ContextMenu, type MenuItem, useContextMenu } from './components/ContextMenu';
import { Modal } from './components/Modal';
import { ConfirmModal, PromptModal, type PromptOptions } from './components/PromptModal';
import { useToast } from './components/Toast';
import { Badge, Button, IconButton, Input, Kbd, Pubkey, useTheme } from './ui';
import { AccountInspector } from './features/AccountInspector';
import { AddAccountForm } from './features/AddAccountForm';
import { AddProgramForm } from './features/AddProgramForm';
import { AttachIdlForm } from './features/AttachIdlForm';
import { InspectorPane, type InspectorTab } from './features/InspectorPane';
import { KeypairsPanel } from './features/KeypairsPanel';
import { NewSessionForm } from './features/NewSessionForm';
import { PatchAccountForm } from './features/PatchAccountForm';
import { ReplayPanel } from './features/ReplayPanel';
import { SnapshotsPanel } from './features/SnapshotsPanel';
import { TxBuilderPanel } from './features/TxBuilderPanel';
import { FileEditor } from './features/FileEditor';
import { FilesTree } from './features/FilesTree';
import { TxHistoryPanel } from './features/TxHistoryPanel';
import { WorkflowsPanel } from './features/WorkflowsPanel';
import type { Project, ProgramEntry, ProjectMeta, SessionMeta } from './types';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_STORAGE_KEY = 'relay:sidebar-width';

function useSidebarWidth(): [number, (n: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SIDEBAR_STORAGE_KEY) : null;
    const n = raw ? Number(raw) : 280;
    return Number.isFinite(n) && n >= SIDEBAR_MIN ? Math.min(n, SIDEBAR_MAX) : 280;
  });
  const persist = useCallback((n: number) => {
    setWidth(n);
    if (typeof localStorage !== 'undefined') localStorage.setItem(SIDEBAR_STORAGE_KEY, String(n));
  }, []);
  return [width, persist];
}

type NavView = 'workspace' | 'replay' | 'snapshots' | 'keypairs';
type WorkspaceTab = 'builder' | 'workflows' | 'history' | 'patches';
type SidebarMode = 'project' | 'files';

interface PromptState {
  options: PromptOptions;
  onConfirm: (value: string) => void;
}
interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  confirmText?: string;
  onConfirm: () => void;
}

export function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [navView, setNavView] = useState<NavView>('workspace');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('builder');

  const [modal, setModal] = useState<
    | 'newSession'
    | 'addProgram'
    | 'addAccount'
    | 'attachIdl'
    | 'patchAccount'
    | 'inspectAccount'
    | null
  >(null);
  const [pendingProgramId, setPendingProgramId] = useState<string | null>(null);
  const [pendingAccountAddress, setPendingAccountAddress] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    if (typeof localStorage === 'undefined') return 'project';
    return (localStorage.getItem('relay:sidebar-mode') as SidebarMode) || 'project';
  });
  const switchSidebarMode = useCallback((m: SidebarMode) => {
    setSidebarMode(m);
    if (typeof localStorage !== 'undefined') localStorage.setItem('relay:sidebar-mode', m);
  }, []);
  const [openedFiles, setOpenedFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const openFileTab = useCallback((path: string) => {
    setOpenedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
  }, []);
  const closeFileTab = useCallback((path: string) => {
    setOpenedFiles((prev) => {
      const idx = prev.indexOf(path);
      if (idx < 0) return prev;
      const next = prev.filter((p) => p !== path);
      setActiveFile((cur) => {
        if (cur !== path) return cur;
        return next[idx] ?? next[idx - 1] ?? null;
      });
      return next;
    });
  }, []);

  const [programsView, setProgramsView] = useState<'tree' | 'list'>(() => {
    if (typeof localStorage === 'undefined') return 'tree';
    return (localStorage.getItem('relay:programs-view') as 'tree' | 'list') || 'tree';
  });
  const toggleProgramsView = useCallback(() => {
    setProgramsView((v) => {
      const next = v === 'tree' ? 'list' : 'tree';
      if (typeof localStorage !== 'undefined') localStorage.setItem('relay:programs-view', next);
      return next;
    });
  }, []);
  const [idlAttached, setIdlAttached] = useState<Set<string>>(new Set());
  const [hiddenPrograms, setHiddenPrograms] = useState<Set<string>>(new Set());
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [programsSectionOpen, setProgramsSectionOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('relay:section-programs') !== '0';
  });
  const [sessionsSectionOpen, setSessionsSectionOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('relay:section-sessions') !== '0';
  });
  const toggleProgramsSection = useCallback(() => {
    setProgramsSectionOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-programs', next ? '1' : '0');
      return next;
    });
  }, []);
  const toggleSessionsSection = useCallback(() => {
    setSessionsSectionOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-sessions', next ? '1' : '0');
      return next;
    });
  }, []);

  const hiddenKey = activeProjectId ? `relay:hidden-programs:${activeProjectId}` : null;

  useEffect(() => {
    if (!hiddenKey) {
      setHiddenPrograms(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(hiddenKey);
      setHiddenPrograms(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setHiddenPrograms(new Set());
    }
  }, [hiddenKey]);

  const setHidden = useCallback(
    (programId: string, hide: boolean) => {
      if (!hiddenKey) return;
      setHiddenPrograms((prev) => {
        const next = new Set(prev);
        if (hide) next.add(programId);
        else next.delete(programId);
        localStorage.setItem(hiddenKey, JSON.stringify([...next]));
        return next;
      });
    },
    [hiddenKey],
  );

  const ctx = useContextMenu();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:left-collapsed') === '1';
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:right-collapsed') === '1';
  });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    if (typeof localStorage === 'undefined') return 'details';
    const v = localStorage.getItem('relay:inspector-tab') as InspectorTab | null;
    return v ?? 'details';
  });
  const updateInspectorTab = useCallback((t: InspectorTab) => {
    setInspectorTab(t);
    if (typeof localStorage !== 'undefined') localStorage.setItem('relay:inspector-tab', t);
  }, []);

  const toggleLeft = useCallback(() => {
    setLeftCollapsed((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:left-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);
  const toggleRight = useCallback(() => {
    setRightCollapsed((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:right-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Keyboard: Ctrl/Cmd + B toggle left, Ctrl/Cmd + Alt + B toggle right
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (e.altKey) toggleRight();
        else toggleLeft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleLeft, toggleRight]);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return;
      const rail = 56;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - rail));
      setSidebarWidth(next);
    };
    const onUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setSidebarWidth]);

  const beginDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const reloadProjects = useCallback(async () => {
    try {
      const list = await api.call<ProjectMeta[]>('project.list');
      setProjects(list);
      if (!activeProjectId && list.length > 0) {
        const first = list[0];
        if (first) setActiveProjectId(first.id);
      }
      if (activeProjectId && !list.some((p) => p.id === activeProjectId)) {
        setActiveProjectId(list[0]?.id ?? null);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [activeProjectId]);

  const reloadProject = useCallback(async (id: string) => {
    try {
      const project = await api.call<Project>('project.open', { id });
      setActiveProject(project);
      const sess = await api.call<SessionMeta[]>('session.list', { projectId: id });
      setSessions(sess);
      const idls = await api.call<Array<{ programId: string }>>('idl.list');
      setIdlAttached(new Set(idls.map((i) => i.programId)));
      setExpandedPrograms((prev) => {
        if (prev.size === 0) return new Set(Object.keys(project.programs));
        return prev;
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  useEffect(() => {
    if (activeProjectId) void reloadProject(activeProjectId);
    else setActiveProject(null);
  }, [activeProjectId, reloadProject]);

  const safeCall = useCallback(
    async (fn: () => Promise<unknown>, successMsg?: string) => {
      try {
        await fn();
        if (successMsg) toast.success(successMsg);
      } catch (e) {
        const msg = String(e);
        setError(msg);
        toast.error(msg);
      }
    },
    [toast],
  );

  // ⌘K / Ctrl-K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Build palette items
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    // Views
    const views: Array<{ id: NavView; label: string; shortcut?: string }> = [
      { id: 'workspace', label: 'Workspace' },
      { id: 'replay', label: 'Replay' },
      { id: 'snapshots', label: 'Snapshots' },
      { id: 'keypairs', label: 'Keypairs' },
    ];
    for (const v of views) {
      items.push({
        id: `view:${v.id}`,
        group: 'View',
        label: v.label,
        onSelect: () => setNavView(v.id),
      });
    }

    // Workspace tabs
    const tabs: Array<{ id: WorkspaceTab; label: string }> = [
      { id: 'builder', label: 'Tx Builder' },
      { id: 'workflows', label: 'Workflows' },
      { id: 'history', label: 'Tx History' },
      { id: 'patches', label: 'Patches' },
    ];
    for (const t of tabs) {
      items.push({
        id: `tab:${t.id}`,
        group: 'Workspace',
        label: `Open ${t.label}`,
        onSelect: () => {
          setNavView('workspace');
          setWorkspaceTab(t.id);
        },
      });
    }

    // Commands
    items.push(
      {
        id: 'cmd:new-project',
        group: 'Command',
        label: 'New project…',
        onSelect: () => void api.call('app.showWelcome'),
      },
      {
        id: 'cmd:new-session',
        group: 'Command',
        label: 'New session…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && setModal('newSession'),
      },
      {
        id: 'cmd:add-program',
        group: 'Command',
        label: 'Add program…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && setModal('addProgram'),
      },
    );

    // Projects
    for (const p of projects) {
      items.push({
        id: `project:${p.id}`,
        group: 'Project',
        label: p.name,
        hint: p.network,
        onSelect: () => setActiveProjectId(p.id),
      });
    }

    // Sessions
    for (const s of sessions) {
      items.push({
        id: `session:${s.id}`,
        group: 'Session',
        label: s.name,
        hint: `${s.accountCount} accts`,
        onSelect: () => {
          setActiveSessionId(s.id);
          setNavView('workspace');
        },
      });
    }

    // Programs in active project
    if (activeProject) {
      for (const prog of Object.values(activeProject.programs)) {
        items.push({
          id: `program:${prog.programId}`,
          group: 'Program',
          label: prog.label,
          hint: `${prog.programId.slice(0, 8)}…${prog.programId.slice(-4)}`,
          onSelect: () => {
            setNavView('workspace');
            setWorkspaceTab('builder');
          },
        });
      }
    }

    return items;
  }, [projects, sessions, activeProject, activeProjectId]);

  // --- Context menu builders ---
  const projectMenu = (p: ProjectMeta): MenuItem[] => [
    {
      label: 'Rename project…',
      onSelect: () =>
        setPrompt({
          options: { title: 'Rename project', label: 'New name', initial: p.name },
          onConfirm: async (name) => {
            setPrompt(null);
            await safeCall(() => api.call('project.rename', { id: p.id, name }));
            await reloadProjects();
            if (activeProjectId === p.id) await reloadProject(p.id);
          },
        }),
    },
    {
      label: 'Delete project',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Delete project',
          message: `"${p.name}" and all its sessions, programs, accounts, and snapshots will be permanently removed.`,
          danger: true,
          confirmText: 'Delete',
          onConfirm: async () => {
            setConfirm(null);
            await safeCall(() => api.call('project.delete', { id: p.id }));
            if (activeProjectId === p.id) setActiveProjectId(null);
            await reloadProjects();
          },
        }),
    },
  ];

  const programMenu = (programId: string): MenuItem[] => {
    const prog = activeProject?.programs[programId];
    return [
    {
      label: 'Rename program…',
      onSelect: () =>
        setPrompt({
          options: {
            title: 'Rename program',
            label: 'New label',
            initial: prog?.label ?? programId,
          },
          onConfirm: async (label) => {
            setPrompt(null);
            if (!activeProjectId) return;
            await safeCall(
              () => api.call('program.setLabel', { projectId: activeProjectId, programId, label }),
              'program renamed',
            );
            await reloadProject(activeProjectId);
          },
        }),
    },
    {
      label: 'Add account under this program',
      onSelect: () => {
        setPendingProgramId(programId);
        setModal('addAccount');
      },
    },
    {
      label: hiddenPrograms.has(programId) ? 'Show in sidebar' : 'Hide from sidebar',
      onSelect: () => setHidden(programId, !hiddenPrograms.has(programId)),
    },
    {
      label: idlAttached.has(programId) ? 'Replace IDL…' : 'Attach IDL…',
      onSelect: () => {
        setPendingProgramId(programId);
        setModal('attachIdl');
      },
    },
    ...(idlAttached.has(programId)
      ? ([
          {
            label: 'Detach IDL',
            onSelect: () =>
              safeCall(async () => {
                await api.call('idl.detach', { programId });
                if (activeProjectId) await reloadProject(activeProjectId);
              }),
          },
        ] as MenuItem[])
      : []),
    {
      label: 'Refresh program ELF',
      onSelect: () =>
        safeCall(async () => {
          if (!activeProjectId) return;
          await api.call('program.add', { projectId: activeProjectId, programId });
          await reloadProject(activeProjectId);
        }),
    },
    {
      label: 'Remove program',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Remove program',
          message: `Remove "${programId.slice(0, 8)}…" from the project?`,
          danger: true,
          confirmText: 'Remove',
          onConfirm: async () => {
            setConfirm(null);
            if (!activeProjectId) return;
            await safeCall(() =>
              api.call('program.remove', { projectId: activeProjectId, programId }),
            );
            await reloadProject(activeProjectId);
          },
        }),
    },
    ];
  };

  const accountMenu = (address: string): MenuItem[] => {
    let accLabel: string | null = null;
    if (activeProject) {
      for (const prog of Object.values(activeProject.programs)) {
        const acc = prog.accounts.find((a) => a.address === address);
        if (acc) {
          accLabel = acc.label;
          break;
        }
      }
    }
    return [
    {
      label: 'Inspect…',
      onSelect: () => {
        setPendingAccountAddress(address);
        setModal('inspectAccount');
      },
    },
    {
      label: 'Rename…',
      onSelect: () =>
        setPrompt({
          options: {
            title: 'Rename account',
            label: 'New label',
            initial: accLabel ?? address,
          },
          onConfirm: async (label) => {
            setPrompt(null);
            if (!activeProjectId) return;
            await safeCall(
              () => api.call('account.setLabel', { projectId: activeProjectId, address, label }),
              'account renamed',
            );
            await reloadProject(activeProjectId);
          },
        }),
    },
    {
      label: 'Patch fields…',
      onSelect: () => {
        setPendingAccountAddress(address);
        setModal('patchAccount');
      },
    },
    {
      label: 'Copy address',
      onSelect: () => navigator.clipboard.writeText(address),
    },
    {
      label: 'Refresh from RPC',
      onSelect: () =>
        safeCall(async () => {
          if (!activeProjectId || !activeProject) return;
          let owner: string | null = null;
          for (const [pid, prog] of Object.entries(activeProject.programs)) {
            if (prog.accounts.some((a) => a.address === address)) {
              owner = pid;
              break;
            }
          }
          if (!owner) return;
          await api.call('account.remove', { projectId: activeProjectId, address });
          await api.call('account.add', {
            projectId: activeProjectId,
            programId: owner,
            address,
          });
          await reloadProject(activeProjectId);
        }),
    },
    {
      label: 'Remove account',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Remove account',
          message: `Remove ${address.slice(0, 8)}…${address.slice(-4)}?`,
          danger: true,
          confirmText: 'Remove',
          onConfirm: async () => {
            setConfirm(null);
            if (!activeProjectId) return;
            await safeCall(() =>
              api.call('account.remove', { projectId: activeProjectId, address }),
            );
            await reloadProject(activeProjectId);
          },
        }),
    },
    ];
  };

  const sessionMenu = (s: SessionMeta): MenuItem[] => [
    {
      label: 'Rename session…',
      onSelect: () =>
        setPrompt({
          options: { title: 'Rename session', label: 'New name', initial: s.name },
          onConfirm: async (name) => {
            setPrompt(null);
            await safeCall(() => api.call('session.rename', { id: s.id, name }));
            if (activeProjectId) await reloadProject(activeProjectId);
          },
        }),
    },
    {
      label: 'Reset session to baseline',
      onSelect: () =>
        setConfirm({
          title: 'Reset session',
          message: `Reset "${s.name}"? Mutations + tx history cleared.`,
          confirmText: 'Reset',
          onConfirm: async () => {
            setConfirm(null);
            await safeCall(() => api.call('session.reset', { id: s.id }));
            if (activeProjectId) await reloadProject(activeProjectId);
          },
        }),
    },
    {
      label: 'Delete session',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Delete session',
          message: `Permanently delete "${s.name}"?`,
          danger: true,
          confirmText: 'Delete',
          onConfirm: async () => {
            setConfirm(null);
            await safeCall(() => api.call('session.delete', { id: s.id }));
            if (activeSessionId === s.id) setActiveSessionId(null);
            if (activeProjectId) await reloadProject(activeProjectId);
          },
        }),
    },
  ];

  // --- Search filter ---
  const allFilteredPrograms = useMemo<ProgramEntry[]>(() => {
    if (!activeProject) return [];
    const term = searchTerm.toLowerCase().trim();
    const all = Object.values(activeProject.programs);
    if (!term) return all;
    return all.filter((p) => {
      const hit =
        p.label.toLowerCase().includes(term) ||
        p.programId.toLowerCase().includes(term) ||
        p.accounts.some(
          (a) =>
            a.label.toLowerCase().includes(term) || a.address.toLowerCase().includes(term),
        );
      return hit;
    });
  }, [activeProject, searchTerm]);

  const visiblePrograms = useMemo(
    () => allFilteredPrograms.filter((p) => !hiddenPrograms.has(p.programId)),
    [allFilteredPrograms, hiddenPrograms],
  );
  const hiddenProgramList = useMemo(
    () => allFilteredPrograms.filter((p) => hiddenPrograms.has(p.programId)),
    [allFilteredPrograms, hiddenPrograms],
  );

  const toggleProgramExpanded = (programId: string): void =>
    setExpandedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });

  const activeProjectMeta = projects.find((p) => p.id === activeProjectId);

  return (
    <div
      className={`shell${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}`}
      style={{ '--left-col': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <header
        className={`app-header${api.platform === 'darwin' ? ' is-mac' : api.platform === 'win32' ? ' is-win' : ' is-linux'}`}
      >
        <div className="app-header-left">
          <div className="title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img
              src="./icon.svg"
              alt=""
              aria-hidden
              width={18}
              height={18}
              draggable={false}
              style={{ borderRadius: 4 }}
            />
            RELAY
          </div>
        </div>
        <div className="app-header-center">
          <button
            className="palette-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Search & commands (⌘K)"
            aria-label="Open command palette"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Search size={12} aria-hidden /> Search & commands
            </span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <div className="app-header-right">
          <ThemeToggle />
          <button
            className={`header-side-toggle${!leftCollapsed ? ' active' : ''}`}
            onClick={toggleLeft}
            title={`${leftCollapsed ? 'Show' : 'Hide'} left sidebar (⌘B)`}
            aria-label="Toggle left sidebar"
            aria-pressed={!leftCollapsed}
          >
            {leftCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button
            className={`header-side-toggle${!rightCollapsed ? ' active' : ''}`}
            onClick={toggleRight}
            title={`${rightCollapsed ? 'Show' : 'Hide'} right sidebar (⌘⌥B)`}
            aria-label="Toggle right sidebar"
            aria-pressed={!rightCollapsed}
          >
            {rightCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>
        </div>
        {api.platform !== 'darwin' && api.platform !== 'win32' && (
          <div className="window-controls">
            <button
              className="window-control"
              onClick={() => api.windowCtl.minimize()}
              title="Minimize"
              aria-label="Minimize"
            >
              <Minus size={12} />
            </button>
            <button
              className="window-control"
              onClick={() => api.windowCtl.maximize()}
              title="Maximize / restore"
              aria-label="Maximize"
            >
              <Square size={10} />
            </button>
            <button
              className="window-control close"
              onClick={() => api.windowCtl.close()}
              title="Close"
              aria-label="Close window"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </header>

      <nav className="nav-rail">
        {(
          [
            { id: 'workspace', icon: <LayoutGrid size={18} aria-hidden />, label: 'Workspace' },
            { id: 'replay', icon: <History size={18} aria-hidden />, label: 'Replay' },
            { id: 'snapshots', icon: <Camera size={18} aria-hidden />, label: 'Snapshots' },
            { id: 'keypairs', icon: <KeyRound size={18} aria-hidden />, label: 'Keypairs' },
          ] as Array<{ id: NavView; icon: ReactNode; label: string }>
        ).map((v) => (
          <NavRailButton
            key={v.id}
            icon={v.icon}
            label={v.label}
            active={navView === v.id}
            collapsed={leftCollapsed}
            onClick={() => {
              // VSCode: click active = toggle sidebar; click different = switch + reveal
              if (navView === v.id) {
                toggleLeft();
              } else {
                setNavView(v.id);
                if (leftCollapsed) toggleLeft();
              }
            }}
          />
        ))}
      </nav>

      <aside className="tree-pane">
        {/* Project header (simple — no dropdown) */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <FolderOpen size={13} className="text-text-muted shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-text truncate">
              {activeProjectMeta?.name ?? 'No project'}
            </div>
            <div className="text-2xs text-text-subtle truncate font-mono">
              {activeProjectMeta
                ? `${activeProjectMeta.network} · ${activeProjectMeta.programCount}p · ${activeProjectMeta.sessionCount}s`
                : 'open one to start'}
            </div>
          </div>
          <IconButton
            icon={<Plus size={13} />}
            label="Open / new project (welcome window)"
            size="sm"
            variant="ghost"
            onClick={() => void api.call('app.showWelcome')}
          />
        </div>

        {/* Sidebar mode tabs (Android-Studio-style) */}
        {activeProject && (
          <div className="flex border-b border-border bg-surface-0/50">
            <button
              type="button"
              onClick={() => switchSidebarMode('project')}
              className={[
                'flex-1 text-2xs uppercase tracking-wider font-medium py-1.5',
                'bg-transparent border-0',
                sidebarMode === 'project'
                  ? 'text-text border-b-2 border-accent'
                  : 'text-text-subtle hover:text-text border-b-2 border-transparent',
              ].join(' ')}
            >
              Project
            </button>
            <button
              type="button"
              onClick={() => switchSidebarMode('files')}
              className={[
                'flex-1 text-2xs uppercase tracking-wider font-medium py-1.5',
                'bg-transparent border-0',
                sidebarMode === 'files'
                  ? 'text-text border-b-2 border-accent'
                  : 'text-text-subtle hover:text-text border-b-2 border-transparent',
              ].join(' ')}
            >
              Files
            </button>
          </div>
        )}

        {activeProject && sidebarMode === 'files' && (
          <FilesTree
            selected={activeFile}
            onSelect={openFileTab}
            refreshKey={filesRefreshKey}
          />
        )}

        {activeProject && sidebarMode === 'project' && (
          <>
            <div className="sidebar-search">
              <div className="relative">
                <Search
                  size={11}
                  aria-hidden
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
                />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search programs / accounts"
                  sizeVariant="sm"
                  className="pl-7"
                />
              </div>
            </div>

            <div className="tree-section">
              <button
                type="button"
                className="tree-section-header"
                onClick={toggleSessionsSection}
                aria-expanded={sessionsSectionOpen}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="inline-flex text-text-subtle">
                    {sessionsSectionOpen ? (
                      <ChevronDown size={11} aria-hidden />
                    ) : (
                      <ChevronRight size={11} aria-hidden />
                    )}
                  </span>
                  Sessions
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="tree-section-count">{sessions.length}</span>
                  <span
                    className="tree-section-add"
                    title="New session"
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal('newSession');
                    }}
                  >
                    <Plus size={12} aria-hidden />
                  </span>
                </span>
              </button>

              {sessionsSectionOpen &&
                (sessions.length === 0 ? (
                  <div className="px-6 py-1.5 text-2xs text-text-subtle italic">
                    none yet — click + above
                  </div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`tree-session${s.id === activeSessionId ? ' selected' : ''}`}
                      onClick={() => setActiveSessionId(s.id)}
                      onContextMenu={(e) => ctx.open(e, sessionMenu(s))}
                    >
                      <span className="session-dot" />
                      <span className="session-name">{s.name}</span>
                      <span className="font-mono text-2xs text-text-subtle">
                        {s.accountCount}/{s.mutationCount}
                      </span>
                    </div>
                  ))
                ))}
            </div>

            <div className="tree-section">
              <button
                type="button"
                className="tree-section-header"
                onClick={toggleProgramsSection}
                aria-expanded={programsSectionOpen}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="inline-flex text-text-subtle">
                    {programsSectionOpen ? (
                      <ChevronDown size={11} aria-hidden />
                    ) : (
                      <ChevronRight size={11} aria-hidden />
                    )}
                  </span>
                  Programs
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="tree-section-count">
                    {Object.keys(activeProject.programs).length}
                  </span>
                  <span
                    className="tree-section-add"
                    title={programsView === 'tree' ? 'Switch to list view' : 'Switch to tree view'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProgramsView();
                    }}
                  >
                    {programsView === 'tree' ? (
                      <LayoutList size={10} aria-hidden />
                    ) : (
                      <ListTree size={10} aria-hidden />
                    )}
                  </span>
                  <span
                    className="tree-section-add"
                    title="Add program"
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal('addProgram');
                    }}
                  >
                    <Plus size={12} aria-hidden />
                  </span>
                </span>
              </button>

              {programsSectionOpen && programsView === 'list' && (
                <ProgramsListView
                  programs={visiblePrograms}
                  idlAttached={idlAttached}
                  searchTerm={searchTerm}
                  onProgramOpen={(programId) => {
                    if (!expandedPrograms.has(programId)) toggleProgramExpanded(programId);
                  }}
                  onAccountInspect={(addr) => {
                    setPendingAccountAddress(addr);
                    setModal('inspectAccount');
                  }}
                  onProgramCtx={(e, programId) => ctx.open(e, programMenu(programId))}
                  onAccountCtx={(e, addr) => ctx.open(e, accountMenu(addr))}
                />
              )}

              {programsSectionOpen && programsView === 'tree' && (
                <>
                  {visiblePrograms.length === 0 && hiddenProgramList.length === 0 ? (
                    <div className="px-6 py-1.5 text-2xs text-text-subtle italic">
                      {searchTerm ? 'no matches' : 'none yet — click + above'}
                    </div>
                  ) : (
                    visiblePrograms.map((prog) => {
                      const isExpanded = expandedPrograms.has(prog.programId);
                      const hasIdl = idlAttached.has(prog.programId);
                      const sourceKind = prog.source?.kind;
                      const sourceVariant: 'success' | 'accent' | 'default' =
                        sourceKind === 'cloned'
                          ? 'success'
                          : sourceKind === 'localFile'
                            ? 'accent'
                            : 'default';
                      return (
                        <div key={prog.programId}>
                          <button
                            type="button"
                            className="tree-program"
                            onClick={() => toggleProgramExpanded(prog.programId)}
                            onContextMenu={(e) => ctx.open(e, programMenu(prog.programId))}
                            aria-expanded={isExpanded}
                          >
                            <span className="tree-chevron inline-flex text-text-subtle">
                              {isExpanded ? (
                                <ChevronDown size={11} aria-hidden />
                              ) : (
                                <ChevronRight size={11} aria-hidden />
                              )}
                            </span>
                            <span className="tree-program-label">
                              {prog.label.length > 26
                                ? `${prog.label.slice(0, 26)}…`
                                : prog.label}
                            </span>
                            <span className="tree-program-badges">
                              {hasIdl && (
                                <Badge size="sm" variant="accent">
                                  IDL
                                </Badge>
                              )}
                              {sourceKind && (
                                <Badge
                                  size="sm"
                                  variant={sourceVariant}
                                  title={
                                    sourceKind === 'cloned'
                                      ? 'Cloned from chain'
                                      : 'Loaded from local file'
                                  }
                                >
                                  {sourceKind === 'cloned' ? 'cloned' : 'local'}
                                </Badge>
                              )}
                              <Badge size="sm" variant="outline">
                                {prog.accounts.length}
                              </Badge>
                            </span>
                          </button>
                          {isExpanded && (
                            <>
                              {prog.accounts.map((a) => {
                                const hasCustomLabel = a.label && a.label !== a.address;
                                return (
                                  <div
                                    key={a.address}
                                    className="tree-account group"
                                    onClick={() => {
                                      setPendingAccountAddress(a.address);
                                      setModal('inspectAccount');
                                    }}
                                    onContextMenu={(e) => ctx.open(e, accountMenu(a.address))}
                                  >
                                    {hasCustomLabel ? (
                                      <>
                                        <span className="tree-account-label">{a.label}</span>
                                        <Pubkey
                                          value={a.address}
                                          noCopy
                                          className="text-2xs text-text-subtle"
                                        />
                                      </>
                                    ) : (
                                      <Pubkey
                                        value={a.address}
                                        noCopy
                                        className="text-text-muted"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                              <div
                                className="tree-add"
                                onClick={() => {
                                  setPendingProgramId(prog.programId);
                                  setModal('addAccount');
                                }}
                              >
                                <Plus size={10} aria-hidden /> Add account
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}

                  {hiddenProgramList.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="tree-program"
                        style={{ color: 'var(--text-dim)', marginTop: 4 }}
                        onClick={() => setHiddenExpanded((v) => !v)}
                        aria-expanded={hiddenExpanded}
                        title="Programs hidden from sidebar — right-click to restore individually"
                      >
                        <span className="tree-chevron inline-flex text-text-subtle">
                          {hiddenExpanded ? (
                            <ChevronDown size={11} aria-hidden />
                          ) : (
                            <ChevronRight size={11} aria-hidden />
                          )}
                        </span>
                        <span className="tree-program-label inline-flex items-center gap-1">
                          <EyeOff size={10} aria-hidden /> Hidden
                        </span>
                        <span className="tree-program-badges">
                          <Badge size="sm" variant="outline">
                            {hiddenProgramList.length}
                          </Badge>
                        </span>
                      </button>
                      {hiddenExpanded &&
                        hiddenProgramList.map((prog) => (
                          <button
                            type="button"
                            key={prog.programId}
                            className="tree-program"
                            style={{ opacity: 0.55 }}
                            onClick={() => setHidden(prog.programId, false)}
                            onContextMenu={(e) => ctx.open(e, programMenu(prog.programId))}
                            title="Click to show again"
                          >
                            <span className="tree-chevron inline-flex text-text-subtle">
                              <EyeOff size={10} aria-hidden />
                            </span>
                            <span className="tree-program-label">
                              {prog.label.length > 24
                                ? `${prog.label.slice(0, 24)}…`
                                : prog.label}
                            </span>
                          </button>
                        ))}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

      </aside>

      {!leftCollapsed && (
        <div
          className={`sidebar-resizer${dragging ? ' dragging' : ''}`}
          style={{ left: `${56 + sidebarWidth - 2}px` }}
          onMouseDown={beginDrag}
          title="Drag to resize sidebar"
        />
      )}

      <main className={`workspace${sidebarMode === 'files' ? ' workspace-files' : ''}`}>
        {error && (
          <div className="error-banner">
            {error} <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {navView === 'workspace' && (
          <>
            {!activeProject ? (
              <div className="panel" style={{ textAlign: 'center', padding: 36 }}>
                <h2 style={{ marginBottom: 8 }}>Welcome to Relay</h2>
                <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 18 }}>
                  Clone Solana programs + accounts. Patch state. Simulate, submit, replay.
                </div>
                <Button variant="primary" onClick={() => void api.call('app.showWelcome')}>
                  <Plus size={13} aria-hidden /> Create your first project
                </Button>
                <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text-dim)' }}>
                  Press <span className="kbd">⌘K</span> for command palette
                </div>
              </div>
            ) : (
              <>
                {sidebarMode === 'project' && (
                  <div className="sub-tabs">
                    <button
                      className={`sub-tab${workspaceTab === 'builder' ? ' active' : ''}`}
                      onClick={() => setWorkspaceTab('builder')}
                    >
                      Tx Builder
                    </button>
                    <button
                      className={`sub-tab${workspaceTab === 'workflows' ? ' active' : ''}`}
                      onClick={() => setWorkspaceTab('workflows')}
                    >
                      Workflows
                    </button>
                    <button
                      className={`sub-tab${workspaceTab === 'history' ? ' active' : ''}`}
                      onClick={() => setWorkspaceTab('history')}
                    >
                      History
                    </button>
                    <button
                      className={`sub-tab${workspaceTab === 'patches' ? ' active' : ''}`}
                      onClick={() => setWorkspaceTab('patches')}
                    >
                      Patches
                    </button>
                  </div>
                )}

                {sidebarMode === 'files' ? (
                  <FileTabsAndEditor
                    openedFiles={openedFiles}
                    activeFile={activeFile}
                    onSelect={setActiveFile}
                    onClose={closeFileTab}
                    onSaved={() => {
                      setFilesRefreshKey((k) => k + 1);
                      if (activeProjectId) void reloadProject(activeProjectId);
                    }}
                  />
                ) : (
                  <>
                    {workspaceTab === 'builder' && (
                      <TxBuilderPanel project={activeProject} activeSessionId={activeSessionId} />
                    )}
                    {workspaceTab === 'workflows' && (
                      <WorkflowsPanel project={activeProject} activeSessionId={activeSessionId} />
                    )}
                    {workspaceTab === 'history' && (
                      <TxHistoryPanel activeSessionId={activeSessionId} />
                    )}
                    {workspaceTab === 'patches' && (
                      <PatchesPanel
                        project={activeProject}
                        activeSessionId={activeSessionId}
                        onChange={() => {
                          if (activeProjectId) void reloadProject(activeProjectId);
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {navView === 'replay' && <ReplayPanel activeSessionId={activeSessionId} />}
        {navView === 'snapshots' && (
          <SnapshotsPanel
            activeSessionId={activeSessionId}
            onChange={() => {
              if (activeProjectId) void reloadProject(activeProjectId);
            }}
          />
        )}
        {navView === 'keypairs' && <KeypairsPanel activeSessionId={activeSessionId} />}
      </main>

      <InspectorPane
        project={activeProject}
        sessions={sessions}
        activeSessionId={activeSessionId}
        tab={inspectorTab}
      />

      <nav className="inspector-rail">
        {(
          [
            { id: 'details', icon: <Info size={14} aria-hidden />, label: 'Details' },
            { id: 'activity', icon: <Activity size={14} aria-hidden />, label: 'Activity' },
            { id: 'shortcuts', icon: <Command size={14} aria-hidden />, label: 'Shortcuts' },
          ] as Array<{ id: InspectorTab; icon: ReactNode; label: string }>
        ).map((t) => {
          const isActive = inspectorTab === t.id;
          const isOpen = isActive && !rightCollapsed;
          const classes = ['inspector-rail-item'];
          if (isOpen) classes.push('active');
          if (rightCollapsed) classes.push('collapsed');
          const tip = isOpen ? `Hide ${t.label} (⌘⌥B)` : `Open ${t.label}`;
          return (
            <button
              key={t.id}
              className={classes.join(' ')}
              title={tip}
              onClick={() => {
                if (isActive && !rightCollapsed) {
                  toggleRight();
                } else {
                  updateInspectorTab(t.id);
                  if (rightCollapsed) toggleRight();
                }
              }}
            >
              {t.icon}
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      {modal === 'newSession' && activeProjectId && (
        <Modal onClose={() => setModal(null)}>
          <NewSessionForm
            projectId={activeProjectId}
            onDone={async () => {
              setModal(null);
              await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'addProgram' && activeProjectId && (
        <Modal onClose={() => setModal(null)}>
          <AddProgramForm
            projectId={activeProjectId}
            onDone={async () => {
              setModal(null);
              await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'addAccount' && activeProjectId && pendingProgramId && (
        <Modal onClose={() => setModal(null)}>
          <AddAccountForm
            projectId={activeProjectId}
            programId={pendingProgramId}
            onDone={async () => {
              setModal(null);
              await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'attachIdl' && pendingProgramId && (
        <Modal onClose={() => setModal(null)}>
          <AttachIdlForm
            programId={pendingProgramId}
            onDone={async () => {
              setModal(null);
              if (activeProjectId) await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'inspectAccount' && activeProjectId && pendingAccountAddress && (
        <Modal onClose={() => setModal(null)}>
          <AccountInspector
            projectId={activeProjectId}
            address={pendingAccountAddress}
            onClose={() => setModal(null)}
            onPatchRequested={() => setModal('patchAccount')}
          />
        </Modal>
      )}
      {modal === 'patchAccount' && activeProjectId && pendingAccountAddress && (
        <Modal onClose={() => setModal(null)}>
          <PatchAccountForm
            projectId={activeProjectId}
            sessionId={activeSessionId}
            address={pendingAccountAddress}
            project={activeProject}
            onDone={async () => {
              setModal(null);
              if (activeProjectId) await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}

      {prompt && (
        <PromptModal
          options={prompt.options}
          onConfirm={prompt.onConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          {...(confirm.confirmText !== undefined && { confirmText: confirm.confirmText })}
          {...(confirm.danger !== undefined && { danger: confirm.danger })}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}

      <CommandPalette
        items={paletteItems}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />

      <footer className="status-bar">
        {activeProject ? (
          <>
            <span className="status-item">
              <span style={{ color: 'rgb(var(--color-text))' }}>{activeProject.name}</span>
            </span>
            <span className="status-item" title="Network">
              <span className="status-net-dot" data-net={activeProject.network} aria-hidden />
              <span className="mono">{activeProject.network}</span>
            </span>
            <span className="status-item mono" title="RPC endpoint">
              {activeProject.rpcEndpointId}
            </span>
            {activeSessionId && (
              <span className="status-item" title="Active session">
                <span className="status-dot" />
                <span>{sessions.find((s) => s.id === activeSessionId)?.name ?? '?'}</span>
              </span>
            )}
          </>
        ) : (
          <span className="status-item">no project</span>
        )}
        <span className="status-spacer" />
        <button
          type="button"
          className="status-item interactive"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
        >
          <Search size={11} aria-hidden /> <Kbd>⌘K</Kbd>
        </button>
      </footer>
    </div>
  );
}

function FileTabsAndEditor({
  openedFiles,
  activeFile,
  onSelect,
  onClose,
  onSaved,
}: {
  openedFiles: string[];
  activeFile: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSaved: (path: string) => void;
}): JSX.Element {
  if (openedFiles.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <FileEditor path={null} onSaved={onSaved} />
      </div>
    );
  }
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-stretch overflow-x-auto border-b border-border bg-surface-0 select-none">
        {openedFiles.map((path) => {
          const isActive = path === activeFile;
          const name = path.split('/').pop() ?? path;
          return (
            <div
              key={path}
              className={[
                'group inline-flex items-center gap-1.5 pl-3 pr-1.5 h-8 border-r border-border shrink-0',
                'text-xs cursor-pointer transition-colors duration-fast relative',
                isActive
                  ? 'bg-bg text-text'
                  : 'bg-surface-0 text-text-muted hover:bg-surface-1/70 hover:text-text',
              ].join(' ')}
              onClick={() => onSelect(path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(path);
                }
              }}
              title={path}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute top-0 left-0 right-0 h-[2px] bg-accent"
                />
              )}
              <span className="font-mono truncate max-w-[200px]">{name}</span>
              <button
                type="button"
                aria-label={`Close ${name}`}
                title="Close (middle-click)"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(path);
                }}
                className={[
                  'inline-flex items-center justify-center w-4 h-4 rounded',
                  'text-text-subtle hover:bg-surface-2 hover:text-text transition-colors',
                ].join(' ')}
              >
                <X size={10} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <FileEditor key={activeFile ?? '__none__'} path={activeFile} onSaved={onSaved} />
    </div>
  );
}

function ProgramsListView({
  programs,
  idlAttached,
  searchTerm,
  onProgramOpen,
  onAccountInspect,
  onProgramCtx,
  onAccountCtx,
}: {
  programs: ProgramEntry[];
  idlAttached: Set<string>;
  searchTerm: string;
  onProgramOpen: (programId: string) => void;
  onAccountInspect: (address: string) => void;
  onProgramCtx: (e: React.MouseEvent, programId: string) => void;
  onAccountCtx: (e: React.MouseEvent, address: string) => void;
}): JSX.Element {
  type Row =
    | { kind: 'program'; programId: string; label: string; hasIdl: boolean; source: string | null; count: number }
    | { kind: 'account'; programId: string; address: string; label: string };

  const rows: Row[] = [];
  for (const p of programs) {
    rows.push({
      kind: 'program',
      programId: p.programId,
      label: p.label,
      hasIdl: idlAttached.has(p.programId),
      source: p.source?.kind ?? null,
      count: p.accounts.length,
    });
    for (const a of p.accounts) {
      rows.push({
        kind: 'account',
        programId: p.programId,
        address: a.address,
        label: a.label && a.label !== a.address ? a.label : a.address,
      });
    }
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-1.5 text-2xs text-text-subtle italic">
        {searchTerm ? 'no matches' : 'none yet — click + above'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => {
        if (row.kind === 'program') {
          const sourceVariant: 'success' | 'accent' | 'default' =
            row.source === 'cloned' ? 'success' : row.source === 'localFile' ? 'accent' : 'default';
          return (
            <button
              key={`p:${row.programId}`}
              type="button"
              onClick={() => onProgramOpen(row.programId)}
              onContextMenu={(e) => onProgramCtx(e, row.programId)}
              className="flex items-center gap-2 px-3 py-1 text-left bg-transparent border-0 hover:bg-surface-1 transition-colors duration-fast"
              title={row.programId}
            >
              <span className="text-text-subtle inline-flex w-3 justify-center">
                <span className="block w-1 h-1 rounded-full bg-accent" />
              </span>
              <span className="text-xs text-text truncate flex-1 min-w-0">{row.label}</span>
              {row.hasIdl && (
                <Badge size="sm" variant="accent">
                  IDL
                </Badge>
              )}
              {row.source && (
                <Badge size="sm" variant={sourceVariant}>
                  {row.source === 'cloned' ? 'cloned' : 'local'}
                </Badge>
              )}
              <Badge size="sm" variant="outline">
                {row.count}
              </Badge>
            </button>
          );
        }
        return (
          <button
            key={`a:${row.address}`}
            type="button"
            onClick={() => onAccountInspect(row.address)}
            onContextMenu={(e) => onAccountCtx(e, row.address)}
            className="flex items-center gap-2 pl-6 pr-3 py-1 text-left bg-transparent border-0 hover:bg-surface-1 transition-colors duration-fast"
            title={row.address}
          >
            <span className="text-text-subtle inline-flex w-3 justify-center">
              <span className="block w-1 h-1 rounded-full bg-text-subtle" />
            </span>
            <span className="text-2xs text-text-muted truncate flex-1 min-w-0 font-mono">
              {row.label === row.address
                ? `${row.address.slice(0, 4)}…${row.address.slice(-4)}`
                : row.label}
            </span>
            {row.label !== row.address && (
              <span className="text-2xs text-text-subtle font-mono">
                {row.address.slice(0, 4)}…{row.address.slice(-4)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="header-side-toggle"
      onClick={toggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  );
}

function NavRailButton({
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}): JSX.Element {
  const classes = ['nav-rail-item'];
  if (active) classes.push('active');
  if (collapsed) classes.push('collapsed');
  const tip = active
    ? collapsed
      ? `Show sidebar — ${label} (⌘B)`
      : `Hide sidebar — ${label} (⌘B)`
    : label;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={classes.join(' ')}
      onClick={onClick}
      title={tip}
    >
      {icon}
    </button>
  );
}

interface PatchRecord {
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

function PatchesPanel({
  project,
  activeSessionId,
  onChange,
}: {
  project: Project;
  activeSessionId: string | null;
  onChange: () => void;
}): JSX.Element {
  const [sessionPatches, setSessionPatches] = useState<PatchRecord[]>([]);

  useEffect(() => {
    if (!activeSessionId) {
      setSessionPatches([]);
      return;
    }
    void api
      .call<PatchRecord[]>('patch.list', { scope: 'session', scopeId: activeSessionId })
      .then(setSessionPatches);
  }, [activeSessionId, project]);

  const toggle = async (
    scope: 'project' | 'session',
    scopeId: string,
    patchId: string,
    enabled: boolean,
  ): Promise<void> => {
    await api.call('patch.toggle', { scope, scopeId, patchId, enabled });
    onChange();
  };
  const remove = async (
    scope: 'project' | 'session',
    scopeId: string,
    patchId: string,
  ): Promise<void> => {
    await api.call('patch.remove', { scope, scopeId, patchId });
    onChange();
  };

  const opSummary = (op: PatchRecord['op']): { kind: string; detail: string; full: string } => {
    if (op.kind === 'setField') {
      const trimmed = op.valueJson.length > 28 ? `${op.valueJson.slice(0, 28)}…` : op.valueJson;
      return {
        kind: 'setField',
        detail: `${op.fieldPath} = ${trimmed}`,
        full: `${op.fieldPath} = ${op.valueJson}`,
      };
    }
    if (op.kind === 'setLamports') {
      return {
        kind: 'setLamports',
        detail: `lamports = ${op.lamports.toString()}`,
        full: `lamports = ${op.lamports.toString()}`,
      };
    }
    if (op.kind === 'setOwner') {
      return {
        kind: 'setOwner',
        detail: `owner = ${op.owner.slice(0, 8)}…${op.owner.slice(-4)}`,
        full: `owner = ${op.owner}`,
      };
    }
    return { kind: 'rawSplice', detail: `splice at offset ${op.offset}`, full: JSON.stringify(op) };
  };

  const renderList = (
    list: PatchRecord[],
    scope: 'project' | 'session',
    scopeId: string,
  ): JSX.Element => {
    if (list.length === 0) {
      return (
        <div style={{ color: 'var(--text-dim)', padding: '10px 4px', fontSize: 12 }}>
          no {scope} patches yet
        </div>
      );
    }
    return (
      <table className="acc-table">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Target</th>
            <th style={{ width: 100 }}>Op</th>
            <th>Detail</th>
            <th style={{ width: 60 }}>On</th>
            <th style={{ width: 70 }} />
          </tr>
        </thead>
        <tbody>
          {list.map((p) => {
            const summary = opSummary(p.op);
            return (
              <tr key={p.id} style={{ opacity: p.enabled ? 1 : 0.55 }}>
                <td className="mono" title={p.target}>
                  {p.target.slice(0, 4)}…{p.target.slice(-4)}
                </td>
                <td>
                  <span className="badge">{summary.kind}</span>
                </td>
                <td className="mono" style={{ fontSize: 11 }} title={summary.full}>
                  {summary.detail}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => {
                      void toggle(scope, scopeId, p.id, e.target.checked);
                    }}
                  />
                </td>
                <td>
                  <Button variant="danger" size="xs" onClick={() => void remove(scope, scopeId, p.id)}>
                    <Trash2 size={11} aria-hidden /> Delete
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const projectPatches = project.patches as PatchRecord[];

  return (
    <>
      <div className="panel">
        <div className="panel-h2-row">
          <h2>
            Project patches
            <span
              className="muted"
              style={{ marginLeft: 8, fontSize: 10, textTransform: 'none' }}
            >
              apply to every session · {projectPatches.length}
            </span>
          </h2>
        </div>
        {renderList(projectPatches, 'project', project.id)}
      </div>

      <div className="panel">
        <div className="panel-h2-row">
          <h2>
            Session patches
            {activeSessionId && (
              <span
                className="muted"
                style={{ marginLeft: 8, fontSize: 10, textTransform: 'none' }}
              >
                · {sessionPatches.length}
              </span>
            )}
          </h2>
        </div>
        {activeSessionId ? (
          renderList(sessionPatches, 'session', activeSessionId)
        ) : (
          <div style={{ color: 'var(--text-dim)', padding: 8, fontSize: 12 }}>
            pick a session in the sidebar to view its patches
          </div>
        )}
      </div>

      <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '8px 4px' }}>
        ⓘ Right-click an account in the sidebar → "Patch fields…" to create a new patch. Project
        patches re-apply on every session open. Session patches affect only the current session.
      </div>
    </>
  );
}
