import type { Idl } from '@coral-xyz/anchor';

/**
 * Structural diff of two Anchor IDLs. Pure function — no I/O.
 *
 * Comparison is name-based (instructions / accounts / errors / events match
 * by name). For matched pairs we compare their args/fields/accounts lists
 * and return per-field deltas.
 */

export interface NameSetDiff {
  added: string[];
  removed: string[];
}

export interface FieldDelta {
  name: string;
  /** Type representation as JSON.stringify for portability. */
  leftType: string | null;
  rightType: string | null;
}

export interface ChangedItem {
  name: string;
  /** Optional sub-list of field-level deltas (args / fields / accounts). */
  args?: { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] };
  fields?: { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] };
  accounts?: NameSetDiff & { propsChanged: string[] };
}

export interface IdlDiff {
  leftName: string;
  rightName: string;
  instructions: {
    added: string[];
    removed: string[];
    changed: ChangedItem[];
  };
  accounts: {
    added: string[];
    removed: string[];
    changed: ChangedItem[];
  };
  errors: NameSetDiff;
  events: NameSetDiff;
  summary: {
    instructionsAdded: number;
    instructionsRemoved: number;
    instructionsChanged: number;
    accountsAdded: number;
    accountsRemoved: number;
    accountsChanged: number;
    errorsAdded: number;
    errorsRemoved: number;
    eventsAdded: number;
    eventsRemoved: number;
    totalChanges: number;
  };
}

type AnyAnchorEntity = { name?: string };
type AnyField = { name: string; type?: unknown; ty?: unknown };
type AnyIxAccount = {
  name?: string;
  isMut?: boolean;
  isSigner?: boolean;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
};

function nameOf(x: AnyAnchorEntity): string {
  return typeof x?.name === 'string' ? x.name : '<unnamed>';
}

function typeOf(field: AnyField): string {
  const t = field.type ?? field.ty ?? null;
  if (t == null) return 'null';
  return typeof t === 'string' ? t : JSON.stringify(t);
}

function indexByName<T extends AnyAnchorEntity>(arr: readonly T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  if (!arr) return m;
  for (const item of arr) m.set(nameOf(item), item);
  return m;
}

function diffFieldList(
  left: AnyField[] | undefined,
  right: AnyField[] | undefined,
): { added: FieldDelta[]; removed: FieldDelta[]; typeChanged: FieldDelta[] } {
  const lMap = new Map<string, AnyField>();
  const rMap = new Map<string, AnyField>();
  for (const f of left ?? []) lMap.set(f.name, f);
  for (const f of right ?? []) rMap.set(f.name, f);
  const added: FieldDelta[] = [];
  const removed: FieldDelta[] = [];
  const typeChanged: FieldDelta[] = [];
  for (const [name, f] of rMap) {
    if (!lMap.has(name)) added.push({ name, leftType: null, rightType: typeOf(f) });
  }
  for (const [name, f] of lMap) {
    if (!rMap.has(name)) removed.push({ name, leftType: typeOf(f), rightType: null });
  }
  for (const [name, lf] of lMap) {
    const rf = rMap.get(name);
    if (!rf) continue;
    const lt = typeOf(lf);
    const rt = typeOf(rf);
    if (lt !== rt) typeChanged.push({ name, leftType: lt, rightType: rt });
  }
  return { added, removed, typeChanged };
}

function ixAccountKey(a: AnyIxAccount): string {
  return `${nameOf(a)}|s=${a.isSigner ?? a.signer ? 1 : 0}|w=${a.isMut ?? a.writable ? 1 : 0}|o=${a.optional ? 1 : 0}`;
}

function diffIxAccounts(
  left: AnyIxAccount[] | undefined,
  right: AnyIxAccount[] | undefined,
): NameSetDiff & { propsChanged: string[] } {
  const lNames = new Set<string>();
  const rNames = new Set<string>();
  const lByName = new Map<string, AnyIxAccount>();
  const rByName = new Map<string, AnyIxAccount>();
  for (const a of left ?? []) {
    const n = nameOf(a);
    lNames.add(n);
    lByName.set(n, a);
  }
  for (const a of right ?? []) {
    const n = nameOf(a);
    rNames.add(n);
    rByName.set(n, a);
  }
  const added: string[] = [];
  const removed: string[] = [];
  const propsChanged: string[] = [];
  for (const n of rNames) if (!lNames.has(n)) added.push(n);
  for (const n of lNames) if (!rNames.has(n)) removed.push(n);
  for (const n of lNames) {
    if (!rNames.has(n)) continue;
    if (ixAccountKey(lByName.get(n)!) !== ixAccountKey(rByName.get(n)!)) propsChanged.push(n);
  }
  return { added, removed, propsChanged };
}

export function diffIdl(left: Idl, right: Idl): IdlDiff {
  const lIx = indexByName(left.instructions as readonly AnyAnchorEntity[] | undefined);
  const rIx = indexByName(right.instructions as readonly AnyAnchorEntity[] | undefined);
  const lAcc = indexByName(left.accounts as readonly AnyAnchorEntity[] | undefined);
  const rAcc = indexByName(right.accounts as readonly AnyAnchorEntity[] | undefined);
  const lErr = indexByName(left.errors as readonly AnyAnchorEntity[] | undefined);
  const rErr = indexByName(right.errors as readonly AnyAnchorEntity[] | undefined);
  const lEv = indexByName(left.events as readonly AnyAnchorEntity[] | undefined);
  const rEv = indexByName(right.events as readonly AnyAnchorEntity[] | undefined);

  const ixAdded = Array.from(rIx.keys()).filter((n) => !lIx.has(n));
  const ixRemoved = Array.from(lIx.keys()).filter((n) => !rIx.has(n));
  const ixChanged: ChangedItem[] = [];
  for (const [name, li] of lIx) {
    const ri = rIx.get(name);
    if (!ri) continue;
    const lAny = li as unknown as { args?: AnyField[]; accounts?: AnyIxAccount[] };
    const rAny = ri as unknown as { args?: AnyField[]; accounts?: AnyIxAccount[] };
    const args = diffFieldList(lAny.args, rAny.args);
    const accounts = diffIxAccounts(lAny.accounts, rAny.accounts);
    const hasDiff =
      args.added.length > 0 ||
      args.removed.length > 0 ||
      args.typeChanged.length > 0 ||
      accounts.added.length > 0 ||
      accounts.removed.length > 0 ||
      accounts.propsChanged.length > 0;
    if (hasDiff) ixChanged.push({ name, args, accounts });
  }

  const accAdded = Array.from(rAcc.keys()).filter((n) => !lAcc.has(n));
  const accRemoved = Array.from(lAcc.keys()).filter((n) => !rAcc.has(n));
  const accChanged: ChangedItem[] = [];
  for (const [name, la] of lAcc) {
    const ra = rAcc.get(name);
    if (!ra) continue;
    const lAny = la as unknown as { type?: { fields?: AnyField[] } };
    const rAny = ra as unknown as { type?: { fields?: AnyField[] } };
    const fields = diffFieldList(lAny.type?.fields, rAny.type?.fields);
    const hasDiff =
      fields.added.length > 0 || fields.removed.length > 0 || fields.typeChanged.length > 0;
    if (hasDiff) accChanged.push({ name, fields });
  }

  const errAdded = Array.from(rErr.keys()).filter((n) => !lErr.has(n));
  const errRemoved = Array.from(lErr.keys()).filter((n) => !rErr.has(n));
  const evAdded = Array.from(rEv.keys()).filter((n) => !lEv.has(n));
  const evRemoved = Array.from(lEv.keys()).filter((n) => !rEv.has(n));

  const leftName = left.metadata?.name ?? 'left';
  const rightName = right.metadata?.name ?? 'right';

  const summary = {
    instructionsAdded: ixAdded.length,
    instructionsRemoved: ixRemoved.length,
    instructionsChanged: ixChanged.length,
    accountsAdded: accAdded.length,
    accountsRemoved: accRemoved.length,
    accountsChanged: accChanged.length,
    errorsAdded: errAdded.length,
    errorsRemoved: errRemoved.length,
    eventsAdded: evAdded.length,
    eventsRemoved: evRemoved.length,
    totalChanges: 0,
  };
  summary.totalChanges =
    summary.instructionsAdded +
    summary.instructionsRemoved +
    summary.instructionsChanged +
    summary.accountsAdded +
    summary.accountsRemoved +
    summary.accountsChanged +
    summary.errorsAdded +
    summary.errorsRemoved +
    summary.eventsAdded +
    summary.eventsRemoved;

  return {
    leftName,
    rightName,
    instructions: { added: ixAdded, removed: ixRemoved, changed: ixChanged },
    accounts: { added: accAdded, removed: accRemoved, changed: accChanged },
    errors: { added: errAdded, removed: errRemoved },
    events: { added: evAdded, removed: evRemoved },
    summary,
  };
}
