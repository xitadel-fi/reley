import { Eye, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui';
import type { Project } from '../types';

export interface InspectableIx {
  programId: string;
  programLabel: string;
  instructionName: string;
  summary: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

interface DecodedArgs {
  source: 'anchor' | 'native' | 'none';
  name: string | null;
  args: Record<string, unknown> | null;
  /** Per-account role names from IDL (position-aligned with ix.accounts). */
  accountNames: string[];
}

/**
 * Solscan-style instruction inspector. Click to open a modal showing one
 * ix's program, accounts (with labels + role flags), decoded args, and
 * raw data.
 */
export function IxInspectButton({
  ix,
  project,
}: {
  ix: InspectableIx;
  project: Project;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Inspect instruction"
        className="inline-flex items-center gap-1 text-2xs text-text-muted hover:text-text px-1.5 py-0.5 rounded hover:bg-surface-1 transition-colors"
      >
        <Eye size={11} aria-hidden /> inspect
      </button>
      {open && (
        <IxInspectModal ix={ix} project={project} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function IxInspectModal({
  ix,
  project,
  onClose,
}: {
  ix: InspectableIx;
  project: Project;
  onClose: () => void;
}): JSX.Element {
  const [decoded, setDecoded] = useState<DecodedArgs | null>(null);
  const [decodeErr, setDecodeErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<DecodedArgs>('tx.decodeIx', { programId: ix.programId, dataBase64: ix.dataBase64 })
      .then(setDecoded)
      .catch((e) => setDecodeErr(String(e)));
  }, [ix.programId, ix.dataBase64]);

  const labels = buildAddressLabels(project);
  const tag = (addr: string): string => labels.get(addr) ?? '';
  const dataHex = base64ToHex(ix.dataBase64);
  const dataLen = Math.floor((ix.dataBase64.length * 3) / 4);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="!max-w-5xl">
        <DialogHeader>
          <DialogTitle>Instruction inspector</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 max-h-[70vh] overflow-auto -mx-1 px-1">
          <Section title="Program">
            <KV k="programId" v={ix.programId} mono />
            <KV k="label" v={ix.programLabel || '(unlabeled)'} />
          </Section>

          <Section title="Instruction">
            <KV k="name" v={ix.instructionName} />
            <KV k="summary" v={ix.summary} />
          </Section>

          <Section
            title={`Accounts (${ix.accounts.length})`}
            empty={ix.accounts.length === 0 ? 'no accounts' : null}
          >
            {ix.accounts.length > 0 && (
              <table className="w-full text-2xs">
                <thead className="text-text-subtle">
                  <tr>
                    <th className="text-left font-medium px-1 py-1 w-6">#</th>
                    <th className="text-left font-medium px-1 py-1 w-32">IDL role</th>
                    <th className="text-left font-medium px-1 py-1">Address</th>
                    <th className="text-left font-medium px-1 py-1 w-14">Signer</th>
                    <th className="text-left font-medium px-1 py-1 w-14">Writable</th>
                  </tr>
                </thead>
                <tbody>
                  {ix.accounts.map((acc, i) => {
                    const idlRole = decoded?.accountNames?.[i] ?? null;
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="px-1 py-1 font-mono text-text-subtle align-top">{i}</td>
                        <td className="px-1 py-1 align-top">
                          {idlRole ? (
                            <span className="font-mono text-accent">{idlRole}</span>
                          ) : (
                            <span className="text-text-subtle italic">—</span>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <div className="font-mono break-all text-text">{acc.pubkey}</div>
                          {tag(acc.pubkey) && (
                            <div className="text-2xs text-accent">{tag(acc.pubkey)}</div>
                          )}
                        </td>
                        <td className="px-1 py-1 align-top">
                          {acc.isSigner ? (
                            <Badge size="sm" variant="accent">
                              signer
                            </Badge>
                          ) : (
                            <span className="text-text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-1 py-1 align-top">
                          {acc.isWritable ? (
                            <Badge size="sm" variant="warning">
                              writable
                            </Badge>
                          ) : (
                            <span className="text-text-subtle">ro</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Decoded args">
            {decodeErr ? (
              <div className="text-2xs text-danger font-mono">{decodeErr}</div>
            ) : !decoded ? (
              <div className="text-2xs text-text-subtle italic">decoding…</div>
            ) : decoded.source === 'none' ? (
              <div className="text-2xs text-text-subtle italic">
                no IDL / native handler matched — raw data shown below
              </div>
            ) : (
              <>
                <div className="text-2xs text-text-muted mb-1">
                  source: <span className="text-accent">{decoded.source}</span>
                  {decoded.name && (
                    <>
                      {' '}
                      · ix: <span className="font-mono text-text">{decoded.name}</span>
                    </>
                  )}
                </div>
                <pre className="font-mono text-2xs bg-bg border border-border rounded p-2 m-0 max-h-[240px] overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(decoded.args ?? {}, null, 2)}
                </pre>
              </>
            )}
          </Section>

          <Section title={`Raw data (${dataLen} bytes)`}>
            <div className="text-2xs text-text-subtle mb-1">base64</div>
            <pre className="font-mono text-2xs bg-bg border border-border rounded p-2 m-0 max-h-[120px] overflow-auto whitespace-pre-wrap break-all">
              {ix.dataBase64 || '(empty)'}
            </pre>
            <div className="text-2xs text-text-subtle mt-2 mb-1">hex</div>
            <pre className="font-mono text-2xs bg-bg border border-border rounded p-2 m-0 max-h-[120px] overflow-auto whitespace-pre-wrap break-all">
              {dataHex || '(empty)'}
            </pre>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X size={12} aria-hidden /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children?: React.ReactNode;
  empty?: string | null;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-0 p-2.5">
      <div className="text-2xs uppercase tracking-wider text-text-subtle mb-1.5">{title}</div>
      {empty ? <div className="text-2xs text-text-subtle italic">{empty}</div> : children}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }): JSX.Element {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 text-2xs">
      <div className="text-text-subtle">{k}</div>
      <div className={mono ? 'font-mono break-all text-text' : 'text-text'}>{v}</div>
    </div>
  );
}

function buildAddressLabels(project: Project): Map<string, string> {
  const m = new Map<string, string>();
  for (const prog of Object.values(project.programs)) {
    if (prog.label) m.set(prog.programId, prog.label);
    for (const acc of prog.accounts ?? []) {
      if (acc.label) m.set(acc.address, acc.label);
    }
  }
  // SPL/system builtins
  const builtins: Record<string, string> = {
    '11111111111111111111111111111111': 'system',
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'spl-token',
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'token-2022',
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'associated-token',
    SysvarRent111111111111111111111111111111111: 'sysvar-rent',
    SysvarC1ock11111111111111111111111111111111: 'sysvar-clock',
  };
  for (const [k, v] of Object.entries(builtins)) if (!m.has(k)) m.set(k, v);
  return m;
}

function base64ToHex(b64: string): string {
  try {
    const bin = atob(b64);
    let hex = '';
    for (let i = 0; i < bin.length; i += 1) {
      const h = bin.charCodeAt(i).toString(16).padStart(2, '0');
      hex += h;
    }
    return hex;
  } catch {
    return '';
  }
}
