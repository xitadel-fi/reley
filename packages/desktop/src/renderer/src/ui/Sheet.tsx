import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from './cn';

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

const SheetPortal = RadixDialog.Portal;

const SheetOverlay = forwardRef<
  ElementRef<typeof RadixDialog.Overlay>,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(({ className, ...props }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]',
      'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

type Side = 'right' | 'left' | 'top' | 'bottom';

const sideMap: Record<Side, string> = {
  right:
    'inset-y-0 right-0 h-full w-[420px] border-l data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
  left: 'inset-y-0 left-0 h-full w-[420px] border-r',
  top: 'inset-x-0 top-0 w-full h-1/3 border-b',
  bottom: 'inset-x-0 bottom-0 w-full h-1/3 border-t',
};

export interface SheetContentProps extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  side?: Side;
  hideClose?: boolean;
  children?: ReactNode;
}

export const SheetContent = forwardRef<ElementRef<typeof RadixDialog.Content>, SheetContentProps>(
  ({ className, children, side = 'right', hideClose, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          'fixed z-50 bg-surface-0 border-border shadow-elev-3 p-5 flex flex-col gap-4 outline-none',
          sideMap[side],
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
    </SheetPortal>
  ),
);
SheetContent.displayName = 'SheetContent';

export function SheetHeader({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  return <div className={cn('flex flex-col gap-1', className)}>{children}</div>;
}

export function SheetTitle({
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

export function SheetDescription({
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
