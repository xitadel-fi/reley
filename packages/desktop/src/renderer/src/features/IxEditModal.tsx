import { Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '../ui';
import type { Project } from '../types';
import type { InspectableIx } from './IxInspectModal';

interface IdlInstruction {
  name: string;
  docs: string[] | null;
  args: Array<{ name: string; type: unknown }>;
  accounts: Array<{
    name: string;
    isWritable: boolean;
    isSigner: boolean;
    optional: boolean;
  }>;
}

interface InstructionsList {
  hasIdl: boolean;
  source?: 'anchor' | 'native' | 'none';
  instructions: IdlInstruction[];
}

interface DecodedArgs {
  source: 'anchor' | 'native' | 'none';
  name: string | null;
  args: Record<string, unknown> | null;
  accountNames: string[];
}

/**
 * Inline ix editor. Decodes current ix via IDL/native, renders editable arg +
 * account rows, re-encodes on save. Use anywhere an ix payload (programId +
 * name + accounts + dataBase64) needs in-place mutation without going through
 * a saved tx-template.
 */
export function IxEditButton({
  ix,
  project,
  onSave,
}: {
  ix: InspectableIx;
  project: Project;
  onSave: (updated: InspectableIx) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit instruction args + accounts"
        className="inline-flex items-center gap-1 text-2xs text-text-muted hover:text-text px-1.5 py-0.5 rounded hover:bg-surface-1 transition-colors"
      >
        <Pencil size={11} aria-hidden /> edit
      </button>
      {open && (
        <IxEditModal
          ix={ix}
          project={project}
          onSave={(u) => {
            onSave(u);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function IxEditModal({
  ix,
  project,
  onSave,
  onClose,
}: {
  ix: InspectableIx;
  project: Project;
  onSave: (updated: InspectableIx) => void;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<IdlInstruction | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedArgs | null>(null);
  const [decodeErr, setDecodeErr] = useState<string | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [accountAddrs, setAccountAddrs] = useState<string[]>(ix.accounts.map((a) => a.pubkey));
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<InstructionsList>('program.listInstructions', { programId: ix.programId })
      .then((res) => {
        const found = res.instructions.find((i) => i.name === ix.instructionName);
        if (!found) {
          setMetaErr(`instruction "${ix.instructionName}" not found in IDL for ${ix.programId}`);
          return;
        }
        setMeta(found);
      })
      .catch((e) => setMetaErr(String(e)));
    void api
      .call<DecodedArgs>('tx.decodeIx', { programId: ix.programId, dataBase64: ix.dataBase64 })
      .then(setDecoded)
      .catch((e) => setDecodeErr(String(e)));
  }, [ix.programId, ix.instructionName, ix.dataBase64]);

  // Seed initial arg JSON strings from decoded values.
  useEffect(() => {
    if (!decoded?.args || !meta) return;
    const init: Record<string, string> = {};
    for (const a of meta.args) {
      const v = decoded.args[a.name];
      init[a.name] = v === undefined || v === null ? '' : JSON.stringify(v);
    }
    setArgValues(init);
  }, [decoded, meta]);

  const labels = useMemo(() => buildAddressLabels(project), [project]);

  const save = async () => {
    if (!meta) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const args: Record<string, unknown> = {};
      for (const a of meta.args) {
        const raw = (argValues[a.name] ?? '').trim();
        if (raw === '') {
          args[a.name] = null;
          continue;
        }
        try {
          args[a.name] = JSON.parse(raw);
        } catch {
          args[a.name] = raw;
        }
      }
      const enc = await api.call<{ dataBase64: string }>('tx.encodeIx', {
        programId: ix.programId,
        name: ix.instructionName,
        args,
      });
      const updatedAccounts = ix.accounts.map((acc, i) => ({
        ...acc,
        pubkey: (accountAddrs[i] ?? acc.pubkey).trim(),
      }));
      const argPreview = meta.args
        .map((a) => `${a.name}=${argValues[a.name] ?? '∅'}`)
        .join(', ');
      onSave({
        ...ix,
        accounts: updatedAccounts,
        dataBase64: enc.dataBase64,
        summary: argPreview || ix.summary,
      });
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="!max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit instruction</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 max-h-[70vh] overflow-auto -mx-1 px-1">
          <div className="text-2xs text-text-muted">
            <span className="font-mono text-accent">{ix.instructionName}</span> on{' '}
            <span className="font-mono text-text">{ix.programLabel || ix.programId}</span>
          </div>

          {metaErr && <div className="text-2xs text-danger font-mono">{metaErr}</div>}
          {decodeErr && <div className="text-2xs text-danger font-mono">{decodeErr}</div>}

          {meta && meta.args.length > 0 && (
            <Section title="Args">
              <div className="flex flex-col gap-2">
                {meta.args.map((arg) => (
                  <div
                    key={arg.name}
                    className="grid grid-cols-[160px_1fr] items-center gap-2"
                  >
                    <div className="text-xs text-text-muted truncate">
                      {arg.name}
                      <div className="text-2xs text-text-subtle font-mono">
                        {typeof arg.type === 'string' ? arg.type : JSON.stringify(arg.type)}
                      </div>
                    </div>
                    <Input
                      value={argValues[arg.name] ?? ''}
                      onChange={(e) =>
                        setArgValues((p) => ({ ...p, [arg.name]: e.target.value }))
                      }
                      placeholder='JSON (e.g. "1000000000", 42, true, "PubKey…")'
                      className="font-mono"
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {meta && meta.args.length === 0 && (
            <Section title="Args">
              <div className="text-2xs text-text-subtle italic">no args</div>
            </Section>
          )}

          <Section title={`Accounts (${ix.accounts.length})`}>
            <div className="flex flex-col gap-2">
              {ix.accounts.map((acc, i) => {
                const role = meta?.accounts?.[i]?.name ?? decoded?.accountNames?.[i] ?? null;
                const tag = labels.get(accountAddrs[i] ?? acc.pubkey);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[36px_140px_1fr_auto] items-center gap-2"
                  >
                    <span className="font-mono text-2xs text-text-subtle text-right pr-1">
                      #{i}
                    </span>
                    <div className="text-xs text-text-muted truncate" title={role ?? ''}>
                      {role ? (
                        <span className="font-mono text-accent">{role}</span>
                      ) : (
                        <span className="text-text-subtle italic">—</span>
                      )}
                    </div>
                    <Input
                      value={accountAddrs[i] ?? ''}
                      onChange={(e) =>
                        setAccountAddrs((p) => {
                          const n = [...p];
                          n[i] = e.target.value;
                          return n;
                        })
                      }
                      placeholder="base58 pubkey"
                      className="font-mono text-2xs"
                    />
                    <div className="flex items-center gap-1">
                      {acc.isSigner && (
                        <Badge size="sm" variant="accent">
                          signer
                        </Badge>
                      )}
                      {acc.isWritable && (
                        <Badge size="sm" variant="warning">
                          writable
                        </Badge>
                      )}
                      {tag && <span className="text-2xs text-accent ml-1">{tag}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {saveErr && <div className="text-2xs text-danger font-mono">{saveErr}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X size={12} aria-hidden /> Cancel
          </Button>
          <Button onClick={save} disabled={!meta || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-0 p-2.5">
      <div className="text-2xs uppercase tracking-wider text-text-subtle mb-1.5">{title}</div>
      {children}
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
  return m;
}
