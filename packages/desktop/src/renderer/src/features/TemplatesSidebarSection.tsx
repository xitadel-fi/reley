import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  HelpCircle,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import { ContextMenu, type MenuItem, useContextMenu } from '../components/ContextMenu';
import { InlineRename } from '../components/InlineRename';
import { useTreeSelection } from '../components/useTreeSelection';
import type { Project, TreeFolder } from '../types';

interface TxTemplate {
  id: string;
  name: string;
  description: string;
  folderId?: string | null;
}

/**
 * Tx Templates section in the left sidebar. Lists templates from
 * `project.txTemplates`, grouped by folder (folderId field). Clicking a
 * template opens the Tx Builder workspace preloaded with it.
 *
 * Folder management:
 *   - New folder via section header + button
 *   - Right-click folder → rename / delete (merge children up)
 *   - Right-click template → move to folder / move to root
 */
export function TemplatesSidebarSection({
  project,
  onTemplateOpen,
  onChange,
  onOpenHelp,
  activeId,
}: {
  project: Project;
  /** Open a template in the workspace builder (template id, or null for blank). */
  onTemplateOpen: (templateId: string | null) => void;
  /** Notify parent after folder/template mutations so it can reloadProject. */
  onChange: () => void;
  onOpenHelp?: (skillId: string) => void;
  /** Currently-open template id — highlights matching row. */
  activeId?: string | null;
}): JSX.Element {
  const ctx = useContextMenu();
  const toast = useToast();
  const dialogs = useDialogs();

  const [open, setOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:section-templates') === '1';
  });
  const toggleOpen = (): void => {
    setOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-templates', next ? '1' : '0');
      return next;
    });
  };

  // Expand state per folder.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleFolder = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const folders = useMemo<TreeFolder[]>(
    () => (project.folders ?? []).filter((f) => f.section === 'templates'),
    [project.folders],
  );
  const templates = useMemo<TxTemplate[]>(
    () =>
      ((project.txTemplates ?? []) as TxTemplate[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [project.txTemplates],
  );

  const rootTemplates = templates.filter((t) => !t.folderId);
  const childrenOf = (parentId: string | null): TreeFolder[] =>
    folders.filter((f) => (f.parentId ?? null) === parentId);
  const templatesIn = (folderId: string): TxTemplate[] =>
    templates.filter((t) => t.folderId === folderId);

  // ───── Folder operations ─────
  const createFolder = async (parentId: string | null): Promise<void> => {
    const name = await dialogs.prompt({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'e.g. Swaps',
      confirmText: 'Create',
    });
    if (!name?.trim()) return;
    try {
      await api.call('project.folderCreate', {
        projectId: project.id,
        section: 'templates',
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
          ? 'Folder + nested folders deleted. Their templates are detached to root (templates themselves are NOT deleted).'
          : 'Folder removed. Child templates + sub-folders bubble up to its parent.',
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
  const renameTemplate = async (tpl: TxTemplate, name: string): Promise<void> => {
    try {
      const full = (project.txTemplates ?? []).find(
        (t) => (t as { id: string }).id === tpl.id,
      ) as
        | {
            id: string;
            description: string;
            ixs: unknown[];
            computeUnitLimit: number | null;
            airdropLamports: string | null;
          }
        | undefined;
      if (!full) return;
      await api.call('tx.templateSave', {
        projectId: project.id,
        id: tpl.id,
        name,
        description: full.description,
        ixs: full.ixs,
        computeUnitLimit: full.computeUnitLimit,
        airdropLamports: full.airdropLamports,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const moveTemplate = async (tpl: TxTemplate, folderId: string | null): Promise<void> => {
    try {
      await api.call('project.itemMove', {
        projectId: project.id,
        kind: 'template',
        id: tpl.id,
        folderId,
      });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const deleteTemplate = async (tpl: TxTemplate): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Delete template',
      message: `Permanently remove "${tpl.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.call('tx.templateDelete', { projectId: project.id, id: tpl.id });
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const folderMenu = (f: TreeFolder): MenuItem[] => [
    { label: 'New folder here…', onSelect: () => void createFolder(f.id) },
    { label: 'Rename folder…', onSelect: () => void renameFolder(f) },
    { label: 'Delete (move children up)', onSelect: () => void removeFolder(f, 'merge-up') },
    {
      label: 'Delete + detach all (recursive)',
      danger: true,
      onSelect: () => void removeFolder(f, 'recursive'),
    },
  ];
  /** Batch menu when right-clicking on a multi-selected item. */
  const batchTemplateMenu = (ids: Set<string>): MenuItem[] => {
    const out: MenuItem[] = [
      {
        label: `Move ${ids.size} to root`,
        onSelect: () => {
          for (const id of ids) {
            const tpl = templates.find((t) => t.id === id);
            if (tpl) void moveTemplate(tpl, null);
          }
        },
      },
    ];
    for (const f of folders) {
      out.push({
        label: `Move ${ids.size} → ${f.name}`,
        onSelect: () => {
          for (const id of ids) {
            const tpl = templates.find((t) => t.id === id);
            if (tpl) void moveTemplate(tpl, f.id);
          }
        },
      });
    }
    out.push({
      label: `Delete ${ids.size} templates`,
      danger: true,
      onSelect: async () => {
        const ok = await dialogs.confirm({
          title: `Delete ${ids.size} templates?`,
          message: 'Permanent. Cannot be undone.',
          danger: true,
          confirmText: 'Delete all',
        });
        if (!ok) return;
        for (const id of ids) {
          try {
            await api.call('tx.templateDelete', { projectId: project.id, id });
          } catch (e) {
            toast.error(String(e));
          }
        }
        sel.clear();
        onChange();
      },
    });
    return out;
  };

  const templateMenu = (tpl: TxTemplate): MenuItem[] => {
    const items: MenuItem[] = [
      { label: 'Open in builder', onSelect: () => onTemplateOpen(tpl.id) },
    ];
    if (tpl.folderId) {
      items.push({ label: 'Move to root', onSelect: () => void moveTemplate(tpl, null) });
    }
    // Flat list of "Move → <folder>" entries — context menu has no submenu support.
    for (const f of folders) {
      if (f.id === tpl.folderId) continue;
      items.push({
        label: `Move → ${f.name}`,
        onSelect: () => void moveTemplate(tpl, f.id),
      });
    }
    items.push({
      label: 'Delete template',
      danger: true,
      onSelect: () => void deleteTemplate(tpl),
    });
    return items;
  };

  // Multi-select state. Flat id list (sort order) drives shift-click ranges.
  const flatIds = useMemo(() => templates.map((t) => t.id), [templates]);
  const sel = useTreeSelection(flatIds);

  // Drag-drop wiring: dragged template id (or comma-list when ≥2 selected
  // and the dragged item is part of the selection) lives in dataTransfer
  // with the `application/x-relay-template` MIME.
  const [dragOverFolder, setDragOverFolder] = useState<string | null | 'root'>(null);
  const onDragStartTpl = (e: React.DragEvent, tplId: string): void => {
    const payload =
      sel.selected.has(tplId) && sel.selected.size > 1
        ? Array.from(sel.selected).join(',')
        : tplId;
    // Dual MIME: some Chromium quirks strip custom `application/x-…` types
    // during pre-flight types listing. The shorter `relay/template` survives.
    e.dataTransfer.setData('application/x-relay-template', payload);
    e.dataTransfer.setData('relay/template', payload);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropToFolder = async (
    e: React.DragEvent,
    folderId: string | null,
  ): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const payload =
      e.dataTransfer.getData('application/x-relay-template') ||
      e.dataTransfer.getData('relay/template');
    setDragOverFolder(null);
    if (!payload) return;
    const ids = payload.split(',').filter(Boolean);
    for (const tplId of ids) {
      const tpl = templates.find((t) => t.id === tplId);
      if (!tpl) continue;
      if ((tpl.folderId ?? null) === folderId) continue;
      await moveTemplate(tpl, folderId);
    }
  };
  const onDragOverFolder = (
    e: React.DragEvent,
    folderId: string | null | 'root',
  ): void => {
    // Only swallow internal drags (templates) — leave .so file drag to the
    // shell-level handler. Match either custom MIME (some browsers
    // pre-flight) or the magic fallback type we always set.
    if (
      e.dataTransfer.types.includes('application/x-relay-template') ||
      e.dataTransfer.types.includes('relay/template')
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverFolder(folderId);
    }
  };

  const renderFolder = (f: TreeFolder, depth: number): JSX.Element => {
    const isOpen = expanded.has(f.id);
    const kids = childrenOf(f.id);
    const items = templatesIn(f.id);
    const isDragOver = dragOverFolder === f.id;
    return (
      <div key={f.id} className="tree-folder-wrap">
        <div
          role="button"
          tabIndex={0}
          className={`tree-folder${isDragOver ? ' drag-over' : ''}`}
          style={{ paddingLeft: 20 + depth * 16 }}
          onClick={() => toggleFolder(f.id)}
          onContextMenu={(e) => ctx.open(e, folderMenu(f))}
          onDragOver={(e) => onDragOverFolder(e, f.id)}
          onDragLeave={() => setDragOverFolder((v) => (v === f.id ? null : v))}
          onDrop={(e) => {
            e.stopPropagation();
            void onDropToFolder(e, f.id);
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
            {items.map((t) => renderTemplate(t, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderTemplate = (tpl: TxTemplate, depth: number): JSX.Element => {
    const isSel = sel.selected.has(tpl.id);
    const isActive = activeId === tpl.id;
    return (
      <div
        key={tpl.id}
        className={`tree-template${isActive ? ' active' : ''}${isSel ? ' selected' : ''}`}
        style={{ paddingLeft: 24 + depth * 16 }}
        onClick={(e) => {
          sel.onItemClick(tpl.id, e);
          // Plain click (no modifier) also opens in builder.
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) onTemplateOpen(tpl.id);
        }}
        onContextMenu={(e) => {
          const focus = sel.ensureContains(tpl.id);
          if (focus.size > 1) ctx.open(e, batchTemplateMenu(focus));
          else ctx.open(e, templateMenu(tpl));
        }}
        title={tpl.description || tpl.name}
        draggable
        onDragStart={(e) => onDragStartTpl(e, tpl.id)}
      >
        <Send size={10} className="text-text-subtle" aria-hidden />
        <span className="tree-template-name">
          <InlineRename value={tpl.name} onCommit={(next) => void renameTemplate(tpl, next)} />
        </span>
      </div>
    );
  };

  return (
    <div className="tree-section">
      <button
        type="button"
        className="tree-section-header"
        onClick={toggleOpen}
        aria-expanded={open}
        title="Saved transaction recipes — reuse instructions without retyping"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="inline-flex text-text-subtle">
            {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
          </span>
          Tx Templates
          {onOpenHelp && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHelp('reley-tx-template');
              }}
              title="What is a Tx Template?"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-text-subtle hover:text-accent hover:bg-surface-1"
            >
              <HelpCircle size={11} aria-hidden />
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tree-section-count">{templates.length}</span>
          <span
            className="tree-section-add"
            title="New folder"
            onClick={(e) => {
              e.stopPropagation();
              void createFolder(null);
            }}
          >
            <Folder size={12} aria-hidden />
          </span>
          <span
            className="tree-section-add"
            title="New template (blank)"
            onClick={(e) => {
              e.stopPropagation();
              onTemplateOpen(null);
            }}
          >
            <Plus size={12} aria-hidden />
          </span>
        </span>
      </button>
      {open && (
        <div className="tree-folder-list">
          {childrenOf(null).map((f) => renderFolder(f, 0))}
          {rootTemplates.map((t) => renderTemplate(t, 0))}
          {templates.length === 0 && folders.length === 0 && (
            <div className="tree-empty-cta">
              <div className="tree-empty-title">No templates yet</div>
              <div className="tree-empty-desc">Save reusable tx recipes.</div>
              <button
                type="button"
                className="tree-empty-action"
                onClick={() => onTemplateOpen(null)}
              >
                <Plus size={11} aria-hidden /> Create template
              </button>
            </div>
          )}
        </div>
      )}
      {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
