import { Check, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Pubkey,
  Select,
  Spinner,
} from '../ui';

interface BuiltinDescriptor {
  programId: string;
  label: string;
  inSvm: boolean;
  hasIdl: boolean;
  description: string;
}

const OTHER = '__other__';

function looksLikeBase58Pubkey(s: string): boolean {
  // Solana pubkeys are 32-44 chars base58 (no 0/O/I/l). Loose check — server
  // does strict validation.
  if (s.length < 32 || s.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export function AddProgramForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}): JSX.Element {
  const [builtins, setBuiltins] = useState<BuiltinDescriptor[]>([]);
  const [selection, setSelection] = useState<string>(OTHER);
  const [programId, setProgramId] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<BuiltinDescriptor[]>('program.listBuiltins')
      .then(setBuiltins)
      .catch(() => setBuiltins([]));
  }, []);

  // Clipboard-aware: if user copied a base58 pubkey before opening this
  // form, prefill it. Cuts the "paste" step out for the common flow of
  // grabbing a program id from Solana Explorer.
  useEffect(() => {
    if (programId) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;
    void navigator.clipboard
      .readText()
      .then((text) => {
        const t = text.trim();
        if (looksLikeBase58Pubkey(t)) setProgramId(t);
      })
      .catch(() => {
        /* user denied clipboard perm — ignore */
      });
  }, [programId]);

  const chosenBuiltin = builtins.find((b) => b.programId === selection);
  const isOther = selection === OTHER;
  const effectiveProgramId = isOther ? programId : chosenBuiltin?.programId ?? '';

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const params: Record<string, unknown> = {
        projectId,
        programId: effectiveProgramId,
      };
      if (isOther) {
        if (rpcUrl) params.rpcUrl = rpcUrl;
        if (slot) params.slot = slot;
      }
      await api.call('program.add', params);
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[440px]">
      <h3 className="m-0 text-md font-semibold">Add program</h3>
      {err && <ErrorState title="Failed to add program" message={err} />}

      <Field label="Source">
        <Select value={selection} onChange={(e) => setSelection(e.target.value)}>
          <option value={OTHER}>Other (paste program ID, clone from RPC)</option>
          {builtins.length > 0 && <option disabled>──── Built-in ────</option>}
          {builtins.map((b) => (
            <option key={b.programId} value={b.programId}>
              {b.label}
              {b.inSvm ? ' · LiteSVM' : ' · RPC clone (auto)'}
            </option>
          ))}
        </Select>
      </Field>

      {chosenBuiltin && (
        <div className="rounded-md border border-border bg-surface-0 p-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="text-sm font-medium text-text">{chosenBuiltin.label}</div>
            {chosenBuiltin.inSvm ? (
              <Badge size="sm" variant="success">
                <Check size={10} aria-hidden /> in LiteSVM
              </Badge>
            ) : (
              <Badge size="sm" variant="accent">
                <RefreshCw size={10} aria-hidden /> RPC clone
              </Badge>
            )}
          </div>
          <div className="mt-1.5">
            <Pubkey value={chosenBuiltin.programId} className="text-text-muted" />
          </div>
          <div className="mt-2 text-xs text-text-muted leading-relaxed">
            {chosenBuiltin.description}
          </div>
          <div className="mt-2 text-2xs text-text-subtle">
            {chosenBuiltin.inSvm
              ? 'Bundled into LiteSVM — instant attach, no RPC roundtrip.'
              : 'Will auto-clone from RPC on first use.'}
          </div>
        </div>
      )}

      {isOther && (
        <>
          <Field label="Program ID" required>
            <Input
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              placeholder="base58 program ID"
              className="font-mono"
              autoFocus
            />
          </Field>
          <Field label="RPC URL override" help="Leave blank to use project RPC.">
            <Input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </Field>
          <Field label="Slot" help="Optional — pin clone to a specific slot.">
            <Input value={slot} onChange={(e) => setSlot(e.target.value)} className="font-mono" />
          </Field>
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!effectiveProgramId || busy} onClick={submit}>
          {busy ? (
            <>
              <Spinner size={12} />{' '}
              {isOther && chosenBuiltin === undefined ? 'Cloning…' : 'Adding…'}
            </>
          ) : (
            'Add program'
          )}
        </Button>
      </div>
    </div>
  );
}
