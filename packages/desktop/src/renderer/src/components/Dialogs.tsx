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

interface DialogsApi {
  prompt(opts: PromptOpts): Promise<string | null>;
  confirm(opts: ConfirmOpts): Promise<boolean>;
}

const Ctx = createContext<DialogsApi | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [promptState, setPromptState] = useState<PromptOpts | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null);
  const promptResolve = useRef<((v: string | null) => void) | null>(null);
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);

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

  return (
    <Ctx.Provider value={{ prompt, confirm }}>
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
    };
  }
  return c;
}
