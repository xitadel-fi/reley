import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Empty, ErrorState, IconButton, Spinner } from '../ui';

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime?: number;
  children?: FileNode[];
}

interface TreeResult {
  root: string;
  nodes: FileNode[];
}

function formatBytes(b?: number): string {
  if (b == null) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FilesTreeProps {
  selected: string | null;
  onSelect: (path: string) => void;
  /** Bump to force a refresh (e.g. after a write). */
  refreshKey?: number;
}

export function FilesTree({ selected, onSelect, refreshKey }: FilesTreeProps): JSX.Element {
  const [tree, setTree] = useState<TreeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.relay']));

  const reload = async (): Promise<void> => {
    setErr(null);
    try {
      setTree(await api.call<TreeResult>('app.files.tree'));
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, [refreshKey]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 text-2xs uppercase tracking-widest text-text-subtle font-semibold">
        <span>Files</span>
        <IconButton
          icon={<RefreshCw size={11} />}
          label="Reload"
          size="sm"
          variant="ghost"
          onClick={() => void reload()}
        />
      </div>

      {err && (
        <div className="px-3 py-2">
          <ErrorState title="Failed to list files" message={err} />
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        {!tree ? (
          <div className="p-3">
            <Spinner label="Loading…" />
          </div>
        ) : tree.nodes.length === 0 ? (
          <Empty size="sm" title="No files" />
        ) : (
          tree.nodes.map((n) => (
            <TreeRow
              key={n.path}
              node={n}
              depth={0}
              selected={selected}
              expanded={expanded}
              onToggle={(p) =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(p)) next.delete(p);
                  else next.add(p);
                  return next;
                })
              }
              onOpen={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}): JSX.Element {
  const isDir = node.kind === 'dir';
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const pad = 8 + depth * 12;
  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
        className={[
          'flex items-center gap-1.5 w-full text-left bg-transparent border-0 py-1 pr-2',
          'text-xs transition-colors duration-fast',
          isSelected
            ? 'bg-surface-2 text-text'
            : 'text-text-muted hover:bg-surface-1 hover:text-text',
        ].join(' ')}
        style={{ paddingLeft: pad }}
      >
        {isDir ? (
          <>
            <span className="inline-flex w-3 text-text-subtle shrink-0">
              {isExpanded ? (
                <ChevronDown size={11} aria-hidden />
              ) : (
                <ChevronRight size={11} aria-hidden />
              )}
            </span>
            {isExpanded ? (
              <FolderOpen size={12} className="text-accent shrink-0" aria-hidden />
            ) : (
              <Folder size={12} className="text-accent shrink-0" aria-hidden />
            )}
          </>
        ) : (
          <>
            <span className="inline-flex w-3 shrink-0" />
            <FileIcon size={12} className="text-text-subtle shrink-0" aria-hidden />
          </>
        )}
        <span className="font-mono truncate flex-1 min-w-0">{node.name}</span>
        {!isDir && (
          <span className="text-2xs text-text-subtle font-mono shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </button>
      {isDir && isExpanded && node.children && (
        <>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
    </>
  );
}
