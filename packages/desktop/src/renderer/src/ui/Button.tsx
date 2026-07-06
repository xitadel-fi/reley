import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors duration-fast ease-out ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70',
  {
    variants: {
      variant: {
        default:
          'bg-surface-1 text-text border border-border hover:bg-surface-2 hover:border-border-strong',
        primary:
          'grad-cta cta-shadow text-[#031018] border border-accent hover:-translate-y-[1px] active:translate-y-[1px] transition-transform',
        ghost: 'bg-transparent text-text hover:bg-surface-1',
        subtle: 'bg-surface-0 text-text hover:bg-surface-1 border border-transparent',
        danger:
          'bg-transparent text-danger border border-danger/60 hover:bg-danger/10 hover:border-danger',
        link: 'bg-transparent text-accent hover:underline underline-offset-2 px-0 py-0 h-auto',
        outline:
          'bg-transparent text-text border border-border hover:bg-surface-1 hover:border-border-strong',
      },
      size: {
        xs: 'h-6 px-2 text-xs',
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-9 px-4 text-base',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: any = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
