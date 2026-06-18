import { useEffect, useState } from 'react';
import { api } from '../api';
import { AddressInput } from '../components/AddressInput';
import { useAddressSuggestions } from '../components/useAddressSuggestions';
import type { Project } from '../types';
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Pubkey,
  Select,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../ui';

interface EditableField {
  name: string;
  type: string;
}

interface DecodedResult {
  address: string;
  programId: string;
  accountName: string | null;
  value: unknown;
  dataLen: number;
  raw?: string;
  decoder?: 'anchor' | 'native' | null;
  editableFields?: EditableField[];
}

type PatchKind = 'setField' | 'setLamports' | 'setOwner' | 'rawSplice';

export function PatchAccountForm({
  projectId,
  sessionId,
  address,
  project,
  onDone,
}: {
  projectId: string;
  sessionId: string | null;
  address: string;
  project?: Project | null;
  onDone: () => void;
}): JSX.Element {
  const suggestions = useAddressSuggestions(project ?? null);
  const [scope, setScope] = useState<'project' | 'session'>(sessionId ? 'session' : 'project');
  const [decoded, setDecoded] = useState<DecodedResult | null>(null);
  const [decodeErr, setDecodeErr] = useState<string | null>(null);
  const [kind, setKind] = useState<PatchKind>('setField');
  const [fieldPath, setFieldPath] = useState('');
  const [valueJson, setValueJson] = useState('');
  const [lamports, setLamports] = useState('');
  const [owner, setOwner] = useState('');
  const [offset, setOffset] = useState('0');
  const [hexBytes, setHexBytes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<DecodedResult>('account.decode', { projectId, address })
      .then(setDecoded)
      .catch((e) => setDecodeErr(String(e)));
  }, [projectId, address]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      let op: unknown;
      if (kind === 'setField') {
        op = { kind: 'setField', fieldPath, valueJson };
      } else if (kind === 'setLamports') {
        op = { kind: 'setLamports', lamports: BigInt(lamports || '0') };
      } else if (kind === 'setOwner') {
        op = { kind: 'setOwner', owner };
      } else {
        const hex = hexBytes.startsWith('0x') ? hexBytes.slice(2) : hexBytes;
        const clean = hex.replace(/\s+/g, '');
        if (clean.length % 2 !== 0) throw new Error('hex must have even length');
        const bytes = new Uint8Array(clean.length / 2);
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
        }
        op = { kind: 'rawSplice', offset: Number(offset), bytes };
      }
      await api.call('patch.create', {
        scope,
        scopeId: scope === 'project' ? projectId : sessionId,
        target: address,
        op,
        enabled: true,
      });
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[560px] max-w-[720px]">
      <div>
        <h3 className="m-0 text-md font-semibold">Patch account</h3>
        <div className="mt-1">
          <Pubkey value={address} truncate={6} className="text-text-muted text-xs" />
        </div>
      </div>

      {err && <ErrorState title="Failed to save patch" message={err} />}

      <Field label="Scope" help="Project patches apply to every sandbox; sandbox patches to one.">
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'project' | 'session')}>
          <TabsList>
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="session" disabled={!sessionId}>
              Sandbox
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Field>

      <div>
        <div className="text-xs text-text-muted mb-1.5">Decoded</div>
        {decodeErr && <ErrorState message={decodeErr} />}
        {decoded ? (
          <div className="rounded-md border border-border bg-bg p-3 max-h-[220px] overflow-auto">
            <div className="text-2xs text-text-subtle inline-flex items-center gap-1.5 flex-wrap mb-2">
              <span>program:</span>
              <Pubkey value={decoded.programId} className="text-text-muted" />
              <span>·</span>
              <span>
                {decoded.accountName ?? (
                  <span className="italic text-text-subtle">no IDL match</span>
                )}
              </span>
              <span>·</span>
              <Badge size="sm" variant="outline">
                {decoded.dataLen} bytes
              </Badge>
              {decoded.decoder && (
                <Badge size="sm" variant={decoded.decoder === 'anchor' ? 'accent' : 'default'}>
                  {decoded.decoder}
                </Badge>
              )}
            </div>
            <pre className="font-mono text-2xs leading-relaxed m-0 text-text">
              {JSON.stringify(decoded.value ?? decoded.raw ?? '(raw bytes)', jsonReplacer, 2)}
            </pre>
          </div>
        ) : (
          !decodeErr && (
            <div className="py-3">
              <Spinner label="Decoding…" />
            </div>
          )
        )}
      </div>

      <Field label="Patch type">
        <Select value={kind} onChange={(e) => setKind(e.target.value as PatchKind)}>
          <option value="setField">setField (IDL-aware)</option>
          <option value="setLamports">setLamports</option>
          <option value="setOwner">setOwner</option>
          <option value="rawSplice">rawSplice (hex)</option>
        </Select>
      </Field>

      {kind === 'setField' && (
        <>
          {decoded?.editableFields && decoded.editableFields.length > 0 && (
            <Field label={`Editable fields (${decoded.decoder})`}>
              <Select value={fieldPath} onChange={(e) => setFieldPath(e.target.value)}>
                <option value="">— pick a field —</option>
                {decoded.editableFields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} : {f.type}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="Field path (dotted)"
            help={decoded?.editableFields ? 'Or type manually.' : undefined}
          >
            <Input
              value={fieldPath}
              onChange={(e) => setFieldPath(e.target.value)}
              placeholder={
                decoded?.decoder === 'native'
                  ? 'mintAuthority / supply / decimals …'
                  : 'admin'
              }
              className="font-mono"
            />
          </Field>
          <Field label="Value (JSON-encoded)">
            <Input
              value={valueJson}
              onChange={(e) => setValueJson(e.target.value)}
              placeholder={'"<base58 pubkey>" or "1000000" or null'}
              className="font-mono"
            />
          </Field>
        </>
      )}
      {kind === 'setLamports' && (
        <Field label="Lamports">
          <Input
            value={lamports}
            onChange={(e) => setLamports(e.target.value)}
            placeholder="1000000000"
            className="font-mono"
          />
        </Field>
      )}
      {kind === 'setOwner' && (
        <Field label="New owner (base58)">
          <AddressInput value={owner} onChange={setOwner} suggestions={suggestions} />
        </Field>
      )}
      {kind === 'rawSplice' && (
        <>
          <Field label="Offset">
            <Input
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              className="font-mono max-w-[160px]"
            />
          </Field>
          <Field label="Bytes (hex)">
            <Input
              value={hexBytes}
              onChange={(e) => setHexBytes(e.target.value)}
              className="font-mono"
            />
          </Field>
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={submit}>
          {busy ? (
            <>
              <Spinner size={12} /> Saving…
            </>
          ) : (
            'Save patch'
          )}
        </Button>
      </div>
    </div>
  );
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    return Array.from(value)
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('');
  }
  return value;
}
