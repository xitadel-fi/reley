import { Camera, GitFork, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { Button, Empty, ErrorState, Input, Spinner } from '../ui';

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
      <div className="entity-detail">
        <div className="entity-detail-section">
          <Empty
            icon={<Camera size={20} aria-hidden />}
            title="No sandbox selected"
            description="Pick a sandbox in the sidebar to manage snapshots."
          />
        </div>
      </div>
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

  const restore = async (snapshotId: string, restoreVersions: boolean): Promise<void> => {
    setBusy(true);
    try {
      await api.call('snapshot.restore', {
        sessionId: activeSessionId,
        snapshotId,
        restoreVersions,
      });
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
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <Camera size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Snapshots</h1>
              <span className="entity-pill entity-pill-workflow">
                {session?.name ?? 'sandbox'}
              </span>
            </div>
            <p className="entity-detail-hero-desc">
              Capture and restore sandbox state. Fork branches state into a new sandbox.
            </p>
          </div>
        </div>
      </div>

      {err && (
        <div className="entity-detail-section">
          <ErrorState title="Snapshot error" message={err} />
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Save current state</h3>
          <span className="entity-detail-section-meta">create a new snapshot</span>
        </div>
        <div className="snapshot-save-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="pre-swap / after-airdrop / clean"
            className="flex-1"
          />
          <Button variant="primary" size="md" disabled={!name.trim() || busy} onClick={save}>
            {busy ? <Spinner size={12} /> : <Camera size={12} aria-hidden />} Save
          </Button>
        </div>
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Saved snapshots</h3>
          <span className="entity-detail-section-meta">
            {snaps.length} snapshot{snaps.length === 1 ? '' : 's'}
          </span>
        </div>
        {snaps.length === 0 ? (
          <Empty
            size="sm"
            icon={<Camera size={18} aria-hidden />}
            title="No snapshots yet"
            description="Save the current state above to create one."
          />
        ) : (
          <ol className="snapshot-grid">
            {snaps.map((s) => (
              <li key={s.id} className="snapshot-card">
                <div className="snapshot-card-head">
                  <Camera size={12} className="text-text-subtle" aria-hidden />
                  <span className="snapshot-card-name">{s.name}</span>
                </div>
                <div className="snapshot-card-meta font-mono">
                  <span title={s.fingerprint ?? ''}>
                    {s.fingerprint ? `${s.fingerprint.slice(0, 10)}…` : '—'}
                  </span>
                  <span>{new Date(s.createdAt).toISOString().slice(0, 19).replace('T', ' ')}</span>
                </div>
                <div className="snapshot-card-actions">
                  <Button
                    variant="outline"
                    size="xs"
                    title="Restore state only"
                    onClick={() => void restore(s.id, false)}
                  >
                    <RotateCcw size={11} aria-hidden /> Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    title="Restore + program-version overrides"
                    onClick={() => void restore(s.id, true)}
                  >
                    + versions
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={async () => {
                      const forkName = await dialogs.prompt({
                        title: 'Fork into new sandbox',
                        label: 'New sandbox name',
                        initial: `${s.name}-fork`,
                      });
                      if (forkName) void fork(s.id, forkName);
                    }}
                  >
                    <GitFork size={11} aria-hidden /> Fork
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
