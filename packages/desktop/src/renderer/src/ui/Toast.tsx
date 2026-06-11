import * as RadixToast from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';

type Variant = 'info' | 'success' | 'warning' | 'error';

interface ToastItem {
  id: string;
  title?: string;
  message: string;
  variant: Variant;
  durationMs: number;
}

interface ToastCtx {
  show: (msg: string, opts?: { title?: string; variant?: Variant; durationMs?: number }) => void;
  info: (msg: string, opts?: { title?: string; durationMs?: number }) => void;
  success: (msg: string, opts?: { title?: string; durationMs?: number }) => void;
  warning: (msg: string, opts?: { title?: string; durationMs?: number }) => void;
  error: (msg: string, opts?: { title?: string; durationMs?: number }) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastCtx>(() => {
    const show: ToastCtx['show'] = (message, opts) => {
      const id = String(nextId++);
      const variant = opts?.variant ?? 'info';
      const durationMs = opts?.durationMs ?? (variant === 'error' ? 6000 : 3500);
      setItems((arr) => [...arr, { id, message, title: opts?.title, variant, durationMs }]);
    };
    return {
      show,
      info: (m, o) => show(m, { ...o, variant: 'info' }),
      success: (m, o) => show(m, { ...o, variant: 'success' }),
      warning: (m, o) => show(m, { ...o, variant: 'warning' }),
      error: (m, o) => show(m, { ...o, variant: 'error' }),
    };
  }, []);

  return (
    <Ctx.Provider value={api}>
      <RadixToast.Provider swipeDirection="right" duration={3500}>
        {children}
        {items.map((t) => (
          <RadixToast.Root
            key={t.id}
            duration={t.durationMs}
            onOpenChange={(open) => {
              if (!open) remove(t.id);
            }}
            className={cn(
              'pointer-events-auto grid grid-cols-[auto_1fr_auto] gap-2 items-start',
              'rounded-md border bg-surface-0 px-3 py-2 shadow-elev-2',
              'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-fade-out',
              t.variant === 'info' && 'border-border',
              t.variant === 'success' && 'border-success/40',
              t.variant === 'warning' && 'border-warning/40',
              t.variant === 'error' && 'border-danger/50',
            )}
          >
            <span
              className={cn(
                'mt-0.5',
                t.variant === 'info' && 'text-text-muted',
                t.variant === 'success' && 'text-success',
                t.variant === 'warning' && 'text-warning',
                t.variant === 'error' && 'text-danger',
              )}
            >
              {t.variant === 'success' ? (
                <CheckCircle size={14} />
              ) : t.variant === 'warning' ? (
                <AlertTriangle size={14} />
              ) : t.variant === 'error' ? (
                <XCircle size={14} />
              ) : (
                <Info size={14} />
              )}
            </span>
            <div className="min-w-0">
              {t.title && (
                <RadixToast.Title className="text-xs font-semibold text-text leading-tight">
                  {t.title}
                </RadixToast.Title>
              )}
              <RadixToast.Description className="text-xs text-text-muted break-words">
                {t.message}
              </RadixToast.Description>
            </div>
            <RadixToast.Close
              aria-label="Dismiss"
              className="text-text-subtle hover:text-text rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70"
            >
              <X size={12} />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-6 right-6 z-[100] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
