import { Box, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import type { Project } from '../types';

type PatchScope = 'project' | 'sandbox';

interface PatchRow {
  id: string;
  enabled: boolean;
}

/**
 * Patches sidebar — two clickable entries that open the Patches workspace tab
 * focused on the corresponding scope. The actual patch list + actions live in
 * the workspace editor; this is just a router into it.
 */
export function PatchesSidebarSection({
  project,
  activeSandboxId,
  activeFocusScope,
  onOpenPatchesTab,
  onOpenHelp,
}: {
  project: Project;
  /** Currently-open sandbox id, or null if none. */
  activeSandboxId: string | null;
  /** Currently-active focus scope when workspace is on the Patches tab. */
  activeFocusScope: PatchScope | null;
  /** Open the Patches workspace tab focused on the given scope. */
  onOpenPatchesTab: (scope: PatchScope) => void;
  onOpenHelp?: (skillId: string) => void;
}): JSX.Element {
  const toast = useToast();

  const [open, setOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:section-patches') === '1';
  });
  const toggleOpen = (): void => {
    setOpen((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:section-patches', next ? '1' : '0');
      return next;
    });
  };

  // Project patch count — straight from the loaded project.
  const projectCount = (project.patches ?? []).length;

  // Sandbox patch count — fetched on demand to avoid baking session state into
  // every project reload. Refetched when the active sandbox changes.
  const [sandboxCount, setSandboxCount] = useState<number>(0);
  useEffect(() => {
    if (!activeSandboxId) {
      setSandboxCount(0);
      return;
    }
    let cancelled = false;
    void api
      .call<PatchRow[]>('patch.list', { scope: 'session', scopeId: activeSandboxId })
      .then((rows) => {
        if (!cancelled) setSandboxCount((rows ?? []).length);
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      cancelled = true;
    };
  }, [activeSandboxId, project, toast]);

  const totalCount = projectCount + (activeSandboxId ? sandboxCount : 0);

  return (
    <div className="tree-section">
      <button
        type="button"
        className="tree-section-header"
        onClick={toggleOpen}
        aria-expanded={open}
        title="Simulate account state changes without writing transactions"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="inline-flex text-text-subtle">
            {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
          </span>
          Patches
          {onOpenHelp && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHelp('relay-patch');
              }}
              title="What is a patch?"
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
          <PatchesScopeRow
            label="Project"
            count={projectCount}
            active={activeFocusScope === 'project'}
            onClick={() => onOpenPatchesTab('project')}
            title="Patches re-applied on every sandbox open"
          />
          <PatchesScopeRow
            label="Sandbox"
            count={activeSandboxId ? sandboxCount : 0}
            disabled={!activeSandboxId}
            active={activeFocusScope === 'sandbox'}
            onClick={() => onOpenPatchesTab('sandbox')}
            title={
              activeSandboxId
                ? 'Scratch patches scoped to the active sandbox'
                : 'Pick a sandbox first'
            }
          />
        </div>
      )}
    </div>
  );
}

function PatchesScopeRow({
  label,
  count,
  active,
  disabled,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tree-template${active ? ' active' : ''}${disabled ? ' opacity-50' : ''}`}
      style={{ paddingLeft: 24 }}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      title={title}
    >
      <Box size={11} className="text-text-muted" aria-hidden />
      <span className="tree-template-name">{label}</span>
      <span className="text-2xs text-text-subtle font-mono ml-auto pr-1">{count}</span>
    </div>
  );
}
