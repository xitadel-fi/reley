import { Coins, Code, Copy, Key, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import { Button, Empty, ErrorState, IconButton, Input, Pubkey, Spinner } from '../ui';

interface KeypairMeta {
  id: string;
  label: string;
  pubkey: string;
  createdAt: number;
  sealed: boolean;
}

export function KeypairsPanel({
  activeSessionId,
}: {
  activeSessionId?: string | null;
}): JSX.Element {
  const [items, setItems] = useState<KeypairMeta[]>([]);
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [airdropping, setAirdropping] = useState<string | null>(null);
  const dialogs = useDialogs();
  const toast = useToast();

  const copySecret = async (id: string, lbl: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Reveal secret key',
      message:
        `The base58 secret for "${lbl}" will be copied to your clipboard. ` +
        `Anyone with this string can sign as this keypair. Don't paste into untrusted places.`,
      danger: true,
      confirmText: 'Reveal & copy',
    });
    if (!ok) return;
    try {
      const r = await api.call<{ secret: string }>('keypair.exportSecret', {
        id,
        format: 'base58',
      });
      await navigator.clipboard.writeText(r.secret);
      toast.success(`secret copied (base58) — ${lbl}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const copySecretJson = async (id: string, lbl: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Export secret as JSON array',
      message:
        `The 64-byte secret array for "${lbl}" will be copied to your clipboard ` +
        `(Solana-CLI / id.json format).`,
      danger: true,
      confirmText: 'Reveal & copy',
    });
    if (!ok) return;
    try {
      const r = await api.call<{ secret: string }>('keypair.exportSecret', {
        id,
        format: 'json',
      });
      await navigator.clipboard.writeText(r.secret);
      toast.success(`secret copied (JSON) — ${lbl}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const airdrop = async (pubkey: string): Promise<void> => {
    if (!activeSessionId) {
      setErr('select a sandbox first (left sidebar)');
      return;
    }
    const input = await dialogs.prompt({
      title: `Airdrop SOL`,
      label: `to ${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`,
      initial: '10',
      placeholder: 'SOL amount',
    });
    if (!input?.trim()) return;
    const sol = Number(input);
    if (!Number.isFinite(sol) || sol <= 0) {
      setErr('invalid amount');
      return;
    }
    const lamports = BigInt(Math.round(sol * 1_000_000_000));
    setAirdropping(pubkey);
    setErr(null);
    try {
      await api.call('session.airdrop', {
        sessionId: activeSessionId,
        pubkey,
        lamports: lamports.toString(),
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setAirdropping(null);
    }
  };

  const reload = async (): Promise<void> => {
    try {
      setItems(await api.call<KeypairMeta[]>('keypair.list'));
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const generate = async (): Promise<void> => {
    if (!label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.call('keypair.generate', { label: label.trim() });
      setLabel('');
      await reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const importKp = async (): Promise<void> => {
    if (!label.trim() || !secret.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      let secretInput: string | number[] = secret.trim();
      try {
        const parsed = JSON.parse(secretInput);
        if (Array.isArray(parsed)) secretInput = parsed as number[];
      } catch {
        // not JSON — assume base58
      }
      await api.call('keypair.import', { label: label.trim(), secretKey: secretInput });
      setLabel('');
      setSecret('');
      await reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, lbl: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Delete keypair',
      message: `Permanently remove "${lbl}"? Secret cannot be recovered.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    await api.call('keypair.delete', { id });
    await reload();
  };

  return (
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <Key size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Keypairs</h1>
              <span className="entity-pill entity-pill-workflow">sandbox-only</span>
            </div>
            <p className="entity-detail-hero-desc">
              Local signing keys for sandbox transactions.{' '}
              <span className="text-warning">Never use for mainnet funds.</span>
            </p>
          </div>
        </div>
      </div>

      {err && (
        <div className="entity-detail-section">
          <ErrorState title="Keypair error" message={err} />
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Add keypair</h3>
          <span className="entity-detail-section-meta">generate fresh or import a secret</span>
        </div>
        <div className="keypair-add-grid">
          <div className="keypair-add-row">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label · payer / admin / user-A"
              className="flex-1"
            />
            <Button variant="primary" size="md" disabled={!label.trim() || busy} onClick={generate}>
              {busy ? <Spinner size={12} /> : <Key size={12} aria-hidden />} Generate
            </Button>
          </div>
          <div className="keypair-add-row">
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Import · base58 OR Solana-CLI JSON ([64 bytes])"
              className="font-mono flex-1"
            />
            <Button
              variant="outline"
              size="md"
              disabled={!label.trim() || !secret.trim() || busy}
              onClick={importKp}
            >
              <Upload size={12} aria-hidden /> Import
            </Button>
          </div>
        </div>
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Saved keypairs</h3>
          <span className="entity-detail-section-meta">
            {items.length} keypair{items.length === 1 ? '' : 's'}
          </span>
        </div>
        {items.length === 0 ? (
          <Empty
            size="sm"
            icon={<Key size={18} aria-hidden />}
            title="No keypairs yet"
            description="Generate or import one above."
          />
        ) : (
          <ol className="keypair-grid">
            {items.map((k) => (
              <li key={k.id} className="keypair-card">
                <div className="keypair-card-head">
                  <span className="keypair-card-icon" aria-hidden>
                    <Key size={13} />
                  </span>
                  <span className="keypair-card-label">{k.label}</span>
                  <IconButton
                    icon={<Trash2 size={11} />}
                    label="Delete"
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove(k.id, k.label)}
                    className="ml-auto"
                  />
                </div>
                <div className="keypair-card-pubkey">
                  <Pubkey value={k.pubkey} className="text-text-muted" />
                </div>
                <div className="keypair-card-meta font-mono">
                  Created {new Date(k.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                </div>
                <div className="keypair-card-actions">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!activeSessionId || airdropping === k.pubkey}
                    onClick={() => void airdrop(k.pubkey)}
                    title={
                      activeSessionId
                        ? 'Fund this pubkey with SOL in active sandbox'
                        : 'Select a sandbox first'
                    }
                  >
                    {airdropping === k.pubkey ? (
                      <Spinner size={10} />
                    ) : (
                      <Coins size={11} aria-hidden />
                    )}
                    Airdrop
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void copySecret(k.id, k.label)}
                    title="Copy base58 secret key"
                  >
                    <Copy size={11} aria-hidden /> secret
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void copySecretJson(k.id, k.label)}
                    title="Copy Solana-CLI JSON (64-byte array)"
                  >
                    <Code size={11} aria-hidden /> json
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
