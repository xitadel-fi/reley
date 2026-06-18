// Static pre-flight checks for a stacked instruction list. Pure — no IO, no
// state. UI calls runDiagnostics(drafts, ctx) on every change and renders a
// banner above the Send buttons. Rules grow over time; each one returns an
// Issue with a stable id so the UI can dedupe/diff.

const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export type Severity = 'error' | 'warning' | 'info';

export interface DiagIxAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface DiagIx {
  id: number;
  programId: string;
  instructionName: string;
  accounts: DiagIxAccount[];
}

export interface DiagContext {
  /** Pubkeys we have a keypair for (signer satisfaction). */
  knownSignerPubkeys: Set<string>;
  /** Pubkey of the explicit fee payer (or null = ephemeral auto-payer). */
  payerPubkey: string | null;
}

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  /** Index into the ix list that this issue points at. */
  ixIndex?: number;
  rule: string;
}

export function runDiagnostics(ixs: DiagIx[], ctx: DiagContext): Issue[] {
  const out: Issue[] = [];
  out.push(...checkMintToBeforeAta(ixs));
  out.push(...checkTransferBeforeAta(ixs));
  out.push(...checkUnsatisfiedSigners(ixs, ctx));
  out.push(...checkDuplicateIxIds(ixs));
  out.push(...checkSystemTransferShape(ixs));
  return out;
}

// ---------- Rule: MintTo destination must be initialized before invocation ----------

function checkMintToBeforeAta(ixs: DiagIx[]): Issue[] {
  const out: Issue[] = [];
  for (let i = 0; i < ixs.length; i += 1) {
    const ix = ixs[i]!;
    if (ix.programId !== SPL_TOKEN) continue;
    if (!/^MintTo/i.test(ix.instructionName)) continue;
    const dest = ix.accounts[1]?.pubkey;
    if (!dest) continue;
    const initializedEarlier = ixs.slice(0, i).some((prior) => isAtaCreateFor(prior, dest));
    if (!initializedEarlier) {
      out.push({
        id: `mintto-before-ata:${i}:${dest}`,
        rule: 'mintto-needs-initialized-destination',
        severity: 'error',
        title: 'MintTo destination is not initialized yet',
        detail:
          `Instruction #${i + 1} mints to ${short(dest)}, but no prior instruction ` +
          `creates that token account. Token program returns InvalidAccountData. ` +
          `Add an Associated Token Account "CreateIdempotent" (or Token "InitializeAccount") ` +
          `before this MintTo.`,
        ixIndex: i,
      });
    }
  }
  return out;
}

function isAtaCreateFor(ix: DiagIx, ataPubkey: string): boolean {
  if (ix.programId !== ATA_PROGRAM) return false;
  if (!/Create/i.test(ix.instructionName)) return false;
  // ATA Create / CreateIdempotent: account[1] is the ATA being created.
  return ix.accounts[1]?.pubkey === ataPubkey;
}

// ---------- Rule: Token Transfer destination should already exist ----------

function checkTransferBeforeAta(ixs: DiagIx[]): Issue[] {
  const out: Issue[] = [];
  for (let i = 0; i < ixs.length; i += 1) {
    const ix = ixs[i]!;
    if (ix.programId !== SPL_TOKEN) continue;
    if (!/^Transfer/i.test(ix.instructionName)) continue;
    const dest = ix.accounts[1]?.pubkey;
    if (!dest) continue;
    const initializedEarlier = ixs.slice(0, i).some((prior) => isAtaCreateFor(prior, dest));
    if (!initializedEarlier) {
      out.push({
        id: `transfer-before-ata:${i}:${dest}`,
        rule: 'transfer-needs-initialized-destination',
        severity: 'warning',
        title: 'Token Transfer destination may not be initialized',
        detail:
          `Instruction #${i + 1} transfers tokens to ${short(dest)}. If this ATA does ` +
          `not yet exist in the sandbox, the transfer fails. Add CreateIdempotent first ` +
          `or confirm the account is already cloned.`,
        ixIndex: i,
      });
    }
  }
  return out;
}

// ---------- Rule: every signer pubkey must be in our keypair store (or be the payer) ----------

function checkUnsatisfiedSigners(ixs: DiagIx[], ctx: DiagContext): Issue[] {
  const out: Issue[] = [];
  const reported = new Set<string>();
  for (let i = 0; i < ixs.length; i += 1) {
    const ix = ixs[i]!;
    for (const acc of ix.accounts) {
      if (!acc.isSigner) continue;
      const pubkey = (acc.pubkey ?? '').trim();
      if (!pubkey) continue;
      if (ctx.payerPubkey && pubkey === ctx.payerPubkey) continue;
      if (ctx.knownSignerPubkeys.has(pubkey)) continue;
      const key = `${i}:${pubkey}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push({
        id: `unsigned:${key}`,
        rule: 'signer-without-keypair',
        severity: 'error',
        title: `No keypair for required signer ${short(pubkey)}`,
        detail:
          `Instruction #${i + 1} marks ${short(pubkey)} as a signer, but Relay has no ` +
          `secret key for it. Either add the keypair (Keypairs panel) or change this ` +
          `account to non-signer.`,
        ixIndex: i,
      });
    }
  }
  return out;
}

// ---------- Rule: detect duplicate draft ids (defensive — should not happen) ----------

function checkDuplicateIxIds(ixs: DiagIx[]): Issue[] {
  const seen = new Set<number>();
  const dupes: number[] = [];
  for (const ix of ixs) {
    if (seen.has(ix.id)) dupes.push(ix.id);
    seen.add(ix.id);
  }
  if (dupes.length === 0) return [];
  return [
    {
      id: 'dup-ix-ids',
      rule: 'duplicate-ix-ids',
      severity: 'warning',
      title: 'Duplicate draft IDs',
      detail: `Internal: drafts share id(s) ${dupes.join(', ')}. Reorder may behave oddly.`,
    },
  ];
}

// ---------- Rule: System.Transfer expects [from(writable,signer), to(writable)] ----------

function checkSystemTransferShape(ixs: DiagIx[]): Issue[] {
  const out: Issue[] = [];
  for (let i = 0; i < ixs.length; i += 1) {
    const ix = ixs[i]!;
    if (ix.programId !== SYSTEM_PROGRAM) continue;
    if (!/Transfer/i.test(ix.instructionName)) continue;
    const [from, to] = ix.accounts;
    if (from && !from.isWritable) {
      out.push({
        id: `sys-transfer-from-writable:${i}`,
        rule: 'system-transfer-from-needs-writable',
        severity: 'error',
        title: 'System.Transfer "from" must be writable',
        detail: `Instruction #${i + 1}: account[0] (from) is not marked writable.`,
        ixIndex: i,
      });
    }
    if (to && !to.isWritable) {
      out.push({
        id: `sys-transfer-to-writable:${i}`,
        rule: 'system-transfer-to-needs-writable',
        severity: 'error',
        title: 'System.Transfer "to" must be writable',
        detail: `Instruction #${i + 1}: account[1] (to) is not marked writable.`,
        ixIndex: i,
      });
    }
  }
  return out;
}

// ---------- helpers ----------

function short(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}
