import { CloudDownload, FileUp, FolderOpen, Hash } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import {
  Button,
  ErrorState,
  Field,
  Input,
  Pubkey,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../ui';

type SourceKind = 'rpc' | 'file' | 'blob';

export interface AddProgramVersionFormProps {
  projectId: string;
  programId: string;
  onDone: () => void;
}

export function AddProgramVersionForm({
  projectId,
  programId,
  onDone,
}: AddProgramVersionFormProps): JSX.Element {
  const [kind, setKind] = useState<SourceKind>('rpc');
  const [label, setLabel] = useState('');
  const [slot, setSlot] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [blobHash, setBlobHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!label.trim()) {
      setErr('Label required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const params: Record<string, unknown> = {
        projectId,
        programId,
        label: label.trim(),
      };
      if (kind === 'rpc') {
        params.fromRpc = {
          ...(slot.trim() && { slot: slot.trim() }),
          ...(rpcUrl.trim() && { rpcUrl: rpcUrl.trim() }),
        };
      } else if (kind === 'file') {
        if (!filePath.trim()) throw new Error('File path required');
        params.fromFile = { path: filePath.trim() };
      } else {
        if (!blobHash.trim()) throw new Error('Blob hash required');
        params.fromBlob = { hash: blobHash.trim() };
      }
      await api.call('program.versionAdd', params);
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-[480px]">
      <div>
        <h3 className="m-0 text-md font-semibold">Add program version</h3>
        <div className="mt-1 text-xs text-text-muted inline-flex items-center gap-1">
          under <Pubkey value={programId} noCopy className="text-text" />
        </div>
      </div>

      {err && <ErrorState title="Failed to add version" message={err} />}

      <Field label="Label" required help="Friendly name shown in version chip / menu.">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="v2 / before-audit / anchor-29"
          autoFocus
        />
      </Field>

      <Field label="Source">
        <Tabs value={kind} onValueChange={(v) => setKind(v as SourceKind)}>
          <TabsList>
            <TabsTrigger value="rpc">
              <CloudDownload size={11} aria-hidden /> Clone from RPC
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp size={11} aria-hidden /> Local .so
            </TabsTrigger>
            <TabsTrigger value="blob">
              <Hash size={11} aria-hidden /> Existing blob
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Field>

      {kind === 'rpc' && (
        <>
          <Field label="Slot" help="Optional — pin to specific historic slot. Blank = latest.">
            <Input
              value={slot}
              onChange={(e) => setSlot(e.target.value.replace(/\D/g, ''))}
              placeholder="425454825"
              className="font-mono"
            />
          </Field>
          <Field label="RPC URL override" help="Optional — defaults to project RPC.">
            <Input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </>
      )}

      {kind === 'file' && (
        <Field label=".so file" required>
          <div className="flex items-center gap-2">
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="/Users/you/project/target/deploy/program.so"
              className="font-mono"
            />
            <Button
              variant="outline"
              size="md"
              onClick={async () => {
                try {
                  const r = await api.call<{ canceled: boolean; path?: string }>(
                    'app.dialog.openFile',
                    {
                      title: 'Pick a .so file',
                      filters: [{ name: 'Solana program ELF', extensions: ['so'] }],
                    },
                  );
                  if (!r.canceled && r.path) setFilePath(r.path);
                } catch {
                  /* user can paste manually */
                }
              }}
            >
              <FolderOpen size={12} aria-hidden /> Browse…
            </Button>
          </div>
        </Field>
      )}

      {kind === 'blob' && (
        <Field label="Blob hash" required help="sha256 hex of an ELF already in .reley/blobs/.">
          <Input
            value={blobHash}
            onChange={(e) => setBlobHash(e.target.value.trim())}
            placeholder="e3b0c44298fc…"
            className="font-mono"
          />
        </Field>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? (
            <>
              <Spinner size={12} /> Adding…
            </>
          ) : (
            'Add version'
          )}
        </Button>
      </div>
    </div>
  );
}

