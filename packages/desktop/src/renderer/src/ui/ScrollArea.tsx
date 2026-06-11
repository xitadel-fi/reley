import * as RadixScrollArea from '@radix-ui/react-scroll-area';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from './cn';

export const ScrollArea = forwardRef<
  ElementRef<typeof RadixScrollArea.Root>,
  ComponentPropsWithoutRef<typeof RadixScrollArea.Root>
>(({ className, children, ...props }, ref) => (
  <RadixScrollArea.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    <RadixScrollArea.Viewport className="h-full w-full">{children}</RadixScrollArea.Viewport>
    <RadixScrollArea.Scrollbar
      orientation="vertical"
      className="flex select-none touch-none p-0.5 bg-transparent w-2 hover:bg-surface-1/40 transition-colors"
    >
      <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-surface-3 hover:bg-border-strong" />
    </RadixScrollArea.Scrollbar>
    <RadixScrollArea.Scrollbar
      orientation="horizontal"
      className="flex select-none touch-none p-0.5 bg-transparent h-2 flex-col hover:bg-surface-1/40 transition-colors"
    >
      <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-surface-3 hover:bg-border-strong" />
    </RadixScrollArea.Scrollbar>
    <RadixScrollArea.Corner />
  </RadixScrollArea.Root>
));
ScrollArea.displayName = 'ScrollArea';
