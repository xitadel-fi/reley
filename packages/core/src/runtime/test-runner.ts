import { Keypair, PublicKey } from '@solana/web3.js';
import { ErrorCode, RelayError, type Uuid } from '@reley/shared';
import type {
  AccountExpectation,
  NumericOp,
  TestCase,
  TestCaseResult,
  TestExpectationResult,
  TestStep,
  TestStepResult,
  TxExpectation,
} from '@reley/shared';
import { buildTransaction, signTransaction } from './tx-builder.js';
import type { SessionRuntime } from './session-runtime.js';
import type { CoreContext } from '../store/context.js';
import { parseTrace } from '../trace/parser.js';
import { AnchorCoder } from '../patcher/anchor-coder.js';
import { decodeNative, resolveLayout } from '../patcher/native-layouts.js';

interface TxRunOutcome {
  success: boolean;
  errorMessage: string | null;
  cuConsumed: bigint;
  logs: string[];
}

/**
 * Run all testcases in a suite against the given session. Never halts on
 * failed tx — each step records actual vs expected, and the next step runs
 * regardless of prior tx outcome. Suite passes only if every expectation
 * across every case passes.
 */
export async function runTestSuite(
  ctx: CoreContext,
  runtime: SessionRuntime,
  sessionId: string,
  cases: TestCase[],
): Promise<TestCaseResult[]> {
  const labels = await buildLabelMap(ctx, sessionId);
  const out: TestCaseResult[] = [];
  for (const tc of cases) {
    if (tc.resetBefore) {
      ctx.sessions.reset(sessionId);
      runtime.invalidate(sessionId);
    }
    const startedAt = Date.now();
    const stepResults: TestStepResult[] = [];
    for (const step of tc.steps) {
      stepResults.push(await runOneStep(ctx, runtime, sessionId, step, labels));
    }
    out.push({
      caseId: tc.id,
      name: tc.name,
      startedAt,
      completedAt: Date.now(),
      pass: stepResults.every((s) => s.pass),
      steps: stepResults,
    });
  }
  return out;
}

async function runOneStep(
  ctx: CoreContext,
  runtime: SessionRuntime,
  sessionId: string,
  step: TestStep,
  labels: LabelMap,
): Promise<TestStepResult> {
  const start = performance.now();
  let txOk: boolean | null = null;
  let errorMessage: string | null = null;
  let txOutcome: TxRunOutcome | null = null;
  try {
    switch (step.kind) {
      case 'airdrop':
        await runtime.airdrop(sessionId, step.pubkey, BigInt(step.lamports));
        break;
      case 'warpTime':
        await runtime.warpByTime(sessionId, step.seconds);
        break;
      case 'warpSlot':
        await runtime.warpToSlot(sessionId, BigInt(step.slot));
        break;
      case 'expireBlockhash':
        await runtime.expireBlockhash(sessionId);
        break;
      case 'resetSession':
      case 'resetSandbox':
        ctx.sessions.reset(sessionId);
        runtime.invalidate(sessionId);
        break;
      case 'setProgramVersion':
        ctx.sessions.pinProgramVersion(sessionId, step.programId, step.versionId);
        runtime.invalidate(sessionId);
        break;
      case 'tx':
        txOutcome = await runTxStep(ctx, runtime, sessionId, step);
        txOk = txOutcome.success;
        errorMessage = txOutcome.errorMessage;
        break;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    if (step.kind === 'tx') txOk = false;
  }

  const expectations: TestExpectationResult[] = [];
  if (step.kind === 'tx') {
    for (const e of step.txExpectations ?? []) {
      expectations.push(evalTxExpectation(e, txOutcome, errorMessage));
    }
  }
  for (const e of step.accountExpectations ?? []) {
    try {
      expectations.push(await evalAccountExpectation(ctx, runtime, sessionId, e, labels));
    } catch (err) {
      expectations.push({
        kind: e.kind,
        description: accountExpectationLabel(e, labels),
        pass: false,
        actual: `error: ${err instanceof Error ? err.message : String(err)}`,
        expected: '(see description)',
      });
    }
  }

  return {
    stepId: step.id,
    kind: step.kind,
    name: step.name,
    txOk,
    errorMessage,
    durationMs: performance.now() - start,
    ...(txOutcome && {
      tx: {
        cuConsumed: txOutcome.cuConsumed.toString(),
        logs: txOutcome.logs,
        errorMessage: txOutcome.errorMessage,
        success: txOutcome.success,
      },
    }),
    expectations,
    pass: expectations.every((x) => x.pass),
  };
}

async function runTxStep(
  ctx: CoreContext,
  runtime: SessionRuntime,
  sessionId: string,
  step: Extract<TestStep, { kind: 'tx' }>,
): Promise<TxRunOutcome> {
  if (step.ixs.length === 0) {
    throw new RelayError(ErrorCode.INVALID_INPUT, `tx step "${step.name}" has no ixs`);
  }
  const overrides = step.programVersionOverrides ?? {};
  const previousPins: Record<string, string | null> = {};
  const sessionPre = ctx.sessions.get(sessionId);
  for (const pid of Object.keys(overrides)) {
    previousPins[pid] = sessionPre.programVersionOverrides?.[pid] ?? null;
  }
  for (const [pid, vid] of Object.entries(overrides)) {
    ctx.sessions.pinProgramVersion(sessionId, pid, vid);
  }
  if (Object.keys(overrides).length > 0) runtime.invalidate(sessionId);

  try {
    let payer: Keypair;
    if (step.payerKeypairId) {
      const secret = await ctx.keypairs.exportSecretKey(step.payerKeypairId);
      payer = Keypair.fromSecretKey(secret);
    } else {
      payer = Keypair.generate();
    }
    if (step.airdropPayerLamports) {
      await runtime.airdrop(sessionId, payer.publicKey.toBase58(), BigInt(step.airdropPayerLamports));
    } else if (!step.payerKeypairId) {
      await runtime.airdrop(sessionId, payer.publicKey.toBase58(), 10_000_000_000n);
    }
    await runtime.expireBlockhash(sessionId);
    const recentBlockhash = await runtime.latestBlockhash(sessionId);
    const tx = buildTransaction({
      payer: payer.publicKey.toBase58(),
      ixs: step.ixs,
      recentBlockhash,
      ...(step.computeUnitLimit !== undefined &&
        step.computeUnitLimit !== null && { computeUnitLimit: step.computeUnitLimit }),
    });
    const signers: Array<{ pubkey: string; secretKey: number[] }> = [
      { pubkey: payer.publicKey.toBase58(), secretKey: Array.from(payer.secretKey) },
    ];
    if (step.additionalSignerKeypairIds && step.additionalSignerKeypairIds.length > 0) {
      const have = new Set(signers.map((s) => s.pubkey));
      for (const id of step.additionalSignerKeypairIds) {
        const secret = await ctx.keypairs.exportSecretKey(id);
        const kp = Keypair.fromSecretKey(secret);
        const pub = kp.publicKey.toBase58();
        if (have.has(pub)) continue;
        have.add(pub);
        signers.push({ pubkey: pub, secretKey: Array.from(kp.secretKey) });
      }
    }
    signTransaction(tx, signers);
    const serialized = tx.serialize();
    const txResult = await runtime.sendTransaction(sessionId, serialized);
    const session = ctx.sessions.get(sessionId);
    const trace = parseTrace(txResult.logs);
    session.txHistory.push({
      id: crypto.randomUUID(),
      signature: null,
      submittedAt: Date.now(),
      success: txResult.success,
      errorMessage: txResult.errorMessage,
      cuConsumed: txResult.cuConsumed,
      trace: trace[0] ?? {
        programId: '<no-trace>',
        depth: 0,
        instructionIndex: 0,
        cuConsumed: 0n,
        cuRemaining: 0n,
        logs: [],
        events: [],
        returnData: null,
        children: [],
        error: null,
      },
      touchedAccounts: [],
      rawTxBase64: Buffer.from(serialized).toString('base64'),
    });
    return {
      success: txResult.success,
      errorMessage: txResult.errorMessage,
      cuConsumed: txResult.cuConsumed,
      logs: txResult.logs,
    };
  } finally {
    for (const [pid, prev] of Object.entries(previousPins)) {
      ctx.sessions.pinProgramVersion(sessionId, pid, prev);
    }
    if (Object.keys(previousPins).length > 0) runtime.invalidate(sessionId);
  }
}

// ───────────────── Expectation evaluators ─────────────────

function evalTxExpectation(
  e: TxExpectation,
  outcome: TxRunOutcome | null,
  errorMessage: string | null,
): TestExpectationResult {
  if (!outcome) {
    return {
      kind: e.kind,
      description: txExpectationLabel(e),
      pass: false,
      actual: errorMessage ? `runner error: ${errorMessage}` : 'no tx outcome (step threw)',
      expected: '(see description)',
    };
  }
  switch (e.kind) {
    case 'shouldSucceed':
      return {
        kind: e.kind,
        description: e.value ? 'tx succeeds' : 'tx fails',
        pass: outcome.success === e.value,
        actual: outcome.success ? 'success' : `failed: ${outcome.errorMessage ?? '(unknown)'}`,
        expected: e.value ? 'success' : 'failure',
      };
    case 'errorMessageContains': {
      const hay = (outcome.errorMessage ?? '') + '\n' + outcome.logs.join('\n');
      const pass = hay.includes(e.substring);
      return {
        kind: e.kind,
        description: `error/log contains "${e.substring}"`,
        pass,
        actual: outcome.errorMessage ?? '(no error)',
        expected: e.substring,
      };
    }
    case 'logContains': {
      const pass = outcome.logs.some((l) => l.includes(e.substring));
      return {
        kind: e.kind,
        description: `any log contains "${e.substring}"`,
        pass,
        actual: pass ? '(matched)' : '(not found in logs)',
        expected: e.substring,
      };
    }
    case 'cuRange': {
      const cu = Number(outcome.cuConsumed);
      const minOk = e.min === undefined || e.min === null || cu >= e.min;
      const maxOk = e.max === undefined || e.max === null || cu <= e.max;
      const pass = minOk && maxOk;
      const range = `[${e.min ?? '-∞'}, ${e.max ?? '+∞'}]`;
      return {
        kind: e.kind,
        description: `cuConsumed in ${range}`,
        pass,
        actual: String(cu),
        expected: range,
      };
    }
  }
}

async function evalAccountExpectation(
  ctx: CoreContext,
  runtime: SessionRuntime,
  sessionId: string,
  e: AccountExpectation,
  labels: LabelMap,
): Promise<TestExpectationResult> {
  const desc = accountExpectationLabel(e, labels);
  const svm = await runtime.ensureHydrated(sessionId);
  switch (e.kind) {
    case 'accountExists': {
      const acc = svm.getAccount(new PublicKey(e.address));
      const got = acc != null && acc.lamports > 0;
      return {
        kind: e.kind,
        description: desc,
        pass: got === e.exists,
        actual: got ? `exists (owner=${tagFor(labels, acc!.owner.toBase58())})` : 'missing',
        expected: e.exists ? 'exists' : 'missing',
      };
    }
    case 'lamports': {
      const acc = svm.getAccount(new PublicKey(e.address));
      const actual = BigInt(acc?.lamports ?? 0);
      const ownerTag = acc ? ` owner=${tagFor(labels, acc.owner.toBase58())}` : '';
      return numericResult(
        e.kind,
        desc,
        actual,
        BigInt(e.value),
        e.op,
        `${actual} lamports${ownerTag}`,
        String(e.value),
      );
    }
    case 'tokenBalance': {
      const acc = svm.getAccount(new PublicKey(e.ata));
      if (!acc) {
        return {
          kind: e.kind,
          description: desc,
          pass: false,
          actual: 'account missing',
          expected: `${e.op} ${e.value}`,
        };
      }
      const layout = resolveLayout(acc.owner.toBase58(), acc.data.length);
      if (!layout) {
        return {
          kind: e.kind,
          description: desc,
          pass: false,
          actual: `not an SPL token account (owner=${tagFor(labels, acc.owner.toBase58())}, len=${acc.data.length})`,
          expected: `${e.op} ${e.value}`,
        };
      }
      const decoded = decodeNative(acc.data, layout) as Record<string, unknown>;
      const raw = decoded['amount'];
      let amount: bigint;
      try {
        amount = typeof raw === 'bigint' ? raw : BigInt(String(raw ?? '0'));
      } catch {
        amount = 0n;
      }
      // Decode mint + owner from the token account for richer logs.
      const mintRaw = decoded['mint'];
      const ownerRaw = decoded['owner'];
      const mintAddr = typeof mintRaw === 'string' ? mintRaw : null;
      const walletAddr = typeof ownerRaw === 'string' ? ownerRaw : null;
      const parts: string[] = [`amount=${amount}`];
      if (mintAddr) parts.push(`mint=${tagFor(labels, mintAddr)}`);
      if (walletAddr) parts.push(`wallet=${tagFor(labels, walletAddr)}`);
      return numericResult(
        e.kind,
        desc,
        amount,
        BigInt(e.value),
        e.op,
        parts.join(' '),
        String(e.value),
      );
    }
    case 'fieldEquals': {
      const acc = svm.getAccount(new PublicKey(e.address));
      if (!acc) {
        return {
          kind: e.kind,
          description: desc,
          pass: false,
          actual: 'account missing',
          expected: `${e.path} ${e.op} ${e.value}`,
        };
      }
      const owner = acc.owner.toBase58();
      const dec = await decodeForAccount(ctx, sessionId, owner, acc.data);
      if (!dec.value) {
        return {
          kind: e.kind,
          description: desc,
          pass: false,
          actual: `decode failed (owner=${tagFor(labels, owner)}, len=${acc.data.length}): ${dec.reason}`,
          expected: `${e.path} ${e.op} ${e.value}`,
        };
      }
      const got = pickPath(dec.value, e.path);
      const actualStr = stringify(got);
      const ownerTag = ` owner=${tagFor(labels, owner)}`;
      const numeric = tryBigInt(got);
      const expectedNumeric = tryBigInt(e.value);
      if (numeric !== null && expectedNumeric !== null) {
        return numericResult(
          e.kind,
          desc,
          numeric,
          expectedNumeric,
          e.op,
          `${e.path}=${actualStr}${ownerTag}`,
          e.value,
        );
      }
      if (e.op === 'eq' || e.op === 'neq') {
        const eq = actualStr === e.value;
        return {
          kind: e.kind,
          description: desc,
          pass: e.op === 'eq' ? eq : !eq,
          actual: `${e.path}=${actualStr}${ownerTag}`,
          expected: `${e.op} ${e.value}`,
        };
      }
      return {
        kind: e.kind,
        description: desc,
        pass: false,
        actual: `${e.path}=${actualStr}${ownerTag}`,
        expected: `${e.op} ${e.value} (not numeric)`,
      };
    }
  }
}

function numericResult(
  kind: string,
  desc: string,
  actual: bigint,
  expected: bigint,
  op: NumericOp,
  actualStr: string,
  expectedStr: string,
): TestExpectationResult {
  let pass = false;
  switch (op) {
    case 'eq':
      pass = actual === expected;
      break;
    case 'neq':
      pass = actual !== expected;
      break;
    case 'ge':
      pass = actual >= expected;
      break;
    case 'le':
      pass = actual <= expected;
      break;
    case 'gt':
      pass = actual > expected;
      break;
    case 'lt':
      pass = actual < expected;
      break;
  }
  return { kind, description: desc, pass, actual: actualStr, expected: `${op} ${expectedStr}` };
}

interface DecodeOutcome {
  value: Record<string, unknown> | null;
  /** Diagnostic string when value is null — helps debug failed expectations. */
  reason: string;
}

async function decodeForAccount(
  ctx: CoreContext,
  sessionId: string,
  owner: string,
  data: Buffer,
): Promise<DecodeOutcome> {
  let versionId: string | null = null;
  let ownerInProject = false;
  try {
    const session = ctx.sessions.get(sessionId);
    versionId = session.programVersionOverrides?.[owner] ?? null;
    const project = ctx.projects.get(session.projectId);
    ownerInProject = !!project.programs[owner];
    if (!versionId) versionId = project.programs[owner]?.activeVersionId ?? null;
  } catch {
    /* session missing — skip pin lookup */
  }
  const idl = await ctx.idls.get(owner, versionId).catch(() => null);
  if (idl) {
    const coder = new AnchorCoder(idl);
    const decoded = coder.decodeAny(data);
    if (decoded) return { value: decoded.value as Record<string, unknown>, reason: '' };
    return {
      value: null,
      reason: 'IDL attached but no account discriminator matched (different account type or uninitialized)',
    };
  }
  const layout = resolveLayout(owner, data.length);
  if (layout) return { value: decodeNative(data, layout) as Record<string, unknown>, reason: '' };
  if (!ownerInProject) return { value: null, reason: 'owner program not in project; no IDL or native layout' };
  return { value: null, reason: 'no IDL attached for owner program and no native layout matches' };
}

function pickPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isFinite(idx) ? cur[idx] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function tryBigInt(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string') {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

function stringify(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function txExpectationLabel(e: TxExpectation): string {
  switch (e.kind) {
    case 'shouldSucceed':
      return e.value ? 'tx should succeed' : 'tx should fail';
    case 'errorMessageContains':
      return `error/log contains "${e.substring}"`;
    case 'logContains':
      return `log contains "${e.substring}"`;
    case 'cuRange':
      return `cu in [${e.min ?? '-∞'}, ${e.max ?? '+∞'}]`;
  }
}

function accountExpectationLabel(e: AccountExpectation, labels: LabelMap): string {
  switch (e.kind) {
    case 'accountExists':
      return `${tagFor(labels, e.address)} ${e.exists ? 'exists' : 'is missing'}`;
    case 'lamports':
      return `lamports(${tagFor(labels, e.address)}) ${e.op} ${e.value}`;
    case 'tokenBalance':
      return `tokenBalance(${tagFor(labels, e.ata)}) ${e.op} ${e.value}`;
    case 'fieldEquals':
      return `${tagFor(labels, e.address)}.${e.path} ${e.op} ${e.value}`;
  }
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// ───────────────── Label resolution ─────────────────
//
// Map an on-chain address to a human-readable tag so test output reads as
// "lamports(alice)" instead of "lamports(Ai1ce…dvVc)". Sources, in
// precedence order: project account label → keypair label → program label
// → SPL builtin name → shortAddr fallback.

type LabelMap = Map<string, string>;

async function buildLabelMap(ctx: CoreContext, sessionId: string): Promise<LabelMap> {
  const map: LabelMap = new Map();
  try {
    const session = ctx.sessions.get(sessionId);
    const project = ctx.projects.get(session.projectId);
    for (const prog of Object.values(project.programs)) {
      if (prog.label) map.set(prog.programId, prog.label);
      for (const acc of prog.accounts ?? []) {
        if (acc.label) map.set(acc.address, acc.label);
      }
    }
  } catch {
    /* missing session/project — skip */
  }
  try {
    const keypairs = await ctx.keypairs.list();
    for (const k of keypairs) {
      if (!map.has(k.pubkey) && k.label) map.set(k.pubkey, k.label);
    }
  } catch {
    /* ignore */
  }
  // SPL / system builtins — only set if not already labeled.
  const BUILTINS: Record<string, string> = {
    '11111111111111111111111111111111': 'system',
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'spl-token',
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'token-2022',
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'associated-token',
  };
  for (const [k, v] of Object.entries(BUILTINS)) {
    if (!map.has(k)) map.set(k, v);
  }
  return map;
}

function tagFor(labels: LabelMap, address: string): string {
  const label = labels.get(address);
  if (label) return `${label}(${shortAddr(address)})`;
  return shortAddr(address);
}
