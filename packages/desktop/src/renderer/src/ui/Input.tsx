import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const baseField =
  'w-full bg-bg text-text placeholder:text-text-subtle border border-border rounded-md ' +
  'transition-colors duration-fast ease-out ' +
  'focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-focus/60 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  sizeVariant?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-sm',
  lg: 'h-9 px-3 text-base',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, sizeVariant = 'md', ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        baseField,
        sizeMap[sizeVariant],
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        baseField,
        'px-2.5 py-1.5 text-sm font-mono leading-snug min-h-[64px] resize-y',
        invalid && 'border-danger focus:border-danger',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
