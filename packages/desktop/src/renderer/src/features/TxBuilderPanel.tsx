import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Info,
  Pencil,
  Play,
  Save,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useDialogs } from '../components/Dialogs';
import { HelpHint } from '../components/HelpHint';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import type { Project } from '../types';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../ui';
import { DeriveAddressForm } from './DeriveAddressForm';
import {
  runDiagnostics,
  type DiagIx,
  type Issue,
  type Severity,
} from './tx-diagnostics';
import { TxResultView, type TxSendResult } from './TxResultView';

interface KeypairMeta {
  id: string;
  label: string;
  pubkey: string;
  sealed: boolean;
}

interface IxAccountInput {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface PendingIx {
  id: number;
  programId: string;
  programLabel: string;
  instructionName: string;
  /** Single-line preview. */
  summary: string;
  accounts: IxAccountInput[];
  dataBase64: string;
}

interface TxTemplate {
  id: string;
  name: string;
  description: string;
  ixs: Array<{
    programId: string;
    programLabel: string;
    instructionName: string;
    summary: string;
    accounts: IxAccountInput[];
    dataBase64: string;
  }>;
  computeUnitLimit: number | null;
  airdropLamports: string | null;
  createdAt: number;
  updatedAt: number;
}

interface IdlInstruction {
  name: string;
  docs: string[] | null;
  args: Array<{ name: string; type: unknown }>;
  accounts: Array<{
    name: string;
    isWritable: boolean;
    isSigner: boolean;
    optional: boolean;
    docs: string[] | null;
  }>;
}

interface InstructionsList {
  hasIdl: boolean;
  source?: 'anchor' | 'native' | 'none';
  idlName?: string;
  instructions: IdlInstruction[];
}

// Well-known account roles → pubkey. Used by the Tx Builder "Auto-fill"
// button to populate accounts whose IDL name matches a known role. Names
// are lowercased + snake-collapsed before matching.
const ROLE_TO_PUBKEY: Record<string, string> = {
  system_program: '11111111111111111111111111111111',
  systemprogram: '11111111111111111111111111111111',
  system: '11111111111111111111111111111111',
  token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  tokenprogram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  spl_token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token_2022_program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  token2022program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  associated_token_program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  associatedtokenprogram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ata_program: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  rent: 'SysvarRent111111111111111111111111111111111',
  rent_sysvar: 'SysvarRent111111111111111111111111111111111',
  clock: 'SysvarC1ock11111111111111111111111111111111',
  clock_sysvar: 'SysvarC1ock11111111111111111111111111111111',
  instructions_sysvar: 'Sysvar1nstructions1111111111111111111111111',
  ix_sysvar: 'Sysvar1nstructions1111111111111111111111111',
  compute_budget_program: 'ComputeBudget111111111111111111111111111111',
};

const PAYER_ROLES = new Set([
  'payer',
  'fee_payer',
  'feepayer',
  'funder',
  'authority',
  'signer',
  'owner',
  'user',
  'wallet',
]);

function normalizeRole(name: string): string {
  return name
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    .replace(/^_/, '')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function autofillAccounts(
  prev: Record<string, string>,
  ix: IdlInstruction,
  keypairs: Array<{ id: string; label: string; pubkey: string }>,
  payerId: string | null,
): Record<string, string> {
  const next = { ...prev };
  const payerPubkey =
    keypairs.find((k) => k.id === payerId)?.pubkey ??
    keypairs.find((k) => k.label === 'default-payer')?.pubkey ??
    keypairs[0]?.pubkey ??
    null;
  for (const acc of ix.accounts) {
    if ((next[acc.name] ?? '').trim()) continue; // don't overwrite user input
    const role = normalizeRole(acc.name);
    if (ROLE_TO_PUBKEY[role]) {
      next[acc.name] = ROLE_TO_PUBKEY[role];
      continue;
    }
    if (PAYER_ROLES.has(role) && payerPubkey) {
      next[acc.name] = payerPubkey;
      continue;
    }
  }
  return next;
}

type Mode = 'instruction' | 'raw';

export function TxBuilderPanel({
  project,
  activeSessionId,
  pendingTemplateId,
  onTemplateConsumed,
  onOpenHelp,
}: {
  project: Project;
  activeSessionId: string | null;
  /** When set, builder boots loaded with this template id (or blank on null). undefined = no-op. */
  pendingTemplateId?: string | null | undefined;
  onTemplateConsumed?: () => void;
  onOpenHelp?: (skillId: string) => void;
}): JSX.Element {
  const [programId, setProgramId] = useState<string>('');
  const [mode, setMode] = useState<Mode>('instruction');
  const [instructions, setInstructions] = useState<InstructionsList>({ hasIdl: false, instructions: [] });
  const [selectedIx, setSelectedIx] = useState<IdlInstruction | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [namedAccounts, setNamedAccounts] = useState<Record<string, string>>({});
  const [dataHex, setDataHex] = useState('');
  const [accounts, setAccounts] = useState<IxAccountInput[]>([]);
  const [keypairs, setKeypairs] = useState<KeypairMeta[]>([]);
  const [payerId, setPayerId] = useState<string>('');
  const [extraSignerIds, setExtraSignerIds] = useState<string[]>([]);
  const [cuLimit, setCuLimit] = useState('');
  const [airdrop, setAirdrop] = useState('10000000000');
  const [drafts, setDrafts] = useState<PendingIx[]>([]);
  const [result, setResult] = useState<TxSendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<TxTemplate[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);
  const [deriveOpen, setDeriveOpen] = useState<null | { onPick: (addr: string) => void }>(null);
  const toast = useToast();
  const dialogs = useDialogs();
  /** Skip the next programId-change auto-reset (we're loading from a draft and will set state ourselves). */
  const editingFromDraftRef = useRef(false);
  let nextDraftId = drafts.length > 0 ? Math.max(...drafts.map((d) => d.id)) + 1 : 1;

  useEffect(() => {
    void api.call<KeypairMeta[]>('keypair.list').then((list) => {
      setKeypairs(list);
      if (list.length && !payerId) setPayerId(list[0]!.id);
    });
  }, []);

  const reloadTemplates = (): void => {
    void api
      .call<TxTemplate[]>('tx.templateList', { projectId: project.id })
      .then(setTemplates)
      .catch(() => setTemplates([]));
  };

  useEffect(() => {
    reloadTemplates();
  }, [project.id]);

  // Sync templates state whenever the prop's txTemplates list changes
  // (e.g. sidebar inline rename → reloadProject → new array reference).
  // Avoids stale dropdown labels.
  useEffect(() => {
    if (project.txTemplates) {
      setTemplates(project.txTemplates as unknown as TxTemplate[]);
    }
  }, [project.txTemplates]);

  const updateLoadedTemplate = async (): Promise<void> => {
    if (!loadedTemplateId) return;
    setErr(null);
    try {
      const ixs: PendingIx[] = [...drafts];
      if (programId) {
        try {
          ixs.push(await draftFromForm());
        } catch {
          /* ignore */
        }
      }
      if (ixs.length === 0) throw new Error('nothing to save');
      const current = templates.find((t) => t.id === loadedTemplateId);
      await api.call('tx.templateSave', {
        projectId: project.id,
        id: loadedTemplateId,
        name: current?.name ?? 'untitled',
        description: current?.description ?? '',
        ixs: ixs.map((d) => ({
          programId: d.programId,
          programLabel: d.programLabel,
          instructionName: d.instructionName,
          summary: d.summary,
          accounts: d.accounts,
          dataBase64: d.dataBase64,
        })),
        computeUnitLimit: cuLimit ? Number(cuLimit) : null,
        airdropLamports: airdrop || null,
      });
      reloadTemplates();
      toast.success(`updated "${current?.name ?? 'template'}"`);
    } catch (e) {
      setErr(String(e));
      toast.error(String(e));
    }
  };

  const saveTemplate = async (): Promise<void> => {
    setErr(null);
    try {
      const ixs: PendingIx[] = [...drafts];
      if (programId) {
        try {
          ixs.push(await draftFromForm());
        } catch {
          /* ignore form errors when saving */
        }
      }
      if (ixs.length === 0) throw new Error('nothing to save (build at least one instruction)');
      const name = await dialogs.prompt({
        title: 'Save template',
        label: 'Template name',
        placeholder: 'e.g. mint setup',
      });
      if (!name?.trim()) return;
      const saved = await api.call<{ id: string }>('tx.templateSave', {
        projectId: project.id,
        name: name.trim(),
        ixs: ixs.map((d) => ({
          programId: d.programId,
          programLabel: d.programLabel,
          instructionName: d.instructionName,
          summary: d.summary,
          accounts: d.accounts,
          dataBase64: d.dataBase64,
        })),
        computeUnitLimit: cuLimit ? Number(cuLimit) : null,
        airdropLamports: airdrop || null,
      });
      reloadTemplates();
      // After Save-as-new, link the builder to the new template so the user
      // is editing it going forward (same flow as if they had loaded it).
      if (saved?.id) setLoadedTemplateId(saved.id);
    } catch (e) {
      setErr(String(e));
    }
  };

  // Consume pendingTemplateId from parent. Null = clear to blank. String = load that template
  // (waits for `templates` list to populate so the lookup succeeds).
  useEffect(() => {
    if (pendingTemplateId === undefined) return;
    if (pendingTemplateId === null) {
      setDrafts([]);
      setCuLimit('');
      setAirdrop('10000000000');
      setProgramId('');
      setSelectedIx(null);
      setArgValues({});
      setNamedAccounts({});
      setDataHex('');
      setAccounts([]);
      setEditingDraftId(null);
      setLoadedTemplateId(null);
      onTemplateConsumed?.();
      return;
    }
    if (templates.some((t) => t.id === pendingTemplateId)) {
      loadTemplate(pendingTemplateId);
      onTemplateConsumed?.();
    }
    // If not loaded yet, the effect re-fires once `templates` arrives.
  }, [pendingTemplateId, templates]);

  const loadTemplate = (templateId: string): void => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setDrafts(
      tpl.ixs.map((ix, idx) => ({
        id: idx + 1,
        programId: ix.programId,
        programLabel: ix.programLabel,
        instructionName: ix.instructionName,
        summary: ix.summary,
        accounts: ix.accounts,
        dataBase64: ix.dataBase64,
      })),
    );
    if (tpl.computeUnitLimit !== null) setCuLimit(String(tpl.computeUnitLimit));
    if (tpl.airdropLamports !== null) setAirdrop(tpl.airdropLamports);
    setProgramId('');
    setSelectedIx(null);
    setArgValues({});
    setNamedAccounts({});
    setDataHex('');
    setAccounts([]);
    setEditingDraftId(null);
    setLoadedTemplateId(templateId);
  };

  const deleteTemplate = async (templateId: string): Promise<void> => {
    const ok = await dialogs.confirm({
      title: 'Delete template',
      message: 'Permanently remove this saved template?',
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    await api.call('tx.templateDelete', { projectId: project.id, id: templateId });
    reloadTemplates();
  };

  useEffect(() => {
    if (!programId) {
      setInstructions({ hasIdl: false, instructions: [] });
      setSelectedIx(null);
      return;
    }
    void api
      .call<InstructionsList>('program.listInstructions', { programId })
      .then((list) => {
        setInstructions(list);
        if (editingFromDraftRef.current) {
          // editDraft is driving — keep its mode + selectedIx.
          return;
        }
        if (list.instructions.length === 0) setMode('raw');
        else setMode('instruction');
        setSelectedIx(null);
      })
      .catch(() => {
        if (editingFromDraftRef.current) return;
        setInstructions({ hasIdl: false, instructions: [] });
        setMode('raw');
      });
  }, [programId]);

  // When instruction picked, init args + accounts — unless editDraft is driving
  // (which sets these explicitly from the decoded draft).
  useEffect(() => {
    if (!selectedIx) return;
    if (editingFromDraftRef.current) return;
    const initArgs: Record<string, string> = {};
    for (const a of selectedIx.args) initArgs[a.name] = '';
    setArgValues(initArgs);
    const initAccs: Record<string, string> = {};
    for (const a of selectedIx.accounts) initAccs[a.name] = '';
    setNamedAccounts(initAccs);
  }, [selectedIx]);

  // Hooks must run in the same order on every render — keep all useMemo /
  // useEffect calls ABOVE any early return.
  const diagnostics = useMemo<Issue[]>(() => {
    const ixs: DiagIx[] = drafts.map((d) => ({
      id: d.id,
      programId: d.programId,
      instructionName: d.instructionName,
      accounts: d.accounts.map((a) => ({
        pubkey: a.pubkey,
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
    }));
    const knownSigners = new Set(keypairs.map((k) => k.pubkey));
    const payerPubkey = keypairs.find((k) => k.id === payerId)?.pubkey ?? null;
    return runDiagnostics(ixs, { knownSignerPubkeys: knownSigners, payerPubkey });
  }, [drafts, keypairs, payerId]);

  if (!activeSessionId) {
    return (
      <Empty
        icon={<GitBranch size={20} aria-hidden />}
        title="No sandbox selected"
        description="Pick a sandbox in the sidebar to start building transactions."
      />
    );
  }

  const addAccount = (): void =>
    setAccounts((a) => [...a, { pubkey: '', isSigner: false, isWritable: false }]);
  const removeAccount = (i: number): void => setAccounts((a) => a.filter((_, idx) => idx !== i));
  const updateAccount = (i: number, patch: Partial<IxAccountInput>): void =>
    setAccounts((a) => a.map((acc, idx) => (idx === i ? { ...acc, ...patch } : acc)));

  const knownAccountSuggestions: Array<{ pubkey: string; label: string }> = [
    ...Object.values(project.programs).flatMap((p) =>
      p.accounts.map((a) => ({
        pubkey: a.address,
        label: a.label && a.label !== a.address ? `${a.label} (account)` : 'account',
      })),
    ),
    ...keypairs.map((k) => ({ pubkey: k.pubkey, label: `${k.label} (keypair)` })),
    ...Object.values(project.programs).map((p) => ({
      pubkey: p.programId,
      label: `${p.label} (program)`,
    })),
  ];

  const deriveSuggestions = knownAccountSuggestions;

  const hexToBase64 = (hex: string): string => {
    const clean = (hex.startsWith('0x') ? hex.slice(2) : hex).replace(/\s+/g, '');
    if (clean.length % 2 !== 0) throw new Error('hex needs even length');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
    }
    return btoa(String.fromCharCode(...bytes));
  };

  /**
   * Resolve the current form into a PendingIx (without mutating state).
   * Throws if form is incomplete.
   */
  const draftFromForm = async (): Promise<PendingIx> => {
    if (!programId) throw new Error('program required');
    const programLabel =
      Object.values(project.programs).find((p) => p.programId === programId)?.label ?? programId;

    if (mode === 'instruction' && selectedIx) {
      const missing = selectedIx.accounts
        .filter((a) => !a.optional && !(namedAccounts[a.name] ?? '').trim())
        .map((a) => a.name);
      if (missing.length > 0) {
        throw new Error(`missing required account(s): ${missing.join(', ')}`);
      }
      const args: Record<string, unknown> = {};
      for (const a of selectedIx.args) {
        const raw = argValues[a.name] ?? '';
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
      const enc = await api.call<{ dataBase64: string; dataHex: string }>('tx.encodeIx', {
        programId,
        name: selectedIx.name,
        args,
      });
      const ixAccounts = selectedIx.accounts
        .filter((a) => !a.optional || (namedAccounts[a.name] ?? '').trim())
        .map((a) => ({
          pubkey: (namedAccounts[a.name] ?? '').trim(),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        }));
      const argPreview = selectedIx.args
        .map((a) => `${a.name}=${argValues[a.name] ?? '∅'}`)
        .join(', ');
      return {
        id: nextDraftId,
        programId,
        programLabel,
        instructionName: selectedIx.name,
        summary: argPreview || `${ixAccounts.length} accounts`,
        accounts: ixAccounts,
        dataBase64: enc.dataBase64,
      };
    }
    if (accounts.some((a) => !a.pubkey.trim())) {
      throw new Error('all account rows need a pubkey (or remove empty rows)');
    }
    const dataBase64 = hexToBase64(dataHex);
    return {
      id: nextDraftId,
      programId,
      programLabel,
      instructionName: 'raw',
      summary: `${dataHex.length} hex chars · ${accounts.length} accounts`,
      accounts: [...accounts],
      dataBase64,
    };
  };

  /**
   * Final list of instructions to send: drafts plus current form (if non-empty).
   */
  const collectInstructions = async (): Promise<PendingIx[]> => {
    const list: PendingIx[] = [...drafts];
    if (programId) {
      try {
        const current = await draftFromForm();
        list.push(current);
      } catch (e) {
        if (drafts.length === 0) throw e;
      }
    }
    if (list.length === 0) throw new Error('no instructions to send');
    return list;
  };

  const buildPayload = async (): Promise<{
    sessionId: string;
    build: Record<string, unknown>;
  }> => {
    const ixs = await collectInstructions();
    return {
      sessionId: activeSessionId!,
      build: {
        payer: 'AUTO',
        ixs: ixs.map((d) => ({
          programId: d.programId,
          accounts: d.accounts,
          dataBase64: d.dataBase64,
        })),
        signers: [{ pubkey: 'AUTO', secretKey: 'AUTO' }],
        airdropPayer: airdrop,
        ...(cuLimit && { computeUnitLimit: Number(cuLimit) }),
        ...(payerId && { payerKeypairId: payerId }),
        ...(extraSignerIds.length > 0 && { additionalSignerKeypairIds: extraSignerIds }),
      },
    };
  };

  const addToTx = async (position: 'prepend' | 'append' | 'replace'): Promise<void> => {
    setErr(null);
    try {
      const draft = await draftFromForm();
      if (editingDraftId !== null && position === 'replace') {
        // Replace the edited draft in place, keep its id and position
        setDrafts((prev) =>
          prev.map((d) => (d.id === editingDraftId ? { ...draft, id: editingDraftId } : d)),
        );
        setEditingDraftId(null);
      } else {
        setDrafts((prev) => (position === 'prepend' ? [draft, ...prev] : [...prev, draft]));
      }
      setProgramId('');
      setSelectedIx(null);
      setArgValues({});
      setNamedAccounts({});
      setDataHex('');
      setAccounts([]);
    } catch (e) {
      setErr(String(e));
    }
  };

  const cancelEdit = (): void => {
    setEditingDraftId(null);
    setProgramId('');
    setSelectedIx(null);
    setArgValues({});
    setNamedAccounts({});
    setDataHex('');
    setAccounts([]);
  };

  const removeDraft = (id: number): void =>
    setDrafts((prev) => prev.filter((d) => d.id !== id));

  /**
   * Pull a draft back into the form for editing. Drops it from the list; user
   * then re-Append / re-Prepend to restore. Tries to load args structurally
   * (when the instruction name matches a known IDL/native ix); otherwise falls
   * back to raw hex mode with the original bytes + accounts.
   */
  const editDraft = async (draftId: number): Promise<void> => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    setErr(null);
    setResult(null);

    editingFromDraftRef.current = true;
    setProgramId(draft.programId);

    let list: InstructionsList | null = null;
    try {
      list = await api.call<InstructionsList>('program.listInstructions', {
        programId: draft.programId,
      });
      setInstructions(list);
    } catch {
      list = null;
    }

    const matchedIx = list?.instructions.find((i) => i.name === draft.instructionName);
    if (matchedIx) {
      setMode('instruction');
      setSelectedIx(matchedIx);

      // Restore named accounts in IDL order
      const newNamed: Record<string, string> = {};
      matchedIx.accounts.forEach((acc, idx) => {
        newNamed[acc.name] = draft.accounts[idx]?.pubkey ?? '';
      });
      setNamedAccounts(newNamed);

      // Try to decode args back via Anchor IDL (if attached). Fallback: empty.
      const initArgs: Record<string, string> = {};
      for (const a of matchedIx.args) initArgs[a.name] = '';
      try {
        const decoded = await api.call<{
          source: 'anchor' | 'native' | 'none';
          name: string | null;
          args: Record<string, unknown> | null;
        }>('tx.decodeIx', { programId: draft.programId, dataBase64: draft.dataBase64 });
        if ((decoded.source === 'anchor' || decoded.source === 'native') && decoded.args) {
          for (const a of matchedIx.args) {
            if (a.name in decoded.args) {
              const v = decoded.args[a.name];
              initArgs[a.name] = JSON.stringify(v);
            }
          }
          toast.success(`Args restored from ${decoded.source} decode.`);
        } else {
          toast.info('Args not restorable — re-enter manually.');
        }
      } catch {
        toast.info('Could not decode args — re-enter manually.');
      }
      setArgValues(initArgs);
    } else {
      setMode('raw');
      setSelectedIx(null);
      const raw = atob(draft.dataBase64);
      const hex = Array.from(raw)
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
      setDataHex(hex);
      setAccounts(draft.accounts);
      toast.info('Loaded into raw mode — bytes + accounts preserved.');
    }

    // Mark which draft we're editing — keep it in the list so position is preserved
    setEditingDraftId(draftId);
    setTimeout(() => {
      editingFromDraftRef.current = false;
    }, 100);
  };

  const moveDraft = (id: number, dir: -1 | 1): void =>
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next;
    });

  const simulate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const payload = await buildPayload();
      const r = await api.call<TxSendResult>('tx.simulate', payload);
      setResult({ ...r, simulated: true });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const payload = await buildPayload();
      const r = await api.call<TxSendResult>('tx.send', payload);
      setResult(r);
      // Newbie cue: after a successful send, hint at saving as template
      // (only when it wasn't already loaded from one). Click the "Save…"
      // button in the Templates section above.
      if (r.success && !loadedTemplateId) {
        toast.info('Tx sent — tip: save as template above to reuse');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalIxCount = drafts.length + (programId ? 1 : 0);
  const blockingErrors = diagnostics.some((d) => d.severity === 'error');

  const loadedTemplateName = loadedTemplateId
    ? templates.find((t) => t.id === loadedTemplateId)?.name
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Compact template status row — full library lives in the left
          sidebar. Builder only needs: which template is loaded + the
          actions to save/update/unlink it. */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        {loadedTemplateId ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Save size={11} className="text-accent" aria-hidden />
              Editing template{' '}
              <span className="font-medium text-text">{loadedTemplateName ?? '(unnamed)'}</span>
            </span>
            <Button
              variant="primary"
              size="xs"
              onClick={() => void updateLoadedTemplate()}
              title="Overwrite the loaded template with current drafts"
            >
              <Save size={11} aria-hidden /> Update
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={saveTemplate}
              title="Fork the current drafts into a brand-new template"
            >
              Save as new template…
            </Button>
          </>
        ) : (
          <>
            <span className="text-text-subtle">
              Tip: pick a template from the sidebar, or save your current draft below.
            </span>
            <Button variant="outline" size="xs" onClick={saveTemplate}>
              Save as new template…
            </Button>
          </>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="panel">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="m-0">
              Pending instructions <span className="text-text-muted">({drafts.length})</span>
            </h2>
            <span className="text-2xs text-text-subtle">
              Reorder with ↑↓ · current form executes at chosen position
            </span>
          </div>

          <ul className="flex flex-col rounded-md border border-border overflow-hidden">
            {drafts.map((d, idx) => {
              const isEditing = editingDraftId === d.id;
              const ixIssues = diagnostics.filter((iss) => iss.ixIndex === idx);
              const worstSeverity: Severity | null = ixIssues.length
                ? ixIssues.some((i) => i.severity === 'error')
                  ? 'error'
                  : ixIssues.some((i) => i.severity === 'warning')
                    ? 'warning'
                    : 'info'
                : null;
              return (
                <li
                  key={d.id}
                  className={[
                    'flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0',
                    isEditing ? 'bg-accent/10' : 'hover:bg-surface-1/40',
                  ].join(' ')}
                >
                  <Badge size="sm" variant={isEditing ? 'accent' : 'default'} className="font-mono">
                    #{idx + 1}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-accent font-medium truncate">
                        {d.instructionName}
                      </span>
                      <span className="text-2xs text-text-subtle">on</span>
                      <span className="text-xs text-text truncate">{d.programLabel}</span>
                      {worstSeverity === 'error' && (
                        <span
                          className="inline-flex items-center text-danger"
                          title="This instruction has blocking issues"
                          aria-label="error"
                        >
                          <AlertCircle size={11} />
                        </span>
                      )}
                      {worstSeverity === 'warning' && (
                        <span
                          className="inline-flex items-center text-warning"
                          title="This instruction has warnings"
                          aria-label="warning"
                        >
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-2xs text-text-subtle truncate mt-0.5">
                      {d.summary}
                    </div>
                  </div>
                  <IconButton
                    icon={<ChevronUp size={12} />}
                    label="Move up"
                    size="sm"
                    variant="ghost"
                    disabled={idx === 0}
                    onClick={() => moveDraft(d.id, -1)}
                  />
                  <IconButton
                    icon={<ChevronDown size={12} />}
                    label="Move down"
                    size="sm"
                    variant="ghost"
                    disabled={idx === drafts.length - 1}
                    onClick={() => moveDraft(d.id, 1)}
                  />
                  <IconButton
                    icon={<Pencil size={12} />}
                    label="Edit this instruction"
                    size="sm"
                    variant="ghost"
                    onClick={() => void editDraft(d.id)}
                  />
                  <IconButton
                    icon={<X size={12} />}
                    label="Remove"
                    size="sm"
                    variant="danger"
                    onClick={() => removeDraft(d.id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ───── Build instruction ───── */}
      <div className="panel">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="m-0">
            {editingDraftId !== null
              ? `Editing instruction #${drafts.findIndex((d) => d.id === editingDraftId) + 1}`
              : 'Build instruction'}
          </h2>
          <span className="text-2xs text-text-subtle font-mono">
            session {activeSessionId.slice(0, 8)}
          </span>
        </div>

        {err && (
          <div className="mb-3">
            <ErrorState title="Build failed" message={err} />
          </div>
        )}

        <Field label="Program">
          <Select value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">— pick a program —</option>
            {Object.values(project.programs).map((p) => (
              <option key={p.programId} value={p.programId}>
                {p.label} · {p.programId.slice(0, 8)}…
              </option>
            ))}
          </Select>
        </Field>

        {programId && (
          <div className="mt-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList>
                <TabsTrigger
                  value="instruction"
                  disabled={instructions.instructions.length === 0}
                >
                  Instruction{' '}
                  {instructions.instructions.length > 0 && (
                    <span className="ml-1 text-2xs text-text-subtle">
                      ({instructions.instructions.length} via {instructions.source})
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="raw" title="Send pre-encoded instruction bytes. Advanced.">
                  Raw bytes
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {mode === 'instruction' && instructions.instructions.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Instruction">
              <Select
                value={selectedIx?.name ?? ''}
                onChange={(e) => {
                  const ix = instructions.instructions.find((i) => i.name === e.target.value);
                  setSelectedIx(ix ?? null);
                }}
              >
                <option value="">— pick an instruction —</option>
                {instructions.instructions.map((ix) => (
                  <option key={ix.name} value={ix.name}>
                    {ix.name}
                    {ix.args.length > 0 ? ` (${ix.args.length} args)` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            {selectedIx && (
              <>
                {selectedIx.docs && selectedIx.docs.length > 0 && (
                  <div className="rounded bg-surface-0 border border-border px-3 py-2 text-xs text-text-muted whitespace-pre-wrap">
                    {selectedIx.docs.join('\n')}
                  </div>
                )}

                {selectedIx.args.length > 0 && (
                  <div>
                    <div className="text-2xs uppercase tracking-wider text-text-subtle font-medium mb-2">
                      Args
                    </div>
                    <div className="flex flex-col gap-2">
                      {selectedIx.args.map((arg) => (
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
                            placeholder={'JSON value (e.g. 42, "foo", true)'}
                            className="font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-2xs uppercase tracking-wider text-text-subtle font-medium">
                      Accounts
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setNamedAccounts((prev) =>
                          autofillAccounts(prev, selectedIx, keypairs, payerId),
                        )
                      }
                      title="Fill known account roles (system/token/ATA/payer) from project keypairs + SVM builtins."
                    >
                      <Sparkles size={11} aria-hidden /> Auto-fill
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {selectedIx.accounts.map((acc, idx) => (
                      <div
                        key={acc.name}
                        className="grid grid-cols-[36px_160px_1fr_auto] items-center gap-2"
                      >
                        <span
                          className="font-mono text-2xs text-text-subtle text-right pr-1"
                          title={`Account index ${idx}`}
                        >
                          #{idx}
                        </span>
                        <div className="text-xs text-text-muted truncate">
                          {acc.name}
                          <div className="mt-0.5 flex gap-1 flex-wrap">
                            {acc.isSigner && (
                              <Badge size="sm" variant="warning">
                                signer
                              </Badge>
                            )}
                            {acc.isWritable && (
                              <Badge size="sm" variant="accent">
                                mut
                              </Badge>
                            )}
                            {acc.optional && (
                              <Badge size="sm" variant="outline">
                                opt
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Input
                          value={namedAccounts[acc.name] ?? ''}
                          onChange={(e) =>
                            setNamedAccounts((p) => ({ ...p, [acc.name]: e.target.value }))
                          }
                          placeholder="base58 pubkey"
                          className="font-mono"
                          list={`acc-suggestions-${acc.name}`}
                        />
                        <IconButton
                          icon={<Zap size={13} />}
                          label="Derive ATA or PDA"
                          size="md"
                          variant="ghost"
                          onClick={() =>
                            setDeriveOpen({
                              onPick: (addr) =>
                                setNamedAccounts((p) => ({ ...p, [acc.name]: addr })),
                            })
                          }
                        />
                        <datalist id={`acc-suggestions-${acc.name}`}>
                          {knownAccountSuggestions.map((s) => (
                            <option key={s.pubkey} value={s.pubkey}>
                              {s.label}
                            </option>
                          ))}
                        </datalist>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'raw' && (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Instruction data (hex)">
              <Input
                value={dataHex}
                onChange={(e) => setDataHex(e.target.value)}
                placeholder="68656c6c6f"
                className="font-mono"
              />
            </Field>
            <div>
              <div className="text-2xs uppercase tracking-wider text-text-subtle font-medium mb-2">
                Accounts
              </div>
              <div className="flex flex-col gap-2">
                {accounts.map((a, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[28px_1fr_auto_auto_auto_auto] items-center gap-2"
                  >
                    <span
                      className="font-mono text-2xs text-text-subtle text-right pr-1"
                      title={`Account index ${i}`}
                    >
                      #{i}
                    </span>
                    <Input
                      value={a.pubkey}
                      onChange={(e) => updateAccount(i, { pubkey: e.target.value })}
                      placeholder="base58 pubkey"
                      className="font-mono"
                      list={`raw-acc-${i}`}
                    />
                    <IconButton
                      icon={<Zap size={13} />}
                      label="Derive ATA or PDA"
                      size="md"
                      variant="ghost"
                      onClick={() =>
                        setDeriveOpen({
                          onPick: (addr) => updateAccount(i, { pubkey: addr }),
                        })
                      }
                    />
                    <label className="inline-flex items-center gap-1 text-2xs text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={a.isSigner}
                        onChange={(e) => updateAccount(i, { isSigner: e.target.checked })}
                      />
                      signer
                    </label>
                    <label className="inline-flex items-center gap-1 text-2xs text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={a.isWritable}
                        onChange={(e) => updateAccount(i, { isWritable: e.target.checked })}
                      />
                      writable
                    </label>
                    <IconButton
                      icon={<X size={12} />}
                      label="Remove"
                      size="sm"
                      variant="danger"
                      onClick={() => removeAccount(i)}
                    />
                    <datalist id={`raw-acc-${i}`}>
                      {knownAccountSuggestions.map((s) => (
                        <option key={s.pubkey} value={s.pubkey}>
                          {s.label}
                        </option>
                      ))}
                    </datalist>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addAccount} className="mt-2">
                + Add account
              </Button>
            </div>
          </div>
        )}

        {/* Signing & budget — collapsed by default for newbie clarity. Most
            txs work fine with ephemeral payer + default CU. Power users open
            this to override payer, add multi-sig, or bump compute limit. */}
        <details className="mt-5 pt-4 border-t border-border builder-advanced">
          <summary className="builder-advanced-summary">
            <span className="text-2xs uppercase tracking-wider text-text-subtle font-medium">
              Advanced · signing & budget
            </span>
            <span className="text-2xs text-text-subtle ml-auto">
              {payerId ? `payer: ${keypairs.find((k) => k.id === payerId)?.label ?? '?'}` : 'ephemeral payer'}
              {extraSignerIds.length > 0 ? ` · +${extraSignerIds.length} signer${extraSignerIds.length > 1 ? 's' : ''}` : ''}
              {cuLimit ? ` · CU ${cuLimit}` : ''}
            </span>
          </summary>

          <Field
            label={
              <>
                Pay fees with
                <HelpHint
                  label="Payer"
                  hint="Keypair that signs the tx and pays the fee. Ephemeral = auto-generated + airdropped, no setup needed."
                  skillId="reley-keypair"
                  onOpen={onOpenHelp}
                />
              </>
            }
            help={
              keypairs.length === 0
                ? 'No keypairs. Add one in the Keypairs panel.'
                : 'Sandbox-only signing. Ephemeral payer recommended unless ix requires a specific signer.'
            }
          >
            <Select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              disabled={keypairs.length === 0}
            >
              <option value="">— ephemeral (auto-generate + airdrop) —</option>
              {keypairs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} · {k.pubkey.slice(0, 8)}…
                </option>
              ))}
            </Select>
          </Field>

          {keypairs.length > 0 && (
            <Field
              label={
                <>
                  Additional signers
                  <HelpHint
                    label="Additional signers"
                    hint="Extra keypairs that must sign. Needed when an instruction has more than one signer account (e.g., authority + payer)."
                    skillId="reley-keypair"
                    onOpen={onOpenHelp}
                  />
                </>
              }
              help="Click to toggle. Required when an ix lists more than one signer account."
              className="mt-3"
            >
              <div className="flex flex-wrap gap-1.5">
                {keypairs
                  .filter((k) => k.id !== payerId)
                  .map((k) => {
                    const checked = extraSignerIds.includes(k.id);
                    return (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() =>
                          setExtraSignerIds((prev) =>
                            prev.includes(k.id) ? prev.filter((x) => x !== k.id) : [...prev, k.id],
                          )
                        }
                        className={[
                          'inline-flex items-center gap-1 px-2 h-6 rounded-full border text-2xs transition-colors',
                          checked
                            ? 'bg-accent/20 border-accent text-text'
                            : 'bg-surface-0 border-border text-text-muted hover:bg-surface-1 hover:text-text',
                        ].join(' ')}
                        title={k.pubkey}
                      >
                        <span
                          className={[
                            'inline-block w-1.5 h-1.5 rounded-full',
                            checked ? 'bg-accent' : 'bg-text-subtle',
                          ].join(' ')}
                          aria-hidden
                        />
                        {k.label} · {k.pubkey.slice(0, 4)}…{k.pubkey.slice(-4)}
                      </button>
                    );
                  })}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field
              label={
                <>
                  Compute unit limit (optional)
                  <HelpHint
                    label="Compute unit limit"
                    hint="Max compute budget for the tx. Solana caps at 1.4M. Default ~200k is fine for most ops; bump if you hit `exceeded CU`."
                  />
                </>
              }
            >
              <Input
                value={cuLimit}
                onChange={(e) => setCuLimit(e.target.value)}
                placeholder="200000"
              />
            </Field>
            <Field label="Payer airdrop (lamports)">
              <Input
                value={airdrop}
                onChange={(e) => setAirdrop(e.target.value)}
                className="font-mono"
              />
            </Field>
          </div>
        </details>

        {/* Pre-flight diagnostics — shown above the action bar so blockers
            are visible before clicking Simulate/Submit. */}
        {diagnostics.length > 0 && (
          <div className="mt-4">
            <DiagnosticsPanel issues={diagnostics} />
          </div>
        )}

        {/* Action bar */}
        <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {editingDraftId !== null ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!programId || (mode === 'instruction' && !selectedIx)}
                  onClick={() => void addToTx('replace')}
                  title="Save edits back into the draft at its current position"
                >
                  <Save size={12} aria-hidden /> Save edit
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!programId || (mode === 'instruction' && !selectedIx)}
                  onClick={() => void addToTx('prepend')}
                  title="Add as first instruction"
                >
                  <ArrowUpToLine size={12} aria-hidden /> Prepend
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!programId || (mode === 'instruction' && !selectedIx)}
                  onClick={() => void addToTx('append')}
                  title="Add as last instruction"
                >
                  <ArrowDownToLine size={12} aria-hidden /> Append
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-1.5 items-center">
            {blockingErrors && (
              <span
                className="text-2xs text-danger inline-flex items-center gap-1"
                title="Send is blocked by errors above"
              >
                <AlertCircle size={11} /> blocked
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (drafts.length === 0 && !programId)}
              onClick={simulate}
              title="Run all stacked instructions in sandbox (read-only)"
            >
              {busy ? (
                <>
                  <Spinner size={12} /> Running
                </>
              ) : (
                <>
                  <Play size={12} aria-hidden /> Simulate ({totalIxCount})
                </>
              )}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || blockingErrors || (drafts.length === 0 && !programId)}
              onClick={submit}
              title={
                blockingErrors
                  ? 'Resolve diagnostics above before submitting'
                  : 'Execute all stacked instructions'
              }
            >
              {busy ? (
                <>
                  <Spinner size={12} /> Submitting
                </>
              ) : (
                <>Submit ({totalIxCount})</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {result && <TxResultView result={result} />}

      {deriveOpen && (
        <Modal onClose={() => setDeriveOpen(null)}>
          <DeriveAddressForm
            onPick={(addr) => {
              deriveOpen.onPick(addr);
              toast.success(`address picked: ${addr.slice(0, 6)}…${addr.slice(-4)}`);
            }}
            onClose={() => setDeriveOpen(null)}
            suggestions={deriveSuggestions}
          />
        </Modal>
      )}
    </div>
  );
}

function DiagnosticsPanel({ issues }: { issues: Issue[] }): JSX.Element {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  return (
    <div className="rounded-md border border-border bg-surface-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 text-2xs uppercase tracking-wider text-text-subtle font-medium">
        Pre-flight
        {errors.length > 0 && (
          <Badge size="sm" variant="danger">
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge size="sm" variant="warning">
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </Badge>
        )}
        {infos.length > 0 && (
          <Badge size="sm" variant="default">
            {infos.length} note{infos.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      <ul className="flex flex-col">
        {issues.map((iss) => (
          <li
            key={iss.id}
            className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-b-0"
          >
            <span
              className={[
                'mt-0.5 shrink-0',
                iss.severity === 'error'
                  ? 'text-danger'
                  : iss.severity === 'warning'
                    ? 'text-warning'
                    : 'text-text-muted',
              ].join(' ')}
              aria-hidden
            >
              {iss.severity === 'error' ? (
                <AlertCircle size={13} />
              ) : iss.severity === 'warning' ? (
                <AlertTriangle size={13} />
              ) : (
                <Info size={13} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-text leading-snug">{iss.title}</div>
              {iss.detail && (
                <div className="text-2xs text-text-muted leading-relaxed mt-0.5">
                  {iss.detail}
                </div>
              )}
              <div className="text-2xs text-text-subtle mt-1 font-mono">
                rule: {iss.rule}
                {typeof iss.ixIndex === 'number' && ` · ix #${iss.ixIndex + 1}`}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
