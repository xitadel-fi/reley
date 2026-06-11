import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import {
  Button,
  ErrorState,
  Field,
  IconButton,
  Input,
  Pubkey,
  Select,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../ui';

type Tab = 'ata' | 'pda';

interface SeedRow {
  kind: 'pubkey' | 'utf8' | 'hex' | 'u8' | 'u32' | 'u64';
  value: string;
}

export function DeriveAddressForm({
  onPick,
  onClose,
  suggestions = [],
}: {
  onPick: (address: string) => void;
  onClose: () => void;
  suggestions?: Array<{ pubkey: string; label: string }>;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('ata');

  const [owner, setOwner] = useState('');
  const [mint, setMint] = useState('');
  const [token2022, setToken2022] = useState(false);

  const [programId, setProgramId] = useState('');
  const [seeds, setSeeds] = useState<SeedRow[]>([{ kind: 'utf8', value: '' }]);

  const [result, setResult] = useState<{ address: string; bump?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const derive = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      if (tab === 'ata') {
        if (!owner.trim() || !mint.trim()) throw new Error('owner + mint required');
        const r = await api.call<{ address: string }>('address.deriveAta', {
          owner: owner.trim(),
          mint: mint.trim(),
          ...(token2022 && { tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }),
        });
        setResult(r);
      } else {
        if (!programId.trim()) throw new Error('program ID required');
        const r = await api.call<{ address: string; bump: number }>('address.derivePda', {
          programId: programId.trim(),
          seeds,
        });
        setResult(r);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[520px] max-w-[680px]">
      <h3 className="m-0 text-md font-semibold">Derive address</h3>
      {err && <ErrorState title="Derivation failed" message={err} />}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="ata">Associated Token Account</TabsTrigger>
          <TabsTrigger value="pda">PDA (custom seeds)</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'ata' && (
        <div className="flex flex-col gap-3">
          <Field label="Owner (wallet pubkey)" required>
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="font-mono"
              list="derive-owner-suggest"
              autoFocus
            />
            <datalist id="derive-owner-suggest">
              {suggestions.map((s) => (
                <option key={s.pubkey} value={s.pubkey}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Mint" required>
            <Input
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              className="font-mono"
              list="derive-mint-suggest"
            />
            <datalist id="derive-mint-suggest">
              {suggestions.map((s) => (
                <option key={s.pubkey} value={s.pubkey}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </Field>
          <label className="inline-flex items-center gap-2 text-xs text-text cursor-pointer">
            <input
              type="checkbox"
              checked={token2022}
              onChange={(e) => setToken2022(e.target.checked)}
            />
            Mint uses Token-2022
          </label>
        </div>
      )}

      {tab === 'pda' && (
        <div className="flex flex-col gap-3">
          <Field label="Program ID" required>
            <Input
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="font-mono"
              list="derive-programid-suggest"
              autoFocus
            />
            <datalist id="derive-programid-suggest">
              {suggestions.map((s) => (
                <option key={s.pubkey} value={s.pubkey}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </Field>
          <div>
            <div className="text-xs font-medium text-text-muted mb-1.5">Seeds</div>
            <div className="flex flex-col gap-2">
              {seeds.map((s, i) => (
                <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-2 items-center">
                  <Select
                    value={s.kind}
                    sizeVariant="sm"
                    onChange={(e) =>
                      setSeeds((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, kind: e.target.value as SeedRow['kind'] } : x,
                        ),
                      )
                    }
                  >
                    <option value="utf8">utf8</option>
                    <option value="pubkey">pubkey</option>
                    <option value="hex">hex</option>
                    <option value="u8">u8</option>
                    <option value="u32">u32 LE</option>
                    <option value="u64">u64 LE</option>
                  </Select>
                  <Input
                    value={s.value}
                    sizeVariant="sm"
                    className="font-mono"
                    onChange={(e) =>
                      setSeeds((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, value: e.target.value } : x,
                        ),
                      )
                    }
                    list={s.kind === 'pubkey' ? `derive-seed-pubkey-${i}` : undefined}
                  />
                  {s.kind === 'pubkey' && (
                    <datalist id={`derive-seed-pubkey-${i}`}>
                      {suggestions.map((sg) => (
                        <option key={sg.pubkey} value={sg.pubkey}>
                          {sg.label}
                        </option>
                      ))}
                    </datalist>
                  )}
                  <IconButton
                    icon={<X size={12} />}
                    label="Remove seed"
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      setSeeds((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  />
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setSeeds((prev) => [...prev, { kind: 'utf8', value: '' }])}
            >
              <Plus size={11} aria-hidden /> Add seed
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-md border border-success/40 bg-success/5 p-3">
          <div className="text-2xs text-success uppercase tracking-wider font-semibold mb-1.5">
            <Check size={11} aria-hidden className="inline mr-1" /> Derived
          </div>
          <Pubkey value={result.address} full className="text-text break-all" />
          {result.bump !== undefined && (
            <div className="text-2xs text-text-muted mt-1.5 font-mono">bump: {result.bump}</div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" onClick={() => void derive()} disabled={busy}>
          {busy ? (
            <>
              <Spinner size={12} /> Deriving…
            </>
          ) : (
            'Derive'
          )}
        </Button>
        {result && (
          <Button
            variant="primary"
            onClick={() => {
              onPick(result.address);
              onClose();
            }}
          >
            Use this address
          </Button>
        )}
      </div>
    </div>
  );
}
