import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Kbd,
} from '../ui';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  shortcut?: string;
  onSelect: () => void;
}

interface Section {
  group: string;
  items: Array<{ item: PaletteItem; originalIndex: number }>;
}

export function CommandPalette({
  items,
  open,
  onClose,
}: {
  items: PaletteItem[];
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.hint ?? '').toLowerCase().includes(q) ||
        (it.group ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  const sections = useMemo<Section[]>(() => {
    const map = new Map<string, Section>();
    filtered.forEach((item, originalIndex) => {
      const group = item.group ?? 'Other';
      let s = map.get(group);
      if (!s) {
        s = { group, items: [] };
        map.set(group, s);
      }
      s.items.push({ item, originalIndex });
    });
    return Array.from(map.values());
  }, [filtered]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const select = (idx: number): void => {
    const it = filtered[idx];
    if (!it) return;
    it.onSelect();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="xl"
        hideClose
        className="p-0 max-w-[640px] gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search projects, programs, sessions, and commands.
        </DialogDescription>

        <div className="flex items-center gap-2 px-4 h-12 border-b border-border">
          <Search size={14} className="text-text-muted shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, project, program, or sandbox…"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-text placeholder:text-text-subtle"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                select(activeIdx);
              }
            }}
          />
        </div>

        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Command results"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-muted">
              No matches for <span className="text-text">"{query}"</span>
            </div>
          ) : (
            sections.map((sec) => (
              <div key={sec.group} className="py-1">
                <div className="px-2 py-1 text-2xs uppercase tracking-wider text-text-subtle font-medium">
                  {sec.group}
                </div>
                {sec.items.map(({ item, originalIndex }) => {
                  const isActive = originalIndex === activeIdx;
                  return (
                    <div
                      key={item.id}
                      data-idx={originalIndex}
                      role="option"
                      aria-selected={isActive}
                      className={[
                        'flex items-center gap-2 px-2 py-1.5 rounded cursor-default',
                        'transition-colors duration-fast ease-out',
                        isActive
                          ? 'bg-surface-2 text-text'
                          : 'text-text-muted hover:bg-surface-1 hover:text-text',
                      ].join(' ')}
                      onMouseEnter={() => setActiveIdx(originalIndex)}
                      onClick={() => select(originalIndex)}
                    >
                      <span className="text-sm flex-1 min-w-0 truncate">{item.label}</span>
                      {item.hint && (
                        <span className="text-2xs text-text-subtle font-mono truncate max-w-[200px]">
                          {item.hint}
                        </span>
                      )}
                      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-surface-0/70 text-2xs text-text-subtle">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> select
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
          </span>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
