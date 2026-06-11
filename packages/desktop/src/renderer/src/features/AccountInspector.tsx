import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Pubkey,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ui';

interface DecodedResult {
  address: string;
  programId: string;
  accountName: string | null;
  value: unknown;
  dataLen: number;
  raw?: string;
  decoder?: 'anchor' | 'native' | null;
}

export function AccountInspector({
  projectId,
  address,
  onClose,
  onPatchRequested,
}: {
  projectId: string;
  address: string;
  onClose: () => void;
  onPatchRequested: () => void;
}): JSX.Element {
  const [decoded, setDecoded] = useState<DecodedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'decoded' | 'hex' | 'raw'>('decoded');

  useEffect(() => {
    setDecoded(null);
    setErr(null);
    void api
      .call<DecodedResult>('account.decode', { projectId, address })
      .then(setDecoded)
      .catch((e) => setErr(String(e)));
  }, [projectId, address]);

  const hexBlocks = useMemo<string | null>(() => {
    if (!decoded?.raw) return null;
    const bytes = atob(decoded.raw);
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const slice = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(6, '0');
      const hex = Array.from(slice)
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ')
        .padEnd(16 * 3 - 1, ' ');
      const ascii = Array.from(slice)
        .map((c) => {
          const code = c.charCodeAt(0);
          return code >= 0x20 && code <= 0x7e ? c : '·';
        })
        .join('');
      lines.push(`${offset}  ${hex}  ${ascii}`);
    }
    return lines.join('\n');
  }, [decoded?.raw]);

  return (
    <div className="flex flex-col gap-3 min-w-[520px] max-w-[720px]">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="m-0 text-md font-semibold">Account inspector</h3>
          <div className="mt-1">
            <Pubkey value={address} full={false} truncate={6} className="text-text-muted text-xs" />
          </div>
        </div>
        {decoded?.decoder && (
          <Badge size="md" variant={decoded.decoder === 'anchor' ? 'accent' : 'default'}>
            {decoded.decoder} decoder
          </Badge>
        )}
      </header>

      {err && <ErrorState title="Failed to decode" message={err} />}

      {decoded && (
        <div className="rounded-md border border-border bg-surface-0 p-3 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-xs">
          <div className="text-text-subtle">Program</div>
          <Pubkey value={decoded.programId} className="text-text-muted" />

          <div className="text-text-subtle">Account name</div>
          <div className="text-text">
            {decoded.accountName ?? (
              <span className="italic text-text-subtle">no IDL match</span>
            )}
          </div>

          <div className="text-text-subtle">Data length</div>
          <div className="text-text font-mono">{decoded.dataLen} bytes</div>
        </div>
      )}

      {!decoded && !err && (
        <div className="py-6">
          <Spinner label="Decoding account…" />
        </div>
      )}

      {decoded && (
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="decoded">Decoded</TabsTrigger>
            <TabsTrigger value="hex">Hex</TabsTrigger>
            <TabsTrigger value="raw" disabled={!decoded.raw}>
              Raw base64
            </TabsTrigger>
          </TabsList>

          <TabsContent value="decoded">
            {decoded.value ? (
              <pre className="font-mono text-xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto m-0 leading-relaxed">
                {JSON.stringify(decoded.value, jsonReplacer, 2)}
              </pre>
            ) : (
              <Empty
                size="sm"
                title="No decoder matched"
                description="Switch to Hex view to see raw bytes."
              />
            )}
          </TabsContent>

          <TabsContent value="hex">
            {hexBlocks ? (
              <pre className="font-mono text-2xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto m-0 leading-snug whitespace-pre">
                {hexBlocks}
              </pre>
            ) : (
              <Empty size="sm" title="No raw bytes" description="The decoded view shows fields." />
            )}
          </TabsContent>

          <TabsContent value="raw">
            <pre className="font-mono text-2xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto m-0 break-all whitespace-pre-wrap">
              {decoded.raw ?? '(no raw bytes available)'}
            </pre>
          </TabsContent>
        </Tabs>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" size="md" onClick={onPatchRequested}>
          <Pencil size={12} aria-hidden /> Patch this account…
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
