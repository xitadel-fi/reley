import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface PatchRow {
  id: string;
  target: string;
  op:
    | { kind: 'setField'; fieldPath: string; valueJson: string }
    | { kind: 'rawSplice'; offset: number; bytes: unknown }
    | { kind: 'setLamports'; lamports: string | number | bigint }
    | { kind: 'setOwner'; owner: string };
  createdAt: number;
  enabled: boolean;
}

interface ScopedPatch extends PatchRow {
  scope: 'project' | 'session';
  scopeId: string;
}

/** Friendlier op summary with newbie-readable labels and SOL conversion for
 *  large lamport values. Avoids leaking IPC-level op kinds into the UI. */
function patchSummary(op: PatchRow['op']): string {
  switch (op.kind) {
    case 'setField':
      return `Edit field: ${op.fieldPath} = ${op.valueJson}`;
    case 'rawSplice':
      return `Edit bytes @ offset ${op.offset}`;
    case 'setLamports': {
      const n = BigInt(String(op.lamports));
      const abs = n < 0n ? -n : n;
      if (abs >= 1_000_000n) {
        const sol = Number(n) / 1e9;
        const fmt =
          Math.abs(sol) >= 1 ? sol.toFixed(3) : sol.toFixed(6).replace(/\.?0+$/, '');
        return `Set balance → ${fmt} SOL`;
      }
      return `Set balance → ${n.toString()} lamports`;
    }
    case 'setOwner':
      return `Set owner → ${op.owner.slice(0, 4)}…${op.owner.slice(-4)}`;
  }
}

export function AccountInspector({
  projectId,
  address,
  activeSessionId,
  onClose,
  onPatchRequested,
  onPatchesChanged,
}: {
  projectId: string;
  address: string;
  activeSessionId?: string | null;
  onClose: () => void;
  onPatchRequested: () => void;
  onPatchesChanged?: () => void;
}): JSX.Element {
  const [decoded, setDecoded] = useState<DecodedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'decoded' | 'hex' | 'raw'>('decoded');
  // Hex / Raw tabs hidden by default — most newbies want the decoded view
  // and clicking through 3 tabs creates "what am I looking at?" friction.
  // Persisted so power users don't re-toggle on every open.
  const [showBytes, setShowBytes] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('relay:inspector-show-bytes') === '1';
  });
  const toggleShowBytes = (): void => {
    setShowBytes((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('relay:inspector-show-bytes', next ? '1' : '0');
      if (!next) setView('decoded');
      return next;
    });
  };
  const [patches, setPatches] = useState<ScopedPatch[]>([]);

  useEffect(() => {
    setDecoded(null);
    setErr(null);
    void api
      .call<DecodedResult>('account.decode', { projectId, address })
      .then(setDecoded)
      .catch((e) => setErr(String(e)));
  }, [projectId, address]);

  const reloadPatches = useCallback(async (): Promise<void> => {
    const out: ScopedPatch[] = [];
    try {
      const proj = await api.call<PatchRow[]>('patch.list', {
        scope: 'project',
        scopeId: projectId,
      });
      out.push(...proj.map((p) => ({ ...p, scope: 'project' as const, scopeId: projectId })));
    } catch {
      /* swallow */
    }
    if (activeSessionId) {
      try {
        const sess = await api.call<PatchRow[]>('patch.list', {
          scope: 'session',
          scopeId: activeSessionId,
        });
        out.push(
          ...sess.map((p) => ({ ...p, scope: 'session' as const, scopeId: activeSessionId })),
        );
      } catch {
        /* swallow */
      }
    }
    setPatches(out.filter((p) => p.target === address));
  }, [projectId, activeSessionId, address]);

  useEffect(() => {
    void reloadPatches();
  }, [reloadPatches]);

  const togglePatch = async (p: ScopedPatch): Promise<void> => {
    try {
      await api.call('patch.toggle', {
        scope: p.scope,
        scopeId: p.scopeId,
        patchId: p.id,
        enabled: !p.enabled,
      });
      await reloadPatches();
      onPatchesChanged?.();
    } catch (e) {
      setErr(String(e));
    }
  };
  const removePatch = async (p: ScopedPatch): Promise<void> => {
    try {
      await api.call('patch.remove', {
        scope: p.scope,
        scopeId: p.scopeId,
        patchId: p.id,
      });
      await reloadPatches();
      onPatchesChanged?.();
    } catch (e) {
      setErr(String(e));
    }
  };

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
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="decoded">Decoded</TabsTrigger>
              {showBytes && (
                <>
                  <TabsTrigger value="hex">Hex</TabsTrigger>
                  <TabsTrigger value="raw" disabled={!decoded.raw}>
                    Raw base64
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            <button
              type="button"
              className="text-2xs text-text-subtle hover:text-text inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-1 transition-colors"
              onClick={toggleShowBytes}
              title={showBytes ? 'Hide raw byte tabs' : 'Show raw byte tabs (advanced)'}
            >
              {showBytes ? 'Hide bytes' : 'Show bytes'}
            </button>
          </div>

          <TabsContent value="decoded">
            {decoded.value ? (
              <pre className="font-mono text-xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto m-0 leading-relaxed">
                {JSON.stringify(decoded.value, jsonReplacer, 2)}
              </pre>
            ) : (
              <Empty
                size="sm"
                title="No decoder matched"
                description={
                  showBytes ? 'Switch to Hex view to see raw bytes.' : 'Click "Show bytes" to view raw data.'
                }
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

      {/* Per-account patches — both project + sandbox scopes targeting this
          address, with inline toggle + remove. New patch via the same form
          used elsewhere. */}
      <div className="rounded-md border border-border bg-surface-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-2xs uppercase tracking-wider text-text-subtle font-medium">
            Patches{' '}
            <Badge size="sm" variant="default" className="ml-1">
              {patches.length}
            </Badge>
          </div>
          <Button variant="ghost" size="xs" onClick={onPatchRequested}>
            <Pencil size={11} aria-hidden /> New patch
          </Button>
        </div>
        {patches.length === 0 ? (
          <div className="text-2xs text-text-subtle italic py-1">
            No patches target this account.{' '}
            {activeSessionId
              ? 'Click "New patch" to add one.'
              : '(open a sandbox to create sandbox-scope patches)'}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {patches.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5"
              >
                <Badge size="sm" variant={p.scope === 'project' ? 'accent' : 'warning'}>
                  {p.scope}
                </Badge>
                <span className="font-mono text-2xs text-text flex-1 truncate">
                  {patchSummary(p.op)}
                </span>
                <label
                  className="inline-flex items-center gap-1 text-2xs text-text-muted cursor-pointer select-none"
                  title="Enable/disable this patch"
                >
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() => void togglePatch(p)}
                  />
                  on
                </label>
                <button
                  type="button"
                  onClick={() => void removePatch(p)}
                  title="Remove patch"
                  aria-label="Remove patch"
                  className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-danger hover:bg-danger/10"
                >
                  <Trash2 size={11} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
