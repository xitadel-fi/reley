import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export function Spinner({ size = 14, className, label }: SpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn('inline-flex items-center gap-1.5 text-text-muted', className)}
    >
      <Loader2 className="animate-spin" size={size} aria-hidden />
      {label && <span className="text-xs">{label}</span>}
    </span>
  );
}
