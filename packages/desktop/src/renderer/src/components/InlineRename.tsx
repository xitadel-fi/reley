import { useEffect, useState } from 'react';

/**
 * Inline-editable label. Double-click swaps to an input; Enter commits,
 * Esc cancels, blur commits. Used by every sidebar item that supports
 * inline renaming.
 */
export function InlineRename({
  value,
  onCommit,
  className,
  startEditing,
  onEditingChange,
}: {
  value: string;
  onCommit: (next: string) => void | Promise<void>;
  className?: string;
  /** External trigger to enter edit mode (e.g. F2, context-menu Rename). */
  startEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  // Sync external request to enter edit mode.
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);
  // Bubble editing state up so parents can pause click handlers.
  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  if (!editing) {
    return (
      <span
        className={className}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        title="Double-click to rename"
      >
        {value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const next = draft.trim();
          setEditing(false);
          if (next && next !== value) void onCommit(next);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setDraft(value);
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        setEditing(false);
        if (next && next !== value) void onCommit(next);
      }}
      style={{
        font: 'inherit',
        color: 'inherit',
        background: 'rgb(var(--color-bg))',
        border: '1px solid rgb(var(--color-border-strong))',
        borderRadius: 3,
        padding: '0 4px',
        minWidth: 80,
      }}
    />
  );
}
