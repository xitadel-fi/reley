import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Folder,
  FolderOpen,
  HelpCircle,
  Plus,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import { ContextMenu, type MenuItem, useContextMenu } from '../components/ContextMenu';
import { InlineRename } from '../components/InlineRename';
import { useTreeSelection } from '../components/useTreeSelection';
import type { Project, TreeFolder } from '../types';

interface Workflow {
  id: string;
  name: string;
  description: string;
  folderId?: string | null;
}
interface TestSuite {
  id: string;
  name: string;
  description: string;
  folderId?: string | null;
}

type ItemKind = 'workflow' | 'testSuite';
interface FlatItem {
  kind: ItemKind;
  id: string;
  name: string;
  description: string;
  folderId?: string | null;
}

/**
 * Automations section in the left sidebar — lists workflows + test suites
 * together, grouped by folder. Click a workflow opens the Automations
 * workspace in Workflow mode; click a test suite opens it in Test mode.
 *
 * Folders are tracked separately per kind via TreeFolder.section
 * ('workflows' or 'testSuites').
 */
export function AutomationsSidebarSection({
  project,
  onOpen,
  onChange,
  onOpenHelp,
  activeWorkflowId,
  activeTestSuiteId,
}: {
  project: Project;
  /** Open an automation in the workspace. */
  onOpen: (kind: ItemKind, id: string | null) => void;
  onChange: () => void;
  onOpenHelp?: (skillId: string) => void;
  activeWorkflowId?: string | null;
  activeTestSuiteId?: string | null;
}): JSX.Element {
  const ctx = useContextMenu();
  const toast = useToast();
  const dialogs = useDialogs();

  const [open, setOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:section-automations') === '1';
  });
  const toggleOpen = (): void => {
    setOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-automations', next ? '1' : '0');
      return next;
    });
  };
  // Independent collapsed state for the two sub-sections.
  const [wfOpen, setWfOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('relay:section-automations-workflows') !== '0';
  });
  const toggleWfOpen = (): void => {
    setWfOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-automations-workflows', next ? '1' : '0');
      return next;
    });
  };
  const [tsOpen, setTsOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('relay:section-automations-tests') !== '0';
  });
  const toggleTsOpen = (): void => {
    setTsOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-automations-tests', next ? '1' : '0');
      return next;
    });
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleFolder = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const workflowFolders = useMemo<TreeFolder[]>(
    () => (project.folders ?? []).filter((f) => f.section === 'workflows'),
    [project.folders],
  );
  const testFolders = useMemo<TreeFolder[]>(
    () => (project.folders ?? []).filter((f) => f.section === 'testSuites'),
    [project.folders],
  );
  const workflows = useMemo<Workflow[]>(
    () => ((project.workflows ?? []) as Workflow[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [project.workflows],
  );
  const testSuites = useMemo<TestSuite[]>(
    () =>
      ((project.testSuites ?? []) as TestSuite[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [project.testSuites],
  );

  const totalCount = workflows.length + testSuites.length;

  // ───── Folder operations ─────
  const sectionFor = (kind: ItemKind): 'workflows' | 'testSuites' =>
    kind === 'workflow' ? 'workflows' : 'testSuites';
  const createFolder = async (section: 'workflows' | 'testSuites', parentId: string | null): Promise<void> => {
    const name = await dialogs.prompt({
      title: `New ${section === 'workflows' ? 'workflow' : 'test suite'} folder`,
      label: 'Folder name',
      placeholder: 'e.g. Swaps',
      confirmText: 'Create',
    });
    if (!name?.trim()) return;
    try {
      await api.call('project.folderCreate', {
        projectId: project.id,
        section,
        name: name.trim(),
        parentId,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const renameFolder = async (f: TreeFolder): Promise<void> => {
    const name = await dialogs.prompt({
      title: 'Rename folder',
      label: 'New name',
      initial: f.name,
    });
    if (!name?.trim() || name.trim() === f.name) return;
    try {
      await api.call('project.folderRename', {
        projectId: project.id,
        folderId: f.id,
        name: name.trim(),
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const removeFolder = async (f: TreeFolder, mode: 'merge-up' | 'recursive'): Promise<void> => {
    const ok = await dialogs.confirm({
      title: `Delete folder "${f.name}"?`,
      message:
        mode === 'recursive'
          ? 'Folder + nested folders deleted. Items detached to root (items themselves NOT deleted).'
          : 'Folder removed. Children bubble up to its parent.',
      danger: true,
      confirmText: 'Delete folder',
    });
    if (!ok) return;
    try {
      await api.call('project.folderRemove', {
        projectId: project.id,
        folderId: f.id,
        mode,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const renameItem = async (kind: ItemKind, id: string, name: string): Promise<void> => {
    try {
      if (kind === 'workflow') {
        const wf = workflows.find((w) => w.id === id) as
          | { id: string; description: string; steps?: unknown[] }
          | undefined;
        if (!wf) return;
        await api.call('workflow.save', {
          projectId: project.id,
          id,
          name,
          description: wf.description,
          steps: wf.steps ?? [],
        });
      } else {
        const ts = testSuites.find((t) => t.id === id) as
          | { id: string; description: string; cases?: unknown[] }
          | undefined;
        if (!ts) return;
        await api.call('testSuite.save', {
          projectId: project.id,
          id,
          name,
          description: ts.description,
          cases: ts.cases ?? [],
        });
      }
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const moveItem = async (kind: ItemKind, id: string, folderId: string | null): Promise<void> => {
    try {
      await api.call('project.itemMove', {
        projectId: project.id,
        kind,
        id,
        folderId,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const deleteItem = async (item: FlatItem): Promise<void> => {
    const ok = await dialogs.confirm({
      title: `Delete ${item.kind === 'workflow' ? 'workflow' : 'test suite'}`,
      message: `Permanently remove "${item.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      const method = item.kind === 'workflow' ? 'workflow.delete' : 'testSuite.delete';
      await api.call(method, { projectId: project.id, id: item.id });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const folderMenu = (f: TreeFolder): MenuItem[] => [
    {
      label: 'New folder here…',
      onSelect: () => void createFolder(f.section as 'workflows' | 'testSuites', f.id),
    },
    { label: 'Rename folder…', onSelect: () => void renameFolder(f) },
    { label: 'Delete (move children up)', onSelect: () => void removeFolder(f, 'merge-up') },
    {
      label: 'Delete + detach all (recursive)',
      danger: true,
      onSelect: () => void removeFolder(f, 'recursive'),
    },
  ];
  const batchItemMenu = (kind: ItemKind, ids: Set<string>): MenuItem[] => {
    const folders = kind === 'workflow' ? workflowFolders : testFolders;
    const list = kind === 'workflow' ? workflows : testSuites;
    const out: MenuItem[] = [
      {
        label: `Move ${ids.size} to root`,
        onSelect: () => {
          for (const id of ids) void moveItem(kind, id, null);
        },
      },
    ];
    for (const f of folders) {
      out.push({
        label: `Move ${ids.size} → ${f.name}`,
        onSelect: () => {
          for (const id of ids) void moveItem(kind, id, f.id);
        },
      });
    }
    out.push({
      label: `Delete ${ids.size} ${kind === 'workflow' ? 'workflows' : 'test suites'}`,
      danger: true,
      onSelect: async () => {
        const ok = await dialogs.confirm({
          title: `Delete ${ids.size}?`,
          message: 'Permanent.',
          danger: true,
          confirmText: 'Delete all',
        });
        if (!ok) return;
        const method = kind === 'workflow' ? 'workflow.delete' : 'testSuite.delete';
        for (const id of ids) {
          try {
            await api.call(method, { projectId: project.id, id });
          } catch (e) {
            toast.error(String(e));
          }
        }
        (kind === 'workflow' ? selWf : selTs).clear();
        onChange();
        void list;
      },
    });
    return out;
  };

  const itemMenu = (item: FlatItem): MenuItem[] => {
    const folders = item.kind === 'workflow' ? workflowFolders : testFolders;
    const items: MenuItem[] = [
      { label: 'Open', onSelect: () => onOpen(item.kind, item.id) },
    ];
    if (item.folderId) {
      items.push({
        label: 'Move to root',
        onSelect: () => void moveItem(item.kind, item.id, null),
      });
    }
    for (const f of folders) {
      if (f.id === item.folderId) continue;
      items.push({
        label: `Move → ${f.name}`,
        onSelect: () => void moveItem(item.kind, item.id, f.id),
      });
    }
    items.push({
      label: 'Delete',
      danger: true,
      onSelect: () => void deleteItem(item),
    });
    return items;
  };

  // Group items by their respective folders.
  const workflowsIn = (folderId: string): Workflow[] =>
    workflows.filter((w) => w.folderId === folderId);
  const testsIn = (folderId: string): TestSuite[] =>
    testSuites.filter((t) => t.folderId === folderId);
  const childrenOf = (section: 'workflows' | 'testSuites', parentId: string | null): TreeFolder[] =>
    (section === 'workflows' ? workflowFolders : testFolders).filter(
      (f) => (f.parentId ?? null) === parentId,
    );

  // Per-kind selection (workflows + tests are distinct selection sets so
  // dragging from one kind never moves the other).
  const wfFlatIds = useMemo(() => workflows.map((w) => w.id), [workflows]);
  const tsFlatIds = useMemo(() => testSuites.map((t) => t.id), [testSuites]);
  const selWf = useTreeSelection(wfFlatIds);
  const selTs = useTreeSelection(tsFlatIds);

  // Drag-drop: drag id encodes "kind:id1,id2,…" so the drop target knows
  // which collection to mutate + can batch-move multiple.
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const onDragStartItem = (e: React.DragEvent, kind: ItemKind, id: string): void => {
    const sel = kind === 'workflow' ? selWf : selTs;
    const payload =
      sel.selected.has(id) && sel.selected.size > 1
        ? Array.from(sel.selected).join(',')
        : id;
    e.dataTransfer.setData('application/x-relay-automation', `${kind}:${payload}`);
    e.dataTransfer.setData('relay/automation', `${kind}:${payload}`);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropToFolder = async (
    e: React.DragEvent,
    folderId: string | null,
    section: 'workflows' | 'testSuites',
  ): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const raw =
      e.dataTransfer.getData('application/x-relay-automation') ||
      e.dataTransfer.getData('relay/automation');
    setDragOverFolder(null);
    if (!raw) return;
    const sepIdx = raw.indexOf(':');
    if (sepIdx < 0) return;
    const kind = raw.slice(0, sepIdx);
    const idsStr = raw.slice(sepIdx + 1);
    const expectedKind: ItemKind = section === 'workflows' ? 'workflow' : 'testSuite';
    if (kind !== expectedKind) return;
    const list = kind === 'workflow' ? workflows : testSuites;
    for (const id of idsStr.split(',').filter(Boolean)) {
      const item = list.find((x) => x.id === id);
      if (!item) continue;
      if ((item.folderId ?? null) === folderId) continue;
      await moveItem(kind as ItemKind, id, folderId);
    }
  };
  const onDragOverFolder = (
    e: React.DragEvent,
    folderId: string,
    _section: 'workflows' | 'testSuites',
  ): void => {
    if (
      !e.dataTransfer.types.includes('application/x-relay-automation') &&
      !e.dataTransfer.types.includes('relay/automation')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderId);
  };

  const renderFolder = (f: TreeFolder, depth: number): JSX.Element => {
    const isOpen = expanded.has(f.id);
    const section = f.section as 'workflows' | 'testSuites';
    const kids = childrenOf(section, f.id);
    const items =
      section === 'workflows'
        ? workflowsIn(f.id).map<FlatItem>((w) => ({
            kind: 'workflow',
            id: w.id,
            name: w.name,
            description: w.description,
            folderId: w.folderId,
          }))
        : testsIn(f.id).map<FlatItem>((t) => ({
            kind: 'testSuite',
            id: t.id,
            name: t.name,
            description: t.description,
            folderId: t.folderId,
          }));
    const isDragOver = dragOverFolder === f.id;
    return (
      <div key={f.id} className="tree-folder-wrap">
        <div
          role="button"
          tabIndex={0}
          className={`tree-folder${isDragOver ? ' drag-over' : ''}`}
          style={{ paddingLeft: 28 + depth * 16 }}
          onClick={() => toggleFolder(f.id)}
          onContextMenu={(e) => ctx.open(e, folderMenu(f))}
          onDragOver={(e) => onDragOverFolder(e, f.id, section)}
          onDragLeave={() => setDragOverFolder((v) => (v === f.id ? null : v))}
          onDrop={(e) => {
            e.stopPropagation();
            void onDropToFolder(e, f.id, section);
          }}
        >
          <span className="inline-flex text-text-subtle">
            {isOpen ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
          </span>
          {isOpen ? (
            <FolderOpen size={11} className="text-text-muted" aria-hidden />
          ) : (
            <Folder size={11} className="text-text-muted" aria-hidden />
          )}
          <span className="tree-folder-name">{f.name}</span>
          <span className="text-2xs text-text-subtle font-mono ml-auto pr-1">
            {items.length}
          </span>
        </div>
        {isOpen && (
          <>
            {kids.map((c) => renderFolder(c, depth + 1))}
            {items.map((it) => renderItem(it, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderItem = (item: FlatItem, depth: number): JSX.Element => {
    const isActive =
      (item.kind === 'workflow' && activeWorkflowId === item.id) ||
      (item.kind === 'testSuite' && activeTestSuiteId === item.id);
    const sel = item.kind === 'workflow' ? selWf : selTs;
    const isSel = sel.selected.has(item.id);
    return (
      <div
        key={`${item.kind}:${item.id}`}
        className={`tree-template${isActive ? ' active' : ''}${isSel ? ' selected' : ''}`}
        style={{ paddingLeft: 32 + depth * 16 }}
        onClick={(e) => {
          sel.onItemClick(item.id, e);
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) onOpen(item.kind, item.id);
        }}
        onContextMenu={(e) => {
          const focus = sel.ensureContains(item.id);
          if (focus.size > 1) ctx.open(e, batchItemMenu(item.kind, focus));
          else ctx.open(e, itemMenu(item));
        }}
        title={item.description || item.name}
        draggable
        onDragStart={(e) => onDragStartItem(e, item.kind, item.id)}
      >
        {item.kind === 'workflow' ? (
          <WorkflowIcon size={10} className="text-text-subtle" aria-hidden />
        ) : (
          <FlaskConical size={10} className="text-text-subtle" aria-hidden />
        )}
        <span className="tree-template-name">
          <InlineRename
            value={item.name}
            onCommit={(next) => void renameItem(item.kind, item.id, next)}
          />
        </span>
      </div>
    );
  };

  const rootWorkflows = workflows
    .filter((w) => !w.folderId)
    .map<FlatItem>((w) => ({
      kind: 'workflow',
      id: w.id,
      name: w.name,
      description: w.description,
      folderId: w.folderId,
    }));
  const rootTests = testSuites
    .filter((t) => !t.folderId)
    .map<FlatItem>((t) => ({
      kind: 'testSuite',
      id: t.id,
      name: t.name,
      description: t.description,
      folderId: t.folderId,
    }));

  return (
    <div className="tree-section">
      <button
        type="button"
        className="tree-section-header"
        onClick={toggleOpen}
        aria-expanded={open}
        title="Workflows = ordered tx sequences. Test Suites = multi-case assertions."
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="inline-flex text-text-subtle">
            {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
          </span>
          Automations
          {onOpenHelp && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHelp('relay-workflow');
              }}
              title="What is an automation?"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-text-subtle hover:text-accent hover:bg-surface-1"
            >
              <HelpCircle size={11} aria-hidden />
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tree-section-count">{totalCount}</span>
        </span>
      </button>
      {open && (
        <div className="tree-folder-list">
          {/* ─────── Workflows sub-section ─────── */}
          <button
            type="button"
            className="tree-subsection-header"
            onClick={toggleWfOpen}
            aria-expanded={wfOpen}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="inline-flex text-text-subtle">
                {wfOpen ? (
                  <ChevronDown size={10} aria-hidden />
                ) : (
                  <ChevronRight size={10} aria-hidden />
                )}
              </span>
              <WorkflowIcon size={10} className="text-text-muted" aria-hidden />
              <span>Workflows</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="tree-section-count">{workflows.length}</span>
              <span
                className="tree-section-add"
                title="New workflow folder"
                onClick={(e) => {
                  e.stopPropagation();
                  void createFolder('workflows', null);
                }}
              >
                <Folder size={11} aria-hidden />
              </span>
              <span
                className="tree-section-add"
                title="New workflow"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen('workflow', null);
                }}
              >
                <Plus size={11} aria-hidden />
              </span>
            </span>
          </button>
          {wfOpen && (
            <>
              {childrenOf('workflows', null).map((f) => renderFolder(f, 0))}
              {rootWorkflows.map((it) => renderItem(it, 0))}
              {workflows.length === 0 && workflowFolders.length === 0 && (
                <div className="tree-empty-cta">
                  <div className="tree-empty-title">No workflows yet</div>
                  <div className="tree-empty-desc">Chain tx, warps, resets.</div>
                  <button
                    type="button"
                    className="tree-empty-action"
                    onClick={() => onOpen('workflow', null)}
                  >
                    <Plus size={11} aria-hidden /> Create workflow
                  </button>
                </div>
              )}
            </>
          )}

          {/* ─────── Test Suites sub-section ─────── */}
          <button
            type="button"
            className="tree-subsection-header"
            onClick={toggleTsOpen}
            aria-expanded={tsOpen}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="inline-flex text-text-subtle">
                {tsOpen ? (
                  <ChevronDown size={10} aria-hidden />
                ) : (
                  <ChevronRight size={10} aria-hidden />
                )}
              </span>
              <FlaskConical size={10} className="text-text-muted" aria-hidden />
              <span>Test Suites</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="tree-section-count">{testSuites.length}</span>
              <span
                className="tree-section-add"
                title="New test-suite folder"
                onClick={(e) => {
                  e.stopPropagation();
                  void createFolder('testSuites', null);
                }}
              >
                <Folder size={11} aria-hidden />
              </span>
              <span
                className="tree-section-add"
                title="New test suite"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen('testSuite', null);
                }}
              >
                <Plus size={11} aria-hidden />
              </span>
            </span>
          </button>
          {tsOpen && (
            <>
              {childrenOf('testSuites', null).map((f) => renderFolder(f, 0))}
              {rootTests.map((it) => renderItem(it, 0))}
              {testSuites.length === 0 && testFolders.length === 0 && (
                <div className="tree-empty-cta">
                  <div className="tree-empty-title">No test suites yet</div>
                  <div className="tree-empty-desc">Assert behavior with expectations.</div>
                  <button
                    type="button"
                    className="tree-empty-action"
                    onClick={() => onOpen('testSuite', null)}
                  >
                    <Plus size={11} aria-hidden /> Create test suite
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
