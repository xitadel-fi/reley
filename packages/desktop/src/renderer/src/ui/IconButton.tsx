import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'ghost' | 'primary' | 'danger';
}

const sizeMap = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
} as const;

const variantMap = {
  default: 'text-text-muted hover:text-text hover:bg-surface-1',
  ghost: 'text-text-muted hover:text-text',
  primary: 'text-accent hover:bg-accent/10',
  danger: 'text-danger hover:bg-danger/10',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, size = 'md', variant = 'default', className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70',
        'disabled:pointer-events-none disabled:opacity-50',
        sizeMap[size],
        variantMap[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
