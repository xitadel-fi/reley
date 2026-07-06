import {
  Activity,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Command,
  EyeOff,
  FolderOpen,
  HelpCircle,
  Info,
  LayoutDashboard,
  LayoutList,
  ListTree,
  Minus,
  Moon,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Square,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { ContextMenu, type MenuItem, useContextMenu } from './components/ContextMenu';
import { useDialogs } from './components/Dialogs';
import { EmptyProjectGuide } from './components/EmptyProjectGuide';
import { HelpChip } from './components/HelpChip';
import { HelpHint } from './components/HelpHint';
import { InlineRename } from './components/InlineRename';
import { Modal } from './components/Modal';
import { OnboardingTour } from './components/OnboardingTour';
import { ConfirmModal, PromptModal, type PromptOptions } from './components/PromptModal';
import { useToast } from './components/Toast';
import { AccountInspector } from './features/AccountInspector';
import { AddAccountForm } from './features/AddAccountForm';
import { AddProgramForm } from './features/AddProgramForm';
import { AddProgramVersionForm } from './features/AddProgramVersionForm';
import { AttachIdlForm } from './features/AttachIdlForm';
import { AutomationsHome } from './features/AutomationsHome';
import { AutomationsSidebarSection } from './features/AutomationsSidebarSection';
import { ConsoleDock, type RunRecord } from './features/ConsoleDock';
import { FileEditor } from './features/FileEditor';
import { FilesTree } from './features/FilesTree';
import { IdlDiffPanel } from './features/IdlDiffPanel';
import { InspectorPane, type InspectorTab } from './features/InspectorPane';
import { KeypairsPanel } from './features/KeypairsPanel';
import { PatchAccountForm } from './features/PatchAccountForm';
import { ProjectPatchesPanel, SandboxPatchesPanel } from './features/PatchesPanels';
import { PatchesSidebarSection } from './features/PatchesSidebarSection';
import { ReplayPanel } from './features/ReplayPanel';
import { SettingsPanel } from './features/SettingsPanel';
import { SnapshotsPanel } from './features/SnapshotsPanel';
import { TemplatesSidebarSection } from './features/TemplatesSidebarSection';
import { TestsPanel } from './features/TestsPanel';
import { TxBuilderPanel } from './features/TxBuilderPanel';
import { VersionCompareRunPanel } from './features/VersionCompareRunPanel';
import { WorkflowsPanel } from './features/WorkflowsPanel';
import type { ProgramEntry, Project, ProjectMeta, SessionMeta } from './types';
import { Badge, Button, IconButton, Input, Kbd, Pubkey, useTheme } from './ui';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const SIDEBAR_STORAGE_KEY = 'relay:sidebar-width';

function useSidebarWidth(): [number, (n: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(SIDEBAR_STORAGE_KEY) : null;
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
type WorkspaceTab = 'builder' | 'automations' | 'patches';
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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() => {
    if (typeof localStorage === 'undefined') return 'automations';
    const v = localStorage.getItem('relay:workspace-tab') as WorkspaceTab | null;
    if (v === 'automations' || v === 'patches') return v;
    // 'builder' is a headless tab opened only via template clicks — never persisted as default.
    if (v === 'builder') return 'automations';
    if (v === 'workflows' || v === 'tests') return 'automations';
    return 'automations';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('relay:workspace-tab', workspaceTab);
  }, [workspaceTab]);

  // Tx template loader — when set, the Tx Builder workspace tab boots with
  // this template id (or null = blank). Cleared once builder consumes it.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null | undefined>(undefined);
  const openTemplateInBuilder = useCallback((tplId: string | null) => {
    setPendingTemplateId(tplId);
    setActiveTemplateId(tplId);
    setNavView('workspace');
    setWorkspaceTab('builder');
  }, []);

  // Automation open intent — routes to Automations workspace + auto-opens
  // the item in its editor view (skips the in-panel list). Active IDs
  // double as the sidebar highlight key.
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null | undefined>(undefined);
  const [pendingTestSuiteId, setPendingTestSuiteId] = useState<string | null | undefined>(
    undefined,
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [activeTestSuiteId, setActiveTestSuiteId] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  // 'home' = AutomationsHome (recent runs / CTAs). 'workflow' / 'test' =
  // specific item open. Persisted last non-home mode so a deep sidebar
  // selection survives reload.
  const [automationsMode, setAutomationsMode] = useState<'home' | 'workflow' | 'test'>('home');
  const openAutomation = useCallback((kind: 'workflow' | 'testSuite', id: string | null) => {
    if (kind === 'workflow') {
      setPendingWorkflowId(id);
      setActiveWorkflowId(id);
      setPendingTestSuiteId(undefined);
      setActiveTestSuiteId(null);
      setAutomationsMode('workflow');
    } else {
      setPendingTestSuiteId(id);
      setActiveTestSuiteId(id);
      setPendingWorkflowId(undefined);
      setActiveWorkflowId(null);
      setAutomationsMode('test');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('relay:automations-mode', kind === 'workflow' ? 'workflow' : 'test');
    }
    setNavView('workspace');
    setWorkspaceTab('automations');
  }, []);
  const goToAutomationsHome = useCallback(() => {
    setAutomationsMode('home');
    setPendingWorkflowId(undefined);
    setPendingTestSuiteId(undefined);
    setActiveWorkflowId(null);
    setActiveTestSuiteId(null);
  }, []);

  // Patch open intent — opens the Inspector modal on the patch's target account.
  const openPatchTarget = useCallback((address: string) => {
    setPendingAccountAddress(address);
    setModal('inspectAccount');
  }, []);

  // Patches workspace tab focus scope — drives which sub-panel is highlighted
  // and scrolled into view when the user clicks a Patches sidebar sub-section
  // header (Project / Sandbox).
  const [patchesFocusScope, setPatchesFocusScope] = useState<'project' | 'sandbox' | null>(null);
  const openPatchesTab = useCallback((scope: 'project' | 'sandbox') => {
    setPatchesFocusScope(scope);
    setNavView('workspace');
    setWorkspaceTab('patches');
  }, []);

  // Latest workflow / test-suite run result — pushed up by the panels so the
  // bottom console can show it as a tab instead of a buried inline section.
  // Counter bumps each new run so ConsoleDock can one-shot flip to Results
  // without needing two-way tab state (which caused render loops).
  const [runRecord, setRunRecord] = useState<RunRecord | null>(null);
  const [runRecordCounter, setRunRecordCounter] = useState(0);
  const pushRunRecord = useCallback((rec: RunRecord): void => {
    setRunRecord(rec);
    setRunRecordCounter((n) => n + 1);
    setHistoryDockOpen(true);
    if (typeof localStorage !== 'undefined') localStorage.setItem('relay:history-dock', '1');
  }, []);

  // History bottom dock — collapsible. ⌘J toggles. Per-window persisted.
  const [historyDockOpen, setHistoryDockOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:history-dock') === '1';
  });
  const toggleHistoryDock = useCallback(() => {
    setHistoryDockOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:history-dock', next ? '1' : '0');
      return next;
    });
  }, []);
  const [helpSkillId, setHelpSkillId] = useState<string>('reley-overview');
  // Open Help in the right inspector pane (not as a workspace sub-tab).
  // updateInspectorTab + rightCollapsed are defined below — we wrap the
  // call so it picks up the latest references at click time.
  const openHelp = (skillId: string): void => {
    setHelpSkillId(skillId);
    setInspectorTab('help');
    if (rightCollapsed) setRightCollapsed(false);
  };

  // Per-project flag for the first-run goal picker. Stored in localStorage
  // so dismiss survives reloads. Key is per project id.
  const goalKey = (pid: string): string => `relay:goal-dismissed:${pid}`;
  const [goalDismissed, setGoalDismissed] = useState<boolean>(false);
  useEffect(() => {
    if (!activeProjectId) {
      setGoalDismissed(false);
      return;
    }
    setGoalDismissed(
      typeof localStorage !== 'undefined' && localStorage.getItem(goalKey(activeProjectId)) === '1',
    );
  }, [activeProjectId]);
  const dismissGoal = (): void => {
    setGoalDismissed(true);
    if (activeProjectId && typeof localStorage !== 'undefined') {
      localStorage.setItem(goalKey(activeProjectId), '1');
    }
  };
  const onGoalPick = (goal: 'workflow' | 'testSuite'): void => {
    dismissGoal();
    // Route to the matching editor with a blank doc. openAutomation handles
    // nav/tab/mode + signals the inner panel via pendingId=null to enter
    // create flow.
    openAutomation(goal, null);
  };

  const [modal, setModal] = useState<
    | 'addProgram'
    | 'addAccount'
    | 'attachIdl'
    | 'patchAccount'
    | 'inspectAccount'
    | 'addProgramVersion'
    | 'diffIdl'
    | 'compareVersionsRun'
    | null
  >(null);
  const [pendingProgramId, setPendingProgramId] = useState<string | null>(null);
  const [pendingAccountAddress, setPendingAccountAddress] = useState<string | null>(null);
  const [pendingPatchScope, setPendingPatchScope] = useState<'project' | 'session' | null>(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const exportRef = useRef<() => void>(() => {});

  useEffect(() => {
    return api.onMenu((cmd) => {
      if (cmd === 'open-settings') setSettingsOpen(true);
      if (cmd === 'show-tour') setTourOpen(true);
      if (cmd === 'export-project') exportRef.current();
      if (cmd === 'import-project') {
        void api
          .call<{ canceled?: boolean; projectPath?: string; fileCount?: number }>(
            'app.importProjectZip',
            {},
          )
          .catch((e: unknown) => {
            console.error('import failed', e);
          });
      }
      if (cmd === 'show-welcome-intro') {
        // Reset the welcome intro auto-hide flags so the cards reappear the
        // next time the Welcome screen opens. If a project window is focused
        // (so no Welcome screen visible), surface the quick-start tour as a
        // sensible secondary action.
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('relay:welcome-intro-dismissed');
          localStorage.setItem('relay:welcome-open-count', '0');
        }
        setTourOpen(true);
      }
    });
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
  const [sessionPins, setSessionPins] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!activeSessionId) {
      setSessionPins({});
      return;
    }
    void api
      .call<Record<string, string>>('session.getVersionPins', { sessionId: activeSessionId })
      .then(setSessionPins)
      .catch(() => setSessionPins({}));
  }, [activeSessionId, activeProject?.id]);
  const [hiddenPrograms, setHiddenPrograms] = useState<Set<string>>(new Set());
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [programsSectionOpen, setProgramsSectionOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('relay:section-programs') !== '0';
  });
  const [sessionsSectionOpen, setSessionsSectionOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    // Read new key first; fall back to legacy `relay:section-sessions` for
    // existing users.
    const next =
      localStorage.getItem('relay:section-sandboxes') ??
      localStorage.getItem('relay:section-sessions');
    return next !== '0';
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
      if (typeof localStorage !== 'undefined') {
        // Write the new key. Leave the legacy key in place so an older app
        // version reading it still gets a value (forward compat).
        localStorage.setItem('relay:section-sandboxes', next ? '1' : '0');
      }
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
  const dialogs = useDialogs();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const exportActiveProject = useCallback(
    async (projectName?: string): Promise<void> => {
      try {
        const result = await api.call<{
          zipBase64: string;
          suggestedFileName: string;
        }>('project.export', {});
        const saved = await api.call<{ canceled: boolean; path?: string; bytes?: number }>(
          'app.dialog.saveZip',
          {
            defaultPath: result.suggestedFileName,
            contentBase64: result.zipBase64,
            title: projectName ? `Export ${projectName}` : 'Export project',
          },
        );
        if (!saved.canceled && saved.path) toast.success(`Exported to ${saved.path}`);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [toast],
  );

  // Bridge for menu-bar "File > Export" — needs to call exportActiveProject
  // with the current activeProject name without re-binding the menu listener.
  useEffect(() => {
    exportRef.current = () => void exportActiveProject(activeProject?.name);
  });

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

  // Auto-collapse the inspector on narrow viewports so the workspace doesn't
  // get squeezed. Threshold matches the layout audit: under 1200px wide,
  // sidebar (200+) + workspace + inspector (320+) leaves < 500px usable.
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerWidth < 1200) {
        setRightCollapsed(true);
      }
      if (window.innerWidth < 900) {
        setLeftCollapsed(true);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard: Ctrl/Cmd + B toggle left, Ctrl/Cmd + Alt + B toggle right,
  // Ctrl/Cmd + J toggle history dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (e.altKey) toggleRight();
        else toggleLeft();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleHistoryDock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleLeft, toggleRight, toggleHistoryDock]);
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
      // Auto-select a sandbox so newbies don't have to. Prefer the default,
      // then the first. Only acts when nothing is selected for this project's
      // sandbox set.
      setActiveSessionId((prev) => {
        if (prev && sess.some((s) => s.id === prev)) return prev;
        const def = sess.find((s) => s.isDefault) ?? sess[0];
        return def?.id ?? null;
      });
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

  // Inline "New sandbox" prompt — replaces the old NewSessionForm modal. The
  // form's only required field is a name, so a simple dialogs.prompt() flow
  // removes a full modal mount + 2 extra clicks. Defined here (not above the
  // earlier section) because it depends on `dialogs`, `toast`, and
  // `reloadProject` which are declared later.
  const promptNewSandbox = useCallback(async (): Promise<void> => {
    if (!activeProjectId) return;
    const name = await dialogs.prompt({
      title: 'New sandbox',
      label: 'Name',
      placeholder: 'happy-path',
      confirmText: 'Create',
    });
    if (!name?.trim()) return;
    try {
      const sb = await api.call<{ id: string }>('session.create', {
        projectId: activeProjectId,
        name: name.trim(),
      });
      if (sb?.id) setActiveSessionId(sb.id);
      await reloadProject(activeProjectId);
    } catch (e) {
      toast.error(String(e));
    }
  }, [activeProjectId, dialogs, reloadProject, toast]);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  // Drag-and-drop a .so file onto the project window → add as local program
  // (or new version if program id already exists). .so bytes carry no
  // programId so we prompt the user.
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (!activeProjectId) return;
      const files = Array.from(e.dataTransfer.files);
      const so = files.find((f) => f.name.endsWith('.so'));
      if (!so) return;
      e.preventDefault();
      const fileLabel = so.name.replace(/\.so$/, '');
      const buf = await so.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let bytesBase64 = '';
      // btoa chokes on huge strings; chunk to be safe.
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK) {
        bytesBase64 += String.fromCharCode(...u8.subarray(i, i + CHUNK));
      }
      bytesBase64 = btoa(bytesBase64);
      setPrompt({
        options: {
          title: `Add "${so.name}" as local program`,
          label: 'Program ID',
          placeholder: 'base58 program id',
          confirmText: 'Add',
        },
        onConfirm: async (programId) => {
          setPrompt(null);
          const pid = programId.trim();
          if (!pid) return;
          try {
            const r = await api.call<{ kind: string; programId: string; versionId?: string }>(
              'program.addLocal',
              {
                projectId: activeProjectId,
                programId: pid,
                label: fileLabel,
                bytesBase64,
                filePath: so.name,
              },
            );
            toast.success(
              r.kind === 'versionAdded'
                ? `new version added to ${pid.slice(0, 8)}…`
                : `program added · ${fileLabel}`,
            );
            await reloadProject(activeProjectId);
          } catch (err) {
            toast.error(String(err));
          }
        },
      });
    },
    [activeProjectId, reloadProject, toast],
  );
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Background auto-reload: main process watches <projectRoot>/.relay.json
  // and <projectRoot>/.relay/. On any external change, ask the worker to
  // re-read from disk, then refresh the renderer cache.
  useEffect(() => {
    if (!activeProjectId) return;
    return api.onFilesChanged(() => {
      void (async () => {
        try {
          const project = await api.call<Project>('project.reload');
          if (project) {
            setActiveProject(project);
            const sess = await api.call<SessionMeta[]>('session.list', { projectId: project.id });
            setSessions(sess);
            const idls = await api.call<Array<{ programId: string }>>('idl.list');
            setIdlAttached(new Set(idls.map((i) => i.programId)));
            setExpandedPrograms((prev) => {
              if (prev.size === 0) return new Set(Object.keys(project.programs));
              return prev;
            });
          }
        } catch {
          /* worker may be mid-spawn; next event retries */
        }
        setFilesRefreshKey((k) => k + 1);
      })();
    });
  }, [activeProjectId]);

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
      { id: 'keypairs', label: 'Keypairs' },
      { id: 'snapshots', label: 'Snapshots' },
      // Replay temporarily hidden — re-enable here + in the nav rail above.
      // { id: 'replay', label: 'Replay' },
    ];
    for (const v of views) {
      items.push({
        id: `view:${v.id}`,
        group: 'View',
        label: v.label,
        onSelect: () => setNavView(v.id),
      });
    }

    // Workspace tabs (activity-rail entries)
    const tabs: Array<{ id: WorkspaceTab; label: string }> = [
      { id: 'builder', label: 'Tx Builder' },
      { id: 'automations', label: 'Automations (Workflows + Tests)' },
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
        label: 'New sandbox…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && void promptNewSandbox(),
      },
      {
        id: 'cmd:add-program',
        group: 'Command',
        label: 'Add program…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && setModal('addProgram'),
      },
      {
        id: 'cmd:new-workflow',
        group: 'Command',
        label: 'New workflow…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && openAutomation('workflow', null),
      },
      {
        id: 'cmd:new-test-suite',
        group: 'Command',
        label: 'New test suite…',
        hint: activeProjectId ? '' : '(open a project first)',
        onSelect: () => activeProjectId && openAutomation('testSuite', null),
      },
      {
        id: 'cmd:open-demo',
        group: 'Command',
        label: 'Open demo project',
        hint: 'preset Reley Demo with builtins + sample artifacts',
        onSelect: () => void api.call('app.showWelcome'),
      },
      {
        id: 'cmd:reset-sandbox',
        group: 'Command',
        label: 'Reset sandbox to baseline',
        hint: activeSessionId ? '' : '(no sandbox selected)',
        onSelect: async () => {
          if (!activeSessionId) return;
          const ok = await dialogs.confirm({
            title: 'Reset sandbox?',
            message: 'Wipes all mutations + history. Patches re-apply.',
            danger: true,
            confirmText: 'Reset',
          });
          if (!ok) return;
          try {
            await api.call('session.reset', { sessionId: activeSessionId });
            if (activeProjectId) await reloadProject(activeProjectId);
            toast.success('Sandbox reset');
          } catch (e) {
            toast.error(String(e));
          }
        },
      },
      {
        id: 'cmd:toggle-history-dock',
        group: 'Command',
        label: 'Toggle history dock',
        hint: '⌘J',
        onSelect: () => toggleHistoryDock(),
      },
      {
        id: 'cmd:toggle-left-sidebar',
        group: 'Command',
        label: 'Toggle sidebar',
        hint: '⌘B',
        onSelect: () => toggleLeft(),
      },
      {
        id: 'cmd:open-help',
        group: 'Command',
        label: 'Open glossary / help',
        onSelect: () => openHelp('reley-overview'),
      },
      {
        id: 'cmd:show-tour',
        group: 'Command',
        label: 'Show quick-start tour',
        hint: '4 steps · orientation refresher',
        onSelect: () => setTourOpen(true),
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

    // Sandboxes
    for (const s of sessions) {
      items.push({
        id: `session:${s.id}`,
        group: 'Sandbox',
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
      label: 'Export project as .zip…',
      onSelect: () => void exportActiveProject(p.name),
    },
    {
      label: 'Delete project',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Delete project',
          message: `"${p.name}" and all its sandboxes, programs, accounts, and snapshots will be permanently removed.`,
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
    const versions = prog?.versions ?? [];
    const activeVersionId = prog?.activeVersionId;
    return [
      ...(versions.length > 1
        ? (versions.map((v) => ({
            label: `${v.id === activeVersionId ? '● ' : '  '}Use version: ${v.label}`,
            onSelect: () =>
              safeCall(async () => {
                if (!activeProjectId) return;
                await api.call('program.versionSetActive', {
                  projectId: activeProjectId,
                  programId,
                  versionId: v.id,
                });
                await reloadProject(activeProjectId);
              }, `switched to ${v.label}`),
          })) as MenuItem[])
        : []),
      {
        label: 'Add version…',
        onSelect: () => {
          setPendingProgramId(programId);
          setModal('addProgramVersion');
        },
      },
      {
        label: 'Diff IDLs…',
        onSelect: () => setModal('diffIdl'),
      },
      ...(versions.length > 1
        ? ([
            {
              label: 'Compare run across versions…',
              onSelect: () => {
                setPendingProgramId(programId);
                setModal('compareVersionsRun');
              },
            },
          ] as MenuItem[])
        : []),
      ...(versions.length > 1 && activeSessionId
        ? (versions.map((v) => ({
            label: `Pin "${v.label}" for active sandbox`,
            onSelect: () =>
              safeCall(async () => {
                await api.call('program.versionPinForSession', {
                  sessionId: activeSessionId,
                  programId,
                  versionId: v.id,
                });
                const pins = await api.call<Record<string, string>>('session.getVersionPins', {
                  sessionId: activeSessionId,
                });
                setSessionPins(pins);
                if (activeProjectId) await reloadProject(activeProjectId);
              }, `pinned ${v.label} for sandbox`),
          })) as MenuItem[])
        : []),
      ...(versions.length > 1 && activeSessionId
        ? ([
            {
              label: 'Clear sandbox pin',
              onSelect: () =>
                safeCall(async () => {
                  await api.call('program.versionPinForSession', {
                    sessionId: activeSessionId,
                    programId,
                    versionId: null,
                  });
                  const pins = await api.call<Record<string, string>>('session.getVersionPins', {
                    sessionId: activeSessionId,
                  });
                  setSessionPins(pins);
                  if (activeProjectId) await reloadProject(activeProjectId);
                }, 'sandbox pin cleared'),
            },
          ] as MenuItem[])
        : []),
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
                () =>
                  api.call('program.setLabel', { projectId: activeProjectId, programId, label }),
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
      label: 'Rename sandbox…',
      onSelect: () =>
        setPrompt({
          options: { title: 'Rename sandbox', label: 'New name', initial: s.name },
          onConfirm: async (name) => {
            setPrompt(null);
            await safeCall(() => api.call('session.rename', { id: s.id, name }));
            if (activeProjectId) await reloadProject(activeProjectId);
          },
        }),
    },
    {
      label: 'Reset sandbox to baseline',
      onSelect: () =>
        setConfirm({
          title: 'Reset sandbox',
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
      label: 'Delete sandbox',
      danger: true,
      onSelect: () =>
        setConfirm({
          title: 'Delete sandbox',
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
          (a) => a.label.toLowerCase().includes(term) || a.address.toLowerCase().includes(term),
        );
      return hit;
    });
  }, [activeProject, searchTerm]);

  // Programs filter chips — refines the search-filtered list further.
  // 'all' = no extra filter. Persisted across sessions.
  type ProgramsFilter = 'all' | 'idl' | 'multi-version' | 'patched';
  const [programsFilter, setProgramsFilter] = useState<ProgramsFilter>(() => {
    if (typeof localStorage === 'undefined') return 'all';
    const v = localStorage.getItem('relay:programs-filter') as ProgramsFilter | null;
    if (v === 'idl' || v === 'multi-version' || v === 'patched') return v;
    return 'all';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('relay:programs-filter', programsFilter);
  }, [programsFilter]);

  // Per-program patch count — sum of project + sandbox patches whose target
  // is one of the program's account addresses. Cheap O(P × A × patches).
  const programPatchCount = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    if (!activeProject) return counts;
    const allPatches = [...(activeProject.patches as Array<{ target: string }>)];
    if (activeSessionId) {
      const sess = sessions.find((s) => s.id === activeSessionId);
      if (sess) {
        // session patches not directly on SessionMeta; fetched separately. We
        // skip them here — project-scope patches alone are the common case.
        void sess;
      }
    }
    for (const prog of Object.values(activeProject.programs)) {
      const addrs = new Set((prog.accounts ?? []).map((a) => a.address));
      let n = 0;
      for (const p of allPatches) if (addrs.has(p.target)) n += 1;
      counts[prog.programId] = n;
    }
    return counts;
  }, [activeProject, activeSessionId, sessions]);

  const programsFilterPass = useCallback(
    (p: ProgramEntry): boolean => {
      switch (programsFilter) {
        case 'idl':
          return idlAttached.has(p.programId);
        case 'multi-version':
          return Array.isArray(p.versions) && p.versions.length >= 2;
        case 'patched':
          return (programPatchCount[p.programId] ?? 0) > 0;
        default:
          return true;
      }
    },
    [programsFilter, idlAttached, programPatchCount],
  );

  const visiblePrograms = useMemo(
    () =>
      allFilteredPrograms
        .filter((p) => !hiddenPrograms.has(p.programId))
        .filter(programsFilterPass),
    [allFilteredPrograms, hiddenPrograms, programsFilterPass],
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
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <header
        className={`app-header${api.platform === 'darwin' ? ' is-mac' : api.platform === 'win32' ? ' is-win' : ' is-linux'}`}
      >
        <div className="app-header-left">
          <div
            className="title"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'Satoshi, Figtree, sans-serif',
              fontWeight: 900,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            <img
              src="./icon.svg"
              alt=""
              aria-hidden
              width={22}
              height={22}
              draggable={false}
              style={{ borderRadius: 5 }}
            />
            RELEY
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
          <button
            className="header-side-toggle"
            onClick={() => setTourOpen(true)}
            title="Show quick-start tour"
            aria-label="Quick-start tour"
          >
            <HelpCircle size={14} />
          </button>
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
            className={`header-side-toggle${historyDockOpen ? ' active' : ''}`}
            onClick={toggleHistoryDock}
            title={`${historyDockOpen ? 'Hide' : 'Show'} bottom panel — Tx history (⌘J)`}
            aria-label="Toggle bottom panel"
            aria-pressed={historyDockOpen}
          >
            {historyDockOpen ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
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
            {
              id: 'workspace',
              icon: <LayoutDashboard size={18} aria-hidden />,
              label: 'Workspace',
              tip: 'Workspace · build, test, automate',
            },
            {
              id: 'keypairs',
              icon: <Wallet size={18} aria-hidden />,
              label: 'Keypairs',
              tip: 'Signing keys · payers + authority',
            },
            {
              id: 'snapshots',
              icon: <Bookmark size={18} aria-hidden />,
              label: 'Snapshots',
              tip: 'Sandbox snapshots · save + restore state',
            },
            // Replay temporarily hidden — leave entry commented in so it's
            // easy to re-enable. Underlying ReplayPanel + handlers stay live
            // so existing record types + IPC keep building.
            // {
            //   id: 'replay',
            //   icon: <Rewind size={18} aria-hidden />,
            //   label: 'Replay',
            //   tip: 'Replay mainnet tx · forensics on real signatures',
            // },
          ] as Array<{ id: NavView; icon: ReactNode; label: string; tip: string }>
        ).map((v) => (
          <NavRailButton
            key={v.id}
            icon={v.icon}
            label={v.label}
            tip={v.tip}
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
                ? `${activeProjectMeta.network} · ${activeProjectMeta.programCount}p · ${activeProjectMeta.sessionCount}sb`
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

        {/* Sandbox dropdown — sits directly under project header. Single
            row when one sandbox, native <select> when many. Plus button
            spawns a new one. */}
        {activeProject && sessions.length === 0 && (
          <div className="sandbox-picker sandbox-picker-empty">
            <span className="sandbox-picker-label">
              Sandbox
              <HelpHint
                label="Sandbox"
                hint="Isolated local Solana env for testing. State is yours alone — mutate, warp time, reset freely."
                skillId="reley-sandbox"
                onOpen={openHelp}
              />
            </span>
            <button
              type="button"
              className="sandbox-picker-create"
              onClick={() => void promptNewSandbox()}
            >
              <Plus size={11} aria-hidden /> Create
            </button>
          </div>
        )}
        {activeProject && sessions.length > 0 && (
          <div className="sandbox-picker">
            <span className="sandbox-picker-label">
              Sandbox
              <HelpHint
                label="Sandbox"
                hint="Isolated local Solana env for testing. State is yours alone — mutate, warp time, reset freely."
                skillId="reley-sandbox"
                onOpen={openHelp}
              />
            </span>
            {sessions.length === 1 ? (
              <span className="sandbox-picker-single" title={sessions[0]!.name}>
                {sessions[0]!.name}
              </span>
            ) : (
              <select
                className="sandbox-picker-select"
                value={activeSessionId ?? ''}
                onChange={(e) => setActiveSessionId(e.target.value || null)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.mutationCount > 0 ? ' · dirty' : ''}
                    {s.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
            )}
            <IconButton
              icon={<Plus size={11} />}
              label="New sandbox"
              size="sm"
              variant="ghost"
              onClick={() => void promptNewSandbox()}
            />
          </div>
        )}

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
          <FilesTree selected={activeFile} onSelect={openFileTab} refreshKey={filesRefreshKey} />
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

            {/* Sandbox is now a dropdown at the top of the sidebar header;
                this tree section was removed. */}

            {/* Order (top → bottom): Automations · Tx Templates · Programs · Patches */}

            <AutomationsSidebarSection
              project={activeProject}
              onOpen={openAutomation}
              onChange={() => {
                if (activeProjectId) void reloadProject(activeProjectId);
              }}
              onOpenHelp={openHelp}
              activeWorkflowId={workspaceTab === 'automations' ? activeWorkflowId : null}
              activeTestSuiteId={workspaceTab === 'automations' ? activeTestSuiteId : null}
            />

            <TemplatesSidebarSection
              project={activeProject}
              onTemplateOpen={openTemplateInBuilder}
              onChange={() => {
                if (activeProjectId) void reloadProject(activeProjectId);
              }}
              onOpenHelp={openHelp}
              activeId={workspaceTab === 'builder' ? activeTemplateId : null}
            />

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
                  <HelpChip skillId="reley-versions" onOpen={openHelp} label="Programs" />
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

              {programsSectionOpen && Object.keys(activeProject.programs).length >= 4 && (
                <div className="programs-filter-bar">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'idl', label: 'IDL' },
                      { id: 'multi-version', label: 'multi-ver' },
                      { id: 'patched', label: 'patched' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`programs-filter-chip${programsFilter === f.id ? ' active' : ''}`}
                      onClick={() => setProgramsFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

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
                    searchTerm ? (
                      <div className="px-6 py-1.5 text-2xs text-text-subtle italic">no matches</div>
                    ) : (
                      <div className="tree-empty-cta">
                        <div className="tree-empty-title">No programs yet</div>
                        <div className="tree-empty-desc">
                          Add a Solana program to start testing.
                        </div>
                        <button
                          type="button"
                          className="tree-empty-action"
                          onClick={() => setModal('addProgram')}
                        >
                          <Plus size={11} aria-hidden /> Add program
                        </button>
                      </div>
                    )
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
                              <InlineRename
                                value={prog.label}
                                onCommit={async (next) => {
                                  if (!activeProjectId) return;
                                  await safeCall(
                                    () =>
                                      api.call('program.setLabel', {
                                        projectId: activeProjectId,
                                        programId: prog.programId,
                                        label: next,
                                      }),
                                    'program renamed',
                                  );
                                  await reloadProject(activeProjectId);
                                }}
                              />
                            </span>
                            <span className="tree-program-badges">
                              {hasIdl && (
                                <Badge size="sm" variant="accent">
                                  IDL
                                </Badge>
                              )}
                              {prog.versions && prog.versions.length > 0 && (
                                <Badge
                                  size="sm"
                                  variant={prog.versions.length > 1 ? 'warning' : 'default'}
                                  title={
                                    prog.versions.length > 1
                                      ? `${prog.versions.length} versions — right-click to switch`
                                      : 'Active version'
                                  }
                                >
                                  {prog.versions.find((v) => v.id === prog.activeVersionId)
                                    ?.label ?? 'v1'}
                                  {prog.versions.length > 1 && ` · ${prog.versions.length}`}
                                </Badge>
                              )}
                              {(programPatchCount[prog.programId] ?? 0) > 0 && (
                                <Badge
                                  size="sm"
                                  variant="warning"
                                  title={`${programPatchCount[prog.programId]} patch${
                                    programPatchCount[prog.programId] === 1 ? '' : 'es'
                                  } target accounts of this program`}
                                >
                                  ⚒{programPatchCount[prog.programId]}
                                </Badge>
                              )}
                              {sessionPins[prog.programId] && (
                                <Badge
                                  size="sm"
                                  variant="accent"
                                  title="Sandbox pin override active"
                                >
                                  pin:{' '}
                                  {prog.versions.find((v) => v.id === sessionPins[prog.programId])
                                    ?.label ?? '?'}
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
                              {prog.label.length > 24 ? `${prog.label.slice(0, 24)}…` : prog.label}
                            </span>
                          </button>
                        ))}
                    </>
                  )}
                </>
              )}
            </div>

            <PatchesSidebarSection
              project={activeProject}
              activeSandboxId={activeSessionId}
              activeFocusScope={workspaceTab === 'patches' ? patchesFocusScope : null}
              onOpenPatchesTab={openPatchesTab}
              onOpenHelp={openHelp}
            />
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
                <h2 style={{ marginBottom: 8 }}>Welcome to Reley</h2>
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
            ) : sidebarMode === 'files' ? (
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
              <div className="workspace-split">
                {/* Activity rail — vertical icon strip selecting the workspace panel. */}
                {/* Workspace activity rail removed — Templates / Automations /
                    Patches are now sidebar-driven entry points. The bottom
                    History dock keeps its own toggles (toolbar icon + ⌘J +
                    dock header close). */}

                {/* Center panel + bottom history dock */}
                <div className="workspace-center">
                  <div className="workspace-panel">
                    {activeProject && (
                      <EmptyProjectGuide
                        projectId={activeProject.id}
                        hasPrograms={Object.keys(activeProject.programs).length > 0}
                        hasAutomations={
                          (activeProject.workflows ?? []).length > 0 ||
                          (activeProject.testSuites ?? []).length > 0
                        }
                        hasRun={
                          typeof localStorage !== 'undefined' &&
                          Object.keys(localStorage).some((k) => k.startsWith('relay:lastrun:'))
                        }
                        onAddProgram={() => setModal('addProgram')}
                        onNewWorkflow={() => openAutomation('workflow', null)}
                        onOpenAutomations={() => {
                          setNavView('workspace');
                          setWorkspaceTab('automations');
                          goToAutomationsHome();
                          // Pop the bottom dock too so the user can see the
                          // Results tab where output will land once they
                          // click Run on something.
                          setHistoryDockOpen(true);
                          if (typeof localStorage !== 'undefined')
                            localStorage.setItem('relay:history-dock', '1');
                        }}
                      />
                    )}
                    {workspaceTab === 'builder' && (
                      <TxBuilderPanel
                        project={activeProject}
                        activeSessionId={activeSessionId}
                        pendingTemplateId={pendingTemplateId}
                        onTemplateConsumed={() => setPendingTemplateId(undefined)}
                        onOpenHelp={openHelp}
                      />
                    )}
                    {workspaceTab === 'automations' &&
                      activeProject &&
                      (automationsMode === 'home' ? (
                        <AutomationsHome
                          project={activeProject}
                          goalDismissed={goalDismissed}
                          onOpen={(kind, id) => openAutomation(kind, id)}
                          onPick={onGoalPick}
                          onDismissGoal={dismissGoal}
                        />
                      ) : automationsMode === 'test' ? (
                        <TestsPanel
                          project={activeProject}
                          activeSessionId={activeSessionId}
                          onSelectSession={setActiveSessionId}
                          onOpenHelp={openHelp}
                          pendingOpenId={pendingTestSuiteId}
                          onConsumePending={() => setPendingTestSuiteId(undefined)}
                          onBackToHome={goToAutomationsHome}
                          onPushRunRecord={pushRunRecord}
                        />
                      ) : (
                        <WorkflowsPanel
                          project={activeProject}
                          activeSessionId={activeSessionId}
                          onSelectSession={setActiveSessionId}
                          onOpenHelp={openHelp}
                          pendingOpenId={pendingWorkflowId}
                          onConsumePending={() => setPendingWorkflowId(undefined)}
                          onBackToHome={goToAutomationsHome}
                          onPushRunRecord={pushRunRecord}
                        />
                      ))}
                    {workspaceTab === 'patches' &&
                      ((patchesFocusScope ?? 'project') === 'sandbox' ? (
                        <SandboxPatchesPanel
                          project={activeProject}
                          activeSessionId={activeSessionId}
                          onChange={() => {
                            if (activeProjectId) void reloadProject(activeProjectId);
                          }}
                          onNewPatch={(scope) => {
                            setPendingAccountAddress(null);
                            setPendingPatchScope(scope);
                            setModal('patchAccount');
                          }}
                        />
                      ) : (
                        <ProjectPatchesPanel
                          project={activeProject}
                          onChange={() => {
                            if (activeProjectId) void reloadProject(activeProjectId);
                          }}
                          onNewPatch={(scope) => {
                            setPendingAccountAddress(null);
                            setPendingPatchScope(scope);
                            setModal('patchAccount');
                          }}
                        />
                      ))}
                  </div>
                  {historyDockOpen && (
                    <ConsoleDock
                      activeSessionId={activeSessionId}
                      onClose={toggleHistoryDock}
                      runRecord={runRecord}
                      runRecordId={runRecordCounter}
                    />
                  )}
                </div>
              </div>
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
        helpSkillId={helpSkillId}
      />

      <nav className="inspector-rail">
        {(
          [
            { id: 'help', icon: <HelpCircle size={14} aria-hidden />, label: 'Help' },
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
      {modal === 'addProgramVersion' && activeProjectId && pendingProgramId && (
        <Modal onClose={() => setModal(null)}>
          <AddProgramVersionForm
            projectId={activeProjectId}
            programId={pendingProgramId}
            onDone={async () => {
              setModal(null);
              await reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'diffIdl' && (
        <Modal onClose={() => setModal(null)}>
          <IdlDiffPanel onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === 'compareVersionsRun' && activeProject && (
        <Modal onClose={() => setModal(null)}>
          <VersionCompareRunPanel
            project={activeProject}
            activeSessionId={activeSessionId}
            {...(pendingProgramId && { initialProgramId: pendingProgramId })}
            onClose={() => setModal(null)}
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
            activeSessionId={activeSessionId}
            onClose={() => setModal(null)}
            onPatchRequested={() => setModal('patchAccount')}
            onPatchesChanged={() => {
              if (activeProjectId) void reloadProject(activeProjectId);
            }}
          />
        </Modal>
      )}
      {modal === 'patchAccount' && activeProjectId && (
        <Modal onClose={() => setModal(null)}>
          <PatchAccountForm
            projectId={activeProjectId}
            sessionId={activeSessionId}
            sessions={sessions}
            address={pendingAccountAddress ?? undefined}
            project={activeProject}
            initialScope={pendingPatchScope ?? undefined}
            onDone={async () => {
              setModal(null);
              setPendingPatchScope(null);
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

      <OnboardingTour forceOpen={tourOpen} onClose={() => setTourOpen(false)} />

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
              <span className="status-item" title="Active sandbox">
                <span className="status-dot" />
                <span>{sessions.find((s) => s.id === activeSessionId)?.name ?? '?'}</span>
              </span>
            )}
          </>
        ) : (
          <span className="status-item">no project</span>
        )}
        {activeProject &&
          (() => {
            // Compute setup progress (mirrors EmptyProjectGuide logic).
            const hasPrograms = Object.keys(activeProject.programs).length > 0;
            const hasAutomations =
              (activeProject.workflows ?? []).length > 0 ||
              (activeProject.testSuites ?? []).length > 0;
            const hasRun =
              typeof localStorage !== 'undefined' &&
              Object.keys(localStorage).some((k) => k.startsWith('relay:lastrun:'));
            const done = (hasPrograms ? 1 : 0) + (hasAutomations ? 1 : 0) + (hasRun ? 1 : 0);
            if (done >= 3) return null;
            return (
              <button
                type="button"
                className="status-item interactive setup-chip"
                onClick={() => setTourOpen(true)}
                title="Click for the quick-start tour"
              >
                <HelpCircle size={11} aria-hidden />
                <span>Setup: {done}/3</span>
              </button>
            );
          })()}
        <span className="status-spacer" />
        <a
          className="status-item interactive"
          href="https://xitadel.fi"
          target="_blank"
          rel="noreferrer"
          title="Reley is built by Xitadel"
          style={{ textDecoration: 'none' }}
        >
          <span style={{ color: 'rgb(var(--color-text-muted))', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Built by</span>
          <span style={{ fontFamily: 'Satoshi, Figtree, sans-serif', fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Xitadel
          </span>
        </a>
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

      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function SettingsOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" style={{ top: 40 /* header height */ }}>
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-surface-0">
        <div className="text-xs uppercase tracking-widest text-text-subtle font-semibold">
          Settings
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close (Esc)"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text hover:bg-surface-1 transition-colors"
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <SettingsPanel />
      </div>
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
                <span aria-hidden className="absolute top-0 left-0 right-0 h-[2px] bg-accent" />
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
    | {
        kind: 'program';
        programId: string;
        label: string;
        hasIdl: boolean;
        source: string | null;
        count: number;
      }
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

// InlineRename moved to ./components/InlineRename — re-imported above.

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
  tip: customTip,
  active,
  collapsed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  /** Optional richer hover hint. Defaults to `label`. */
  tip?: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}): JSX.Element {
  const classes = ['nav-rail-item'];
  if (active) classes.push('active');
  if (collapsed) classes.push('collapsed');
  const base = customTip ?? label;
  const tip = active
    ? collapsed
      ? `Show sidebar — ${base} (⌘B)`
      : `Hide sidebar — ${base} (⌘B)`
    : base;
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
