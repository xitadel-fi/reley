import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded font-medium border whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-surface-1 text-text-muted border-border',
        accent: 'bg-accent/10 text-accent border-accent/30',
        success: 'bg-success/10 text-success border-success/30',
        warning: 'bg-warning/10 text-warning border-warning/30',
        danger: 'bg-danger/10 text-danger border-danger/40',
        outline: 'bg-transparent text-text-muted border-border',
      },
      size: {
        sm: 'h-4 px-1.5 text-2xs',
        md: 'h-5 px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size, className }))} {...props} />
  ),
);
Badge.displayName = 'Badge';
