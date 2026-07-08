import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

const DialogPortal = RadixDialog.Portal;

export const DialogOverlay = forwardRef<
  ElementRef<typeof RadixDialog.Overlay>,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(({ className, ...props }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]',
      'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideClose?: boolean;
  children?: ReactNode;
}

const sizeMap: Record<NonNullable<DialogContentProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  DialogContentProps
>(({ className, children, size = 'md', hideClose, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full',
        'bg-surface-0 border border-border rounded-lg shadow-elev-3',
        'p-5 grid gap-4',
        // Tall forms (AddProgramVersion, AttachIdl file pickers) must scroll
        // their own body instead of pushing the footer off-screen. Cap at
        // 92vh + own scrollbar.
        'max-h-[92vh] overflow-y-auto',
        'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        'focus:outline-none',
        sizeMap[size],
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <RadixDialog.Close
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-text hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 transition-colors"
        >
          <X size={14} />
        </RadixDialog.Close>
      )}
    </RadixDialog.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return <div className={cn('flex flex-col gap-1', className)}>{children}</div>;
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <RadixDialog.Title className={cn('text-md font-semibold text-text leading-tight', className)}>
      {children}
    </RadixDialog.Title>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <RadixDialog.Description className={cn('text-xs text-text-muted', className)}>
      {children}
    </RadixDialog.Description>
  );
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex items-center justify-end gap-2 pt-1', className)}>{children}</div>
  );
}
