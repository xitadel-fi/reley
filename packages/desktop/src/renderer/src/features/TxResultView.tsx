import { Check, ChevronDown, ChevronRight, Copy, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Empty, IconButton, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui';

interface LogLine {
  raw: string;
  level: string;
}

export interface TraceNode {
  programId: string;
  depth: number;
  instructionIndex: number;
  cuConsumed: bigint | string | number;
  cuRemaining: bigint | string | number;
  logs: LogLine[];
  events: Array<{ name: string; data: Record<string, unknown> }>;
  returnData: Uint8Array | string | null;
  children: TraceNode[];
  error: string | null;
}

export interface TxSendResult {
  success: boolean;
  errorMessage: string | null;
  cuConsumed: bigint | string | number;
  returnData: string | null;
  logs: string[];
  trace: TraceNode[];
  recordId?: string;
  simulated?: boolean;
}

export function TxResultView({ result }: { result: TxSendResult }): JSX.Element {
  const [tab, setTab] = useState<'tree' | 'logs' | 'return'>('tree');
  return (
    <div className="panel">
      <header className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {result.success ? (
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/15 text-success shrink-0"
              aria-hidden
            >
              <Check size={16} strokeWidth={2.5} />
            </span>
          ) : (
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-danger/15 text-danger shrink-0"
              aria-hidden
            >
              <XCircle size={16} strokeWidth={2.5} />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="m-0 text-md font-semibold">
                {result.simulated ? 'Simulation' : 'Result'} ·{' '}
                <span className={result.success ? 'text-success' : 'text-danger'}>
                  {result.success ? 'SUCCESS' : 'FAILURE'}
                </span>
              </h2>
              {result.simulated && (
                <Badge size="sm" variant="accent">
                  no state change
                </Badge>
              )}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              cu consumed:{' '}
              <span className="font-mono text-text">{result.cuConsumed.toString()}</span>
              {result.errorMessage && (
                <>
                  {' '}
                  · error:{' '}
                  <span className="font-mono text-danger break-all">{result.errorMessage}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {result.recordId && <CopyButton value={result.recordId} label="record id" />}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="tree">Instruction tree</TabsTrigger>
          <TabsTrigger value="logs">
            Raw logs
            <span className="ml-1 text-2xs text-text-subtle">({result.logs.length})</span>
          </TabsTrigger>
          <TabsTrigger value="return">Return data</TabsTrigger>
        </TabsList>

        <TabsContent value="tree">
          {result.trace.length === 0 ? (
            <Empty
              size="sm"
              title="No trace recorded"
              description="Tx failed before reaching the program (signature, account resolution, or sanitization). Check error message above."
            />
          ) : (
            <div className="rounded-md border border-border bg-bg p-3 font-mono text-xs">
              {result.trace.map((node, i) => (
                <TraceFrame key={i} node={node} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs">
          <pre className="font-mono text-xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto leading-relaxed m-0">
            {result.logs.length > 0 ? result.logs.join('\n') : '(no logs — tx never executed)'}
          </pre>
        </TabsContent>

        <TabsContent value="return">
          <pre className="font-mono text-xs bg-bg border border-border rounded-md p-3 max-h-[400px] overflow-auto m-0">
            {result.returnData ?? '(none)'}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? <Check size={12} /> : <Copy size={12} />}
      label={`Copy ${label}`}
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    />
  );
}

function TraceFrame({ node }: { node: TraceNode }): JSX.Element {
  const [open, setOpen] = useState(true);
  const indent = node.depth * 12;
  const cuConsumed = Number(node.cuConsumed.toString());
  const cuRemaining = Number(node.cuRemaining.toString());
  const total = cuConsumed + cuRemaining || 1;
  const pct = (cuConsumed / total) * 100;
  return (
    <div style={{ marginLeft: indent }} className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full text-left bg-transparent border-0 px-0 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 rounded"
      >
        <span className="w-3.5 text-text-muted inline-flex justify-center">
          {node.children.length > 0 ? (
            open ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : (
            <span className="w-1 h-1 rounded-full bg-text-subtle" />
          )}
        </span>
        <span className="text-text">
          [{node.depth}] {node.programId.slice(0, 4)}…{node.programId.slice(-4)}
        </span>
        <span className="text-text-subtle">· cu {cuConsumed}</span>
        {node.error && <span className="text-danger">· {node.error}</span>}
      </button>
      <div
        className="ml-5 mt-0.5 h-1 rounded bg-surface-2 overflow-hidden"
        title={`${cuConsumed} of ${total} CU`}
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {open && (
        <>
          <div className="ml-5 mt-1 text-text-muted">
            {node.logs
              .filter(
                (l) => l.level !== 'invoke' && l.level !== 'success' && l.level !== 'consumed',
              )
              .map((l, i) => (
                <div key={i}>{l.raw}</div>
              ))}
          </div>
          {node.children.map((c, i) => (
            <TraceFrame key={i} node={c} />
          ))}
        </>
      )}
    </div>
  );
}
