// Compatibility shim — legacy `useToast` / `ToastProvider` API forwarded to
// the new Radix-based ToastProvider in `../ui/Toast`. Existing callers stay
// the same; new code should import from `../ui` directly.

import { ToastProvider as NewToastProvider, useToast as useNewToast } from '../ui/Toast';

export const ToastProvider = NewToastProvider;

type ToastKind = 'success' | 'error' | 'info';

interface LegacyToastContextValue {
  push(message: string, kind?: ToastKind): void;
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
}

export function useToast(): LegacyToastContextValue {
  const t = useNewToast();
  return {
    push: (message, kind = 'info') => t.show(message, { variant: kind }),
    success: (message) => t.success(message),
    error: (message) => t.error(message),
    info: (message) => t.info(message),
  };
}
