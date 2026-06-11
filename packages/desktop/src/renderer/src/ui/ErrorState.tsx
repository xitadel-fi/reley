import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ErrorStateProps {
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  action,
  className,
}: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md border border-danger/40 bg-danger/5 p-3',
        className,
      )}
    >
      <AlertTriangle className="text-danger mt-0.5 shrink-0" size={16} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text">{title}</div>
        {message && (
          <div className="text-xs text-text-muted mt-0.5 break-words leading-relaxed">{message}</div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
