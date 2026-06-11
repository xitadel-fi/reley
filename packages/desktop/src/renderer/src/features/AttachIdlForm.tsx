import { Upload } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { Button, ErrorState, Field, Pubkey, Spinner, Textarea } from '../ui';

export function AttachIdlForm({
  programId,
  onDone,
}: {
  programId: string;
  onDone: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const idl = JSON.parse(text);
      await api.call('idl.attach', { programId, idl });
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
  };

  return (
    <div className="flex flex-col gap-4 min-w-[480px]">
      <div>
        <h3 className="m-0 text-md font-semibold">Attach IDL</h3>
        <div className="mt-1 text-xs text-text-muted inline-flex items-center gap-1">
          to <Pubkey value={programId} noCopy className="text-text" />
        </div>
      </div>

      {err && <ErrorState title="Failed to attach IDL" message={err} />}

      <Field label="Load from file">
        <label className="inline-flex items-center gap-2 text-xs text-text-muted cursor-pointer hover:text-text">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-0 px-2.5 h-8 hover:bg-surface-1 transition-colors">
            <Upload size={12} aria-hidden /> Choose file…
          </span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={onFile}
            className="sr-only"
          />
        </label>
      </Field>

      <Field label="Or paste IDL JSON">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anchor IDL JSON"
          rows={14}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!text.trim() || busy} onClick={submit}>
          {busy ? (
            <>
              <Spinner size={12} /> Attaching…
            </>
          ) : (
            'Attach'
          )}
        </Button>
      </div>
    </div>
  );
}
