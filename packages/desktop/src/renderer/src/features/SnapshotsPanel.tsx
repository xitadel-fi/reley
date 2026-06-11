import { Camera, GitFork, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Input,
  Spinner,
} from '../ui';

interface SnapshotRef {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  blobHash?: string;
  fingerprint?: string;
}

interface SessionWithSnaps {
  id: string;
  name: string;
  snapshots: SnapshotRef[];
}

export function SnapshotsPanel({
  activeSessionId,
  onChange,
}: {
  activeSessionId: string | null;
  onChange: () => void;
}): JSX.Element {
  const [session, setSession] = useState<SessionWithSnaps | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogs = useDialogs();

  const reload = async (): Promise<void> => {
    if (!activeSessionId) {
      setSession(null);
      return;
    }
    try {
      const s = await api.call<SessionWithSnaps>('session.open', { id: activeSessionId });
      setSession(s);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, [activeSessionId]);

  if (!activeSessionId) {
    return (
      <Empty
        icon={<Camera size={20} aria-hidden />}
        title="No session selected"
        description="Pick a session in the sidebar to manage snapshots."
      />
    );
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.call('snapshot.save', { sessionId: activeSessionId, name: name.trim() });
      setName('');
      await reload();
      onChange();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (snapshotId: string): Promise<void> => {
    setBusy(true);
    try {
      await api.call('snapshot.restore', { sessionId: activeSessionId, snapshotId });
      onChange();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const fork = async (snapshotId: string, forkName: string): Promise<void> => {
    setBusy(true);
    try {
      await api.call('snapshot.fork', {
        sessionId: activeSessionId,
        snapshotId,
        name: forkName,
      });
      onChange();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const snaps = session?.snapshots ?? [];

  return (
    <div className="panel">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
        <h2 className="m-0">
          Snapshots <span className="text-sm font-normal text-text-muted">· {session?.name}</span>
        </h2>
        <span className="text-2xs text-text-subtle">{snaps.length} saved</span>
      </div>
      <div className="text-xs text-text-muted mb-3">
        Capture and restore session state. Fork branches into a new session.
      </div>

      {err && <ErrorState title="Snapshot error" message={err} />}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mb-4">
        <Field label="Snapshot name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="pre-swap / after-airdrop / clean"
          />
        </Field>
        <div className="self-end">
          <Button variant="primary" size="md" disabled={!name.trim() || busy} onClick={save}>
            {busy ? <Spinner size={12} /> : <Camera size={12} aria-hidden />} Save state
          </Button>
        </div>
      </div>

      {snaps.length === 0 ? (
        <Empty
          size="sm"
          icon={<Camera size={18} aria-hidden />}
          title="No snapshots yet"
          description="Save the current state above to create one."
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">Name</th>
                <th className="text-left font-medium px-3 py-1.5">Fingerprint</th>
                <th className="text-left font-medium px-3 py-1.5">Created</th>
                <th className="px-3 py-1.5 w-44" />
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-surface-1/40">
                  <td className="px-3 py-1.5 text-text">{s.name}</td>
                  <td className="px-3 py-1.5 font-mono text-2xs text-text-subtle">
                    {s.fingerprint ? `${s.fingerprint.slice(0, 12)}…` : '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-2xs text-text-subtle">
                    {new Date(s.createdAt).toISOString().slice(0, 19)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void restore(s.id)}
                      >
                        <RotateCcw size={11} aria-hidden /> Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={async () => {
                          const forkName = await dialogs.prompt({
                            title: 'Fork into new session',
                            label: 'New session name',
                            initial: `${s.name}-fork`,
                          });
                          if (forkName) void fork(s.id, forkName);
                        }}
                      >
                        <GitFork size={11} aria-hidden /> Fork
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
