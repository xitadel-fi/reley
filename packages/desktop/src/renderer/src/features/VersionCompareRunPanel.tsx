import { ArrowRight, GitCompare, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Pubkey,
  Select,
  Spinner,
} from '../ui';
import type { Project } from '../types';
import { TxResultView, type TxSendResult } from './TxResultView';

interface TxTemplate {
  id: string;
  name: string;
  ixs: Array<{
    programId: string;
    programLabel: string;
    instructionName: string;
    summary: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    dataBase64: string;
  }>;
  computeUnitLimit: number | null;
  airdropLamports: string | null;
}

interface CompareResult {
  left: TxSendResult;
  right: TxSendResult;
  summary: {
    successMatch: boolean;
    returnDataMatch: boolean;
    cuLeft: string;
    cuRight: string;
    cuDelta: string;
  };
}

export interface VersionCompareRunPanelProps {
  project: Project;
  activeSessionId: string | null;
  initialProgramId?: string;
  onClose: () => void;
}

export function VersionCompareRunPanel({
  project,
  activeSessionId,
  initialProgramId,
  onClose,
}: VersionCompareRunPanelProps): JSX.Element {
  const multiVersionPrograms = useMemo(
    () =>
      Object.values(project.programs).filter(
        (p) => Array.isArray(p.versions) && p.versions.length >= 2,
      ),
    [project.programs],
  );

  const [programId, setProgramId] = useState<string>(
    initialProgramId && project.programs[initialProgramId] ? initialProgramId : '',
  );
  const program = programId ? project.programs[programId] : null;
  const versions = program?.versions ?? [];

  const [leftVersionId, setLeftVersionId] = useState<string>('');
  const [rightVersionId, setRightVersionId] = useState<string>('');
  const [templates, setTemplates] = useState<TxTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api
      .call<TxTemplate[]>('tx.templateList', { projectId: project.id })
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [project.id]);

  useEffect(() => {
    if (!program) return;
    if (!leftVersionId && versions[0]) setLeftVersionId(versions[0].id);
    if (!rightVersionId && versions[1]) setRightVersionId(versions[1].id);
  }, [program, versions, leftVersionId, rightVersionId]);

  const tpl = templates.find((t) => t.id === templateId);

  const run = async (): Promise<void> => {
    if (!activeSessionId) {
      setErr('Pick a sandbox in the sidebar first.');
      return;
    }
    if (!programId || !leftVersionId || !rightVersionId) {
      setErr('Pick a program and both versions.');
      return;
    }
    if (leftVersionId === rightVersionId) {
      setErr('Left and right versions must differ.');
      return;
    }
    if (!tpl) {
      setErr('Pick a template.');
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.call<CompareResult>('tx.compareVersions', {
        sessionId: activeSessionId,
        programId,
        leftVersionId,
        rightVersionId,
        build: {
          payer: 'AUTO',
          ixs: tpl.ixs.map((ix) => ({
            programId: ix.programId,
            accounts: ix.accounts,
            dataBase64: ix.dataBase64,
          })),
          signers: [{ pubkey: 'AUTO', secretKey: 'AUTO' }],
          airdropPayer: tpl.airdropLamports ?? '10000000000',
          ...(tpl.computeUnitLimit !== null && { computeUnitLimit: tpl.computeUnitLimit }),
        },
      });
      setResult(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const leftLabel = versions.find((v) => v.id === leftVersionId)?.label ?? 'left';
  const rightLabel = versions.find((v) => v.id === rightVersionId)?.label ?? 'right';

  return (
    <div className="flex flex-col gap-4 min-w-[860px] max-w-[1100px]">
      <header>
        <h3 className="m-0 text-md font-semibold inline-flex items-center gap-2">
          <GitCompare size={14} className="text-text-muted" aria-hidden /> Compare run across
          program versions
        </h3>
        <div className="mt-1 text-xs text-text-muted">
          Runs the same template against the active sandbox twice — once with{' '}
          <em>left</em> version pinned, once with <em>right</em>. Original sandbox pin is
          restored after.
        </div>
      </header>

      {err && <ErrorState title="Compare failed" message={err} />}

      {multiVersionPrograms.length === 0 ? (
        <Empty
          size="sm"
          title="No multi-version programs"
          description="Add a second version to a program first."
        />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
            <Field label="Program">
              <Select
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setLeftVersionId('');
                  setRightVersionId('');
                  setResult(null);
                }}
              >
                <option value="">— pick —</option>
                {multiVersionPrograms.map((p) => (
                  <option key={p.programId} value={p.programId}>
                    {p.label} · {p.programId.slice(0, 6)}…{p.programId.slice(-4)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Left version">
              <Select
                value={leftVersionId}
                onChange={(e) => {
                  setLeftVersionId(e.target.value);
                  setResult(null);
                }}
                disabled={!program}
              >
                <option value="">— pick —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Right version">
              <Select
                value={rightVersionId}
                onChange={(e) => {
                  setRightVersionId(e.target.value);
                  setResult(null);
                }}
                disabled={!program}
              >
                <option value="">— pick —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              size="md"
              disabled={
                busy || !programId || !leftVersionId || !rightVersionId || !templateId
              }
              onClick={() => void run()}
            >
              {busy ? <Spinner size={12} /> : <Play size={12} aria-hidden />} Run
            </Button>
          </div>

          <Field label="Template">
            <Select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setResult(null);
              }}
              disabled={templates.length === 0}
            >
              <option value="">— pick a tx template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.ixs.length} ix)
                </option>
              ))}
            </Select>
          </Field>

          {!activeSessionId && (
            <div className="text-2xs text-warning">No sandbox — pick one in the sidebar.</div>
          )}
        </>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border bg-surface-0 p-3 flex items-center gap-3 flex-wrap text-xs">
            <span className="text-text-muted">
              <Pubkey value={leftLabel} noCopy className="text-text" />
              <ArrowRight size={11} className="inline mx-1" />
              <Pubkey value={rightLabel} noCopy className="text-text" />
            </span>
            <span className="text-text-subtle">·</span>
            <Badge size="sm" variant={result.summary.successMatch ? 'success' : 'danger'}>
              {result.summary.successMatch ? 'status match' : 'status diff'}
            </Badge>
            <Badge size="sm" variant={result.summary.returnDataMatch ? 'success' : 'warning'}>
              {result.summary.returnDataMatch ? 'return data match' : 'return data diff'}
            </Badge>
            <Badge
              size="sm"
              variant={result.summary.cuDelta === '0' ? 'default' : 'warning'}
              className="font-mono"
            >
              cu Δ {result.summary.cuDelta}
            </Badge>
            <span className="text-text-subtle font-mono">
              {result.summary.cuLeft} → {result.summary.cuRight}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-2xs uppercase tracking-wider text-text-subtle font-semibold mb-1">
                Left · {leftLabel}
              </div>
              <TxResultView result={result.left} />
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wider text-text-subtle font-semibold mb-1">
                Right · {rightLabel}
              </div>
              <TxResultView result={result.right} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end pt-1">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
