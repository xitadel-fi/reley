import type { ReactNode } from 'react';
import { cn } from './cn';

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  className,
  children,
}: FieldProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-text-muted flex items-center gap-1"
        >
          {label}
          {required && <span className="text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="text-xs text-danger">{error}</div>
      ) : help ? (
        <div className="text-xs text-text-subtle">{help}</div>
      ) : null}
    </div>
  );
}
