import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Inline `?` hint with a hover/focus popover. Distinct from HelpChip:
 * HelpChip jumps straight to the Help workspace on click — useful for major
 * concepts; HelpHint shows a 1-sentence definition in-place and offers an
 * optional "Learn more" link to a Help skill — useful for confusing form
 * fields where the user doesn't want to lose their place.
 *
 * Rendered as `<span role="button">` (not `<button>`) so it can nest inside
 * button-shaped containers without tripping validateDOMNesting.
 */
export function HelpHint({
  hint,
  skillId,
  onOpen,
  label,
}: {
  /** 1-sentence in-place definition shown on hover/focus. */
  hint: string;
  /** Optional skill id — when present, "Learn more" link is shown. */
  skillId?: string;
  /** Required when skillId set. Opens the Help workspace at that skill. */
  onOpen?: (skillId: string) => void;
  /** Accessible label used in tooltip + popover title. */
  label?: string;
}): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const reveal = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  // Brief grace period so the user can move the mouse from icon → popover
  // without it disappearing mid-traversal.
  const hide = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 100);
  };

  const onClickIcon = (e: MouseEvent | KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  };

  return (
    <span
      className="help-hint-wrap"
      onMouseEnter={reveal}
      onMouseLeave={hide}
      onFocus={reveal}
      onBlur={hide}
    >
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={onClickIcon}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClickIcon(e);
          if (e.key === 'Escape') setOpen(false);
        }}
        title={label ?? 'Show hint'}
        className="help-hint-icon"
      >
        <HelpCircle size={11} aria-hidden />
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="help-hint-pop"
          onMouseEnter={reveal}
          onMouseLeave={hide}
        >
          {label && <span className="help-hint-pop-title">{label}</span>}
          <span className="help-hint-pop-body">{hint}</span>
          {skillId && onOpen && (
            <button
              type="button"
              className="help-hint-pop-link"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onOpen(skillId);
              }}
            >
              Learn more →
            </button>
          )}
        </span>
      )}
    </span>
  );
}
