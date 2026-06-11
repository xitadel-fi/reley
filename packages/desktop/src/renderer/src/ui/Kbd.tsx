import type { ReactNode } from 'react';
import { cn } from './cn';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps): JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded',
        'border border-border bg-surface-0 text-text-muted font-mono text-2xs leading-none',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
