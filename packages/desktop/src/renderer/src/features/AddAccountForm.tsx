import { useState } from 'react';
import { api } from '../api';
import { Button, ErrorState, Field, Input, Pubkey, Spinner } from '../ui';

export function AddAccountForm({
  projectId,
  programId,
  onDone,
}: {
  projectId: string;
  programId: string;
  onDone: () => void;
}): JSX.Element {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const params: Record<string, unknown> = { projectId, programId, address };
      if (label) params.label = label;
      if (slot) params.slot = slot;
      await api.call('account.add', params);
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[420px]">
      <div>
        <h3 className="m-0 text-md font-semibold">Add account</h3>
        <div className="mt-1 text-xs text-text-muted inline-flex items-center gap-1">
          under <Pubkey value={programId} noCopy className="text-text" />
        </div>
      </div>

      {err && <ErrorState title="Failed to add account" message={err} />}

      <Field label="Address" required>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="base58 PDA address"
          className="font-mono"
          autoFocus
        />
      </Field>
      <Field label="Label" help="Optional friendly name shown in sidebar.">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="DLMM pool A" />
      </Field>
      <Field label="Slot" help="Optional — pin clone to a specific slot.">
        <Input value={slot} onChange={(e) => setSlot(e.target.value)} className="font-mono" />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!address || busy} onClick={submit}>
          {busy ? (
            <>
              <Spinner size={12} /> Cloning…
            </>
          ) : (
            'Add account'
          )}
        </Button>
      </div>
    </div>
  );
}
