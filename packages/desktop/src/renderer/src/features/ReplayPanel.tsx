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

  return (
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <History size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Replay mainnet tx</h1>
              <span className="entity-pill entity-pill-workflow">forensics</span>
            </div>
            <p className="entity-detail-hero-desc">
              Fetch tx, resolve ALT lookups, hydrate state at slot−1, execute locally,
              diff vs on-chain. Archive RPC recommended for reliable slot−1 reads.
            </p>
          </div>
        </div>
      </div>

      {err && (
        <div className="entity-detail-section">
          <ErrorState title="Replay failed" message={err} />
        </div>
      )}

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Input</h3>
          <span className="entity-detail-section-meta">paste signature, run</span>
        </div>
        <div className="replay-input-grid">
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
        <div className="flex justify-end mt-3">
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
        <>
          <div className="entity-detail-kpis">
            <div className={`entity-kpi tone-${result.verdict === 'match' ? 'good' : 'bad'}`}>
              <div className="entity-kpi-head">
                <span className="entity-kpi-icon" aria-hidden>
                  <Check size={14} />
                </span>
                <span className="entity-kpi-label">Verdict</span>
              </div>
              <div className="entity-kpi-value">{result.verdict.toUpperCase()}</div>
            </div>
            <div className="entity-kpi">
              <div className="entity-kpi-head">
                <span className="entity-kpi-icon" aria-hidden>
                  <History size={14} />
                </span>
                <span className="entity-kpi-label">Slot</span>
              </div>
              <div className="entity-kpi-value">{result.slot.toString()}</div>
            </div>
            <div className="entity-kpi">
              <div className="entity-kpi-head">
                <span className="entity-kpi-icon" aria-hidden>
                  <Check size={14} />
                </span>
                <span className="entity-kpi-label">Accounts</span>
              </div>
              <div className="entity-kpi-value">{result.hydratedAccounts.length}</div>
            </div>
            <div className="entity-kpi">
              <div className="entity-kpi-head">
                <span className="entity-kpi-icon" aria-hidden>
                  <Check size={14} />
                </span>
                <span className="entity-kpi-label">Programs</span>
              </div>
              <div className="entity-kpi-value">{result.loadedPrograms.length}</div>
            </div>
          </div>

          <div className="entity-detail-section">
            <div className="entity-detail-section-head">
              <h3 className="entity-detail-section-title">Execution diff</h3>
              <span className="entity-detail-section-meta">on-chain vs local</span>
            </div>
            <div className="replay-side-grid">
              <SideColumn title="On-chain" side={result.onChain} />
              <SideColumn title="Local" side={result.local} />
            </div>
          </div>
        </>
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
