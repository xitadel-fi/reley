import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

export function Empty({
  icon,
  title,
  description,
  action,
  className,
  size = 'md',
}: EmptyProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-2',
        size === 'sm' ? 'py-6 px-4' : 'py-10 px-6',
        className,
      )}
    >
      {icon && <div className="text-text-subtle">{icon}</div>}
      {title && <div className="text-sm font-medium text-text">{title}</div>}
      {description && (
        <div className="text-xs text-text-muted max-w-sm leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
