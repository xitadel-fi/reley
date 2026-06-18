import type { KeyboardEvent, MouseEvent } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Inline `?` chip next to a concept label. Click navigates to the Help
 * workspace tab with the given skill preselected. Parent must wire up
 * `onOpenHelp(skillId)` since this component is decoupled from routing.
 *
 * Rendered as a `<span role="button">` rather than a `<button>` because
 * the chip is often placed inside a button-shaped section header — nested
 * buttons trip React's validateDOMNesting warning.
 */
export function HelpChip({
  skillId,
  onOpen,
  label,
}: {
  skillId: string;
  onOpen: (skillId: string) => void;
  label?: string;
}): JSX.Element {
  const activate = (e: MouseEvent | KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(skillId);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      }}
      title={label ? `What is ${label}?` : 'Open docs'}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-text-subtle hover:text-accent hover:bg-surface-1 transition-colors cursor-pointer select-none"
    >
      <HelpCircle size={11} aria-hidden />
    </span>
  );
}
