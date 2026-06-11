import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from './cn';

export const Dropdown = RadixMenu.Root;
export const DropdownTrigger = RadixMenu.Trigger;
export const DropdownGroup = RadixMenu.Group;
export const DropdownPortal = RadixMenu.Portal;
export const DropdownSub = RadixMenu.Sub;
export const DropdownRadioGroup = RadixMenu.RadioGroup;

export const DropdownContent = forwardRef<
  ElementRef<typeof RadixMenu.Content>,
  ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RadixMenu.Portal>
    <RadixMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface-0 p-1 shadow-elev-2 outline-none',
        'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
        className,
      )}
      {...props}
    />
  </RadixMenu.Portal>
));
DropdownContent.displayName = 'DropdownContent';

const itemClasses =
  'relative flex select-none items-center gap-2 rounded px-2 py-1.5 text-xs text-text outline-none ' +
  'transition-colors duration-fast ease-out cursor-default ' +
  'focus:bg-surface-2 focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export const DropdownItem = forwardRef<
  ElementRef<typeof RadixMenu.Item>,
  ComponentPropsWithoutRef<typeof RadixMenu.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixMenu.Item
    ref={ref}
    className={cn(itemClasses, inset && 'pl-7', className)}
    {...props}
  />
));
DropdownItem.displayName = 'DropdownItem';

export const DropdownCheckboxItem = forwardRef<
  ElementRef<typeof RadixMenu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof RadixMenu.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <RadixMenu.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(itemClasses, 'pl-7', className)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixMenu.ItemIndicator>
        <Check size={12} />
      </RadixMenu.ItemIndicator>
    </span>
    {children}
  </RadixMenu.CheckboxItem>
));
DropdownCheckboxItem.displayName = 'DropdownCheckboxItem';

export const DropdownRadioItem = forwardRef<
  ElementRef<typeof RadixMenu.RadioItem>,
  ComponentPropsWithoutRef<typeof RadixMenu.RadioItem>
>(({ className, children, ...props }, ref) => (
  <RadixMenu.RadioItem ref={ref} className={cn(itemClasses, 'pl-7', className)} {...props}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixMenu.ItemIndicator>
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </RadixMenu.ItemIndicator>
    </span>
    {children}
  </RadixMenu.RadioItem>
));
DropdownRadioItem.displayName = 'DropdownRadioItem';

export const DropdownLabel = forwardRef<
  ElementRef<typeof RadixMenu.Label>,
  ComponentPropsWithoutRef<typeof RadixMenu.Label>
>(({ className, ...props }, ref) => (
  <RadixMenu.Label
    ref={ref}
    className={cn('px-2 py-1 text-2xs uppercase tracking-wide text-text-subtle', className)}
    {...props}
  />
));
DropdownLabel.displayName = 'DropdownLabel';

export const DropdownSeparator = forwardRef<
  ElementRef<typeof RadixMenu.Separator>,
  ComponentPropsWithoutRef<typeof RadixMenu.Separator>
>(({ className, ...props }, ref) => (
  <RadixMenu.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...props} />
));
DropdownSeparator.displayName = 'DropdownSeparator';

export const DropdownSubTrigger = forwardRef<
  ElementRef<typeof RadixMenu.SubTrigger>,
  ComponentPropsWithoutRef<typeof RadixMenu.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <RadixMenu.SubTrigger
    ref={ref}
    className={cn(itemClasses, 'data-[state=open]:bg-surface-2', inset && 'pl-7', className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" size={12} />
  </RadixMenu.SubTrigger>
));
DropdownSubTrigger.displayName = 'DropdownSubTrigger';

export const DropdownSubContent = forwardRef<
  ElementRef<typeof RadixMenu.SubContent>,
  ComponentPropsWithoutRef<typeof RadixMenu.SubContent>
>(({ className, ...props }, ref) => (
  <RadixMenu.SubContent
    ref={ref}
    className={cn(
      'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface-0 p-1 shadow-elev-2',
      'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
      className,
    )}
    {...props}
  />
));
DropdownSubContent.displayName = 'DropdownSubContent';

export const DropdownShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): JSX.Element => (
  <span
    className={cn(
      'ml-auto text-2xs tracking-widest text-text-subtle font-mono',
      className,
    )}
    {...props}
  />
);
