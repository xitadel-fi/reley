import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  sizeVariant?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-7 pl-2 pr-7 text-xs',
  md: 'h-8 pl-2.5 pr-8 text-sm',
  lg: 'h-9 pl-3 pr-9 text-base',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, sizeVariant = 'md', children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full bg-bg text-text border border-border rounded-md appearance-none',
        'transition-colors duration-fast ease-out',
        'focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-focus/60',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'bg-no-repeat bg-right',
        sizeMap[sizeVariant],
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='none' stroke='%238b919e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M3 4.5l3 3 3-3'/></svg>\")",
        backgroundPosition: 'right 8px center',
      }}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
