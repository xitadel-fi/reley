import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  ErrorState,
  Pubkey,
  Spinner,
} from '../ui';

interface BuiltinDescriptor {
  programId: string;
  label: string;
  inSvm: boolean;
  autoCloned?: boolean;
  hasIdl: boolean;
  description: string;
}

export function BuiltinPrograms({
  projectId,
  attachedProgramIds,
  onChange,
}: {
  projectId: string;
  attachedProgramIds: Set<string>;
  onChange: () => void;
}): JSX.Element {
  const [items, setItems] = useState<BuiltinDescriptor[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.call<BuiltinDescriptor[]>('program.listBuiltins').then(setItems);
  }, []);

  const add = async (programId: string): Promise<void> => {
    setBusy(programId);
    setErr(null);
    try {
      await api.call('program.add', { projectId, programId });
      onChange();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <h2 className="m-0 mb-1">Built-in programs</h2>
      <div className="text-xs text-text-muted mb-3">
        Always available - SPL Token / Token-2022 / Memo / ATA / Compute Budget / ALT
        ship inside the sandbox. Metaplex Token Metadata is bundled too and attaches
        on project create. Native programs need no IDL.
      </div>

      {err && <ErrorState title="Attach failed" message={err} />}

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle">
            <tr>
              <th className="text-left font-medium px-3 py-1.5">Program</th>
              <th className="text-left font-medium px-3 py-1.5">Program ID</th>
              <th className="text-left font-medium px-3 py-1.5 w-32">Source</th>
              <th className="px-3 py-1.5 w-28" />
            </tr>
          </thead>
          <tbody>
            {items.map((b) => {
              const attached = attachedProgramIds.has(b.programId);
              return (
                <tr key={b.programId} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="text-sm text-text">{b.label}</div>
                    <div className="text-2xs text-text-muted leading-relaxed mt-0.5 max-w-md">
                      {b.description}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Pubkey value={b.programId} className="text-text-muted" />
                  </td>
                  <td className="px-3 py-2">
                    {b.inSvm || b.autoCloned ? (
                      <Badge size="sm" variant="success">
                        Built-in
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="accent">
                        RPC clone
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {attached ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-text-subtle">
                        <Check size={11} aria-hidden /> attached
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busy === b.programId}
                        onClick={() => void add(b.programId)}
                      >
                        {busy === b.programId ? (
                          <Spinner size={10} />
                        ) : (
                          <Plus size={11} aria-hidden />
                        )}
                        Attach
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
