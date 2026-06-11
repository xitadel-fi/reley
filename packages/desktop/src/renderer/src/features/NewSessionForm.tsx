import { useState } from 'react';
import { api } from '../api';
import { Button, ErrorState, Field, Input, Spinner } from '../ui';

export function NewSessionForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api.call('session.create', { projectId, name });
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 min-w-[380px]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="m-0 text-md font-semibold">New session</h3>
      {err && <ErrorState title="Failed to create session" message={err} />}

      <Field label="Name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="happy-path"
          autoFocus
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!name || busy}>
          {busy ? (
            <>
              <Spinner size={12} /> Creating…
            </>
          ) : (
            'Create'
          )}
        </Button>
      </div>
    </form>
  );
}
