import { useCallback, useEffect, useState } from 'react';

/**
 * Multi-selection helper for a flat-ordered list of ids. Implements the
 * standard click semantics:
 *
 *   - plain click       → replace selection with [id]
 *   - cmd/ctrl + click  → toggle id in selection (anchor = id)
 *   - shift + click     → range from anchor to id (replaces selection)
 *
 * `items` is the **visible, flat order** of ids — used to resolve shift-click
 * ranges. Re-runs auto-prune dropped ids out of selection.
 */
export function useTreeSelection(items: string[]): {
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  anchor: string | null;
  onItemClick: (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void;
  ensureContains: (id: string) => Set<string>;
  clear: () => void;
} {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  // Prune ids that disappeared from the visible item set (deleted, moved out
  // of view, project switched, etc).
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(items);
      let dirty = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [items]);

  const onItemClick = useCallback(
    (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): void => {
      if (e.shiftKey && anchor) {
        const i = items.indexOf(anchor);
        const j = items.indexOf(id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          setSelected(new Set(items.slice(lo, hi + 1)));
          return;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setAnchor(id);
        return;
      }
      setSelected(new Set([id]));
      setAnchor(id);
    },
    [items, anchor],
  );

  /** Used by context-menu right-click: if id isn't in current selection,
   *  replace selection with just [id]. Returns the resulting set so callers
   *  can branch on size synchronously. */
  const ensureContains = useCallback(
    (id: string): Set<string> => {
      let result: Set<string> = new Set();
      setSelected((prev) => {
        if (prev.has(id)) {
          result = prev;
          return prev;
        }
        const next = new Set([id]);
        result = next;
        return next;
      });
      setAnchor(id);
      return result;
    },
    [],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, setSelected, anchor, onItemClick, ensureContains, clear };
}
