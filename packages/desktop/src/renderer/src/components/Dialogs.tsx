import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '../ui';

interface PromptOpts {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  danger?: boolean;
}

interface ConfirmOpts {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

interface PickItem {
  id: string;
  label: string;
  hint?: string;
}

interface PickOpts {
  title: string;
  message?: string;
  items: PickItem[];
  confirmText?: string;
  emptyMessage?: string;
}

interface DialogsApi {
  prompt(opts: PromptOpts): Promise<string | null>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
  pickFromList(opts: PickOpts): Promise<string | null>;
}

const Ctx = createContext<DialogsApi | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [promptState, setPromptState] = useState<PromptOpts | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null);
  const [pickState, setPickState] = useState<PickOpts | null>(null);
  const [pickSelected, setPickSelected] = useState<string | null>(null);
  const promptResolve = useRef<((v: string | null) => void) | null>(null);
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);
  const pickResolve = useRef<((v: string | null) => void) | null>(null);

  const prompt = useCallback((opts: PromptOpts): Promise<string | null> => {
    setPromptValue(opts.initial ?? '');
    setPromptState(opts);
    return new Promise<string | null>((resolve) => {
      promptResolve.current = resolve;
    });
  }, []);

  const confirm = useCallback((opts: ConfirmOpts): Promise<boolean> => {
    setConfirmState(opts);
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
    });
  }, []);

  const pickFromList = useCallback((opts: PickOpts): Promise<string | null> => {
    setPickSelected(opts.items[0]?.id ?? null);
    setPickState(opts);
    return new Promise<string | null>((resolve) => {
      pickResolve.current = resolve;
    });
  }, []);

  const closePrompt = (value: string | null): void => {
    promptResolve.current?.(value);
    promptResolve.current = null;
    setPromptState(null);
  };

  const closeConfirm = (value: boolean): void => {
    confirmResolve.current?.(value);
    confirmResolve.current = null;
    setConfirmState(null);
  };

  const closePick = (value: string | null): void => {
    pickResolve.current?.(value);
    pickResolve.current = null;
    setPickState(null);
    setPickSelected(null);
  };

  return (
    <Ctx.Provider value={{ prompt, confirm, pickFromList }}>
      {children}

      <Dialog open={!!promptState} onOpenChange={(o) => !o && closePrompt(null)}>
        <DialogContent size="md">
          {promptState && (
            <>
              <DialogHeader>
                <DialogTitle>{promptState.title}</DialogTitle>
              </DialogHeader>
              <Field label={promptState.label}>
                <Input
                  autoFocus
                  value={promptValue}
                  placeholder={promptState.placeholder}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') closePrompt(promptValue);
                    if (e.key === 'Escape') closePrompt(null);
                  }}
                />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => closePrompt(null)}>
                  <X size={12} aria-hidden /> Cancel
                </Button>
                <Button
                  variant={promptState.danger ? 'danger' : 'primary'}
                  onClick={() => closePrompt(promptValue)}
                >
                  {promptState.confirmText ?? 'OK'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pickState} onOpenChange={(o) => !o && closePick(null)}>
        <DialogContent size="md">
          {pickState && (
            <>
              <DialogHeader>
                <DialogTitle>{pickState.title}</DialogTitle>
                {pickState.message && (
                  <DialogDescription>{pickState.message}</DialogDescription>
                )}
              </DialogHeader>
              {pickState.items.length === 0 ? (
                <div className="text-xs text-text-muted py-2">
                  {pickState.emptyMessage ?? 'Nothing to pick.'}
                </div>
              ) : (
                <ul className="flex flex-col gap-1 max-h-[360px] overflow-auto -mx-1 px-1">
                  {pickState.items.map((it) => {
                    const selected = pickSelected === it.id;
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => setPickSelected(it.id)}
                          onDoubleClick={() => closePick(it.id)}
                          className={[
                            'w-full text-left rounded-md border px-3 py-2 text-xs transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
                            selected
                              ? 'border-accent bg-accent/15 text-text'
                              : 'border-border bg-surface-0 hover:bg-surface-1 text-text-muted hover:text-text',
                          ].join(' ')}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={[
                                'inline-block w-2 h-2 rounded-full shrink-0',
                                selected ? 'bg-accent' : 'bg-text-subtle',
                              ].join(' ')}
                              aria-hidden
                            />
                            <span className="flex-1 min-w-0 truncate font-medium">{it.label}</span>
                          </div>
                          {it.hint && (
                            <div className="text-2xs text-text-subtle font-mono mt-0.5 truncate pl-4">
                              {it.hint}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => closePick(null)}>
                  <X size={12} aria-hidden /> Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!pickSelected || pickState.items.length === 0}
                  onClick={() => closePick(pickSelected)}
                >
                  {pickState.confirmText ?? 'Select'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmState} onOpenChange={(o) => !o && closeConfirm(false)}>
        <DialogContent size="md">
          {confirmState && (
            <>
              <DialogHeader>
                <DialogTitle>{confirmState.title}</DialogTitle>
                <DialogDescription>{confirmState.message}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => closeConfirm(false)}>
                  <X size={12} aria-hidden /> Cancel
                </Button>
                <Button
                  variant={confirmState.danger ? 'danger' : 'primary'}
                  onClick={() => closeConfirm(true)}
                >
                  {confirmState.confirmText ?? 'Confirm'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useDialogs(): DialogsApi {
  const c = useContext(Ctx);
  if (!c) {
    return {
      prompt: async () => null,
      confirm: async () => false,
      pickFromList: async () => null,
    };
  }
  return c;
}
