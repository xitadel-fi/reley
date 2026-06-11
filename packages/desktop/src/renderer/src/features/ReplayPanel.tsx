import { Check, History, Play, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Spinner,
} from '../ui';

interface ReplayResult {
  signature: string;
  slot: bigint | string;
  onChain: {
    success: boolean;
    cuConsumed: bigint | string | number;
    logs: string[];
    errorMessage: string | null;
  };
  local: {
    success: boolean;
    cuConsumed: bigint | string | number;
    logs: string[];
    errorMessage: string | null;
  };
  verdict: 'match' | 'divergent' | 'failed-locally';
  hydratedAccounts: string[];
  loadedPrograms: string[];
}

export function ReplayPanel({
  activeSessionId,
}: {
  activeSessionId: string | null;
}): JSX.Element {
  const [signature, setSignature] = useState('');
  const [rpcOverride, setRpcOverride] = useState('');
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setResult(null);
    setStatus('fetching transaction…');
    try {
      const params: Record<string, unknown> = { signature: signature.trim() };
      if (activeSessionId) params.sessionId = activeSessionId;
      if (rpcOverride) params.rpcUrl = rpcOverride;
      setStatus('hydrating accounts at slot−1, replaying…');
      const r = await api.call<ReplayResult>('tx.replay', params);
      setResult(r);
      setStatus(null);
    } catch (e) {
      setErr(String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const verdictVariant = (v: ReplayResult['verdict']): 'success' | 'warning' | 'danger' => {
    if (v === 'match') return 'success';
    if (v === 'divergent') return 'warning';
    return 'danger';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <h2 className="m-0 mb-1">Replay mainnet transaction</h2>
        <div className="text-xs text-text-muted mb-3">
          Fetches tx, resolves ALT lookups, hydrates state at slot−1, executes in LiteSVM, diffs vs
          on-chain. Archive RPC required for reliable slot−1 reads.
        </div>

        {err && <ErrorState title="Replay failed" message={err} />}

        <div className="flex flex-col gap-3">
          <Field label="Transaction signature" required>
            <Input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="base58 signature"
              className="font-mono"
              autoFocus
            />
          </Field>
          <Field label="Archive RPC override" help="Defaults to active project's RPC.">
            <Input
              value={rpcOverride}
              onChange={(e) => setRpcOverride(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3">
          <Button variant="primary" size="md" disabled={busy || !signature.trim()} onClick={submit}>
            {busy ? (
              <>
                <Spinner size={12} /> {status ?? 'Replaying…'}
              </>
            ) : (
              <>
                <Play size={12} aria-hidden /> Replay
              </>
            )}
          </Button>
        </div>
      </div>

      {result && (
        <div className="panel">
          <header className="flex items-start gap-3 mb-3 flex-wrap">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-surface-2 text-text-muted shrink-0"
              aria-hidden
            >
              <History size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-md font-semibold inline-flex items-center gap-2 flex-wrap">
                Verdict
                <Badge size="md" variant={verdictVariant(result.verdict)}>
                  {result.verdict.toUpperCase()}
                </Badge>
              </h2>
              <div className="text-xs text-text-muted mt-0.5">
                slot <span className="font-mono">{result.slot.toString()}</span> · hydrated{' '}
                {result.hydratedAccounts.length} accounts · loaded{' '}
                {result.loadedPrograms.length} programs
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SideColumn title="On-chain" side={result.onChain} />
            <SideColumn title="Local" side={result.local} />
          </div>
        </div>
      )}
    </div>
  );
}

function SideColumn({
  title,
  side,
}: {
  title: string;
  side: {
    success: boolean;
    cuConsumed: bigint | string | number;
    logs: string[];
    errorMessage: string | null;
  };
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-0 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-sm font-semibold text-text flex-1">{title}</div>
        {side.success ? (
          <Badge size="sm" variant="success">
            <Check size={10} aria-hidden /> ok
          </Badge>
        ) : (
          <Badge size="sm" variant="danger">
            <XCircle size={10} aria-hidden /> fail
          </Badge>
        )}
      </div>
      <div className="text-2xs text-text-muted mb-2">
        cu <span className="font-mono text-text">{side.cuConsumed.toString()}</span>
        {side.errorMessage && (
          <>
            {' · '}
            <span className="text-danger break-all font-mono">{side.errorMessage}</span>
          </>
        )}
      </div>
      <pre className="font-mono text-2xs bg-bg border border-border rounded-md p-2 max-h-[360px] overflow-auto m-0 whitespace-pre-wrap leading-relaxed">
        {side.logs.length > 0 ? side.logs.join('\n') : '(no logs)'}
      </pre>
    </div>
  );
}
