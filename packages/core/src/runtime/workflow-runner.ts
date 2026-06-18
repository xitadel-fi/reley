import { Keypair } from '@solana/web3.js';
import { ErrorCode, RelayError, type Uuid } from '@relay/shared';
import { buildTransaction, signTransaction } from './tx-builder.js';
import type { SessionRuntime } from './session-runtime.js';
import type { CoreContext } from '../store/context.js';
import { parseTrace } from '../trace/parser.js';

interface TxStepIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

export type WorkflowStepInput =
  | {
      kind: 'tx';
      id: Uuid;
      name: string;
      ixs: TxStepIx[];
      computeUnitLimit?: number | null;
      airdropPayerLamports?: string | null;
      payerKeypairId?: string | null;
      additionalSignerKeypairIds?: string[];
      programVersionOverrides?: Record<string, string>;
    }
  | { kind: 'airdrop'; id: Uuid; name: string; pubkey: string; lamports: string }
  | { kind: 'warpTime'; id: Uuid; name: string; seconds: number }
  | { kind: 'warpSlot'; id: Uuid; name: string; slot: string }
  | { kind: 'expireBlockhash'; id: Uuid; name: string }
  | { kind: 'resetSession'; id: Uuid; name: string }
  | { kind: 'resetSandbox'; id: Uuid; name: string }
  | {
      kind: 'setProgramVersion';
      id: Uuid;
      name: string;
      programId: string;
      versionId: string | null;
    };

export interface WorkflowStepResult {
  stepId: Uuid;
  kind: WorkflowStepInput['kind'];
  name: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  tx?: {
    cuConsumed: string;
    logs: string[];
    errorMessage: string | null;
    success: boolean;
  };
}

export async function runWorkflow(
  ctx: CoreContext,
  runtime: SessionRuntime,
  sessionId: string,
  steps: WorkflowStepInput[],
): Promise<WorkflowStepResult[]> {
  const results: WorkflowStepResult[] = [];
  for (const step of steps) {
    const start = performance.now();
    try {
      switch (step.kind) {
        case 'airdrop':
          await runtime.airdrop(sessionId, step.pubkey, BigInt(step.lamports));
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;

        case 'warpTime': {
          await runtime.warpByTime(sessionId, step.seconds);
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;
        }

        case 'warpSlot':
          await runtime.warpToSlot(sessionId, BigInt(step.slot));
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;

        case 'expireBlockhash':
          await runtime.expireBlockhash(sessionId);
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;

        case 'resetSession':
        case 'resetSandbox': {
          ctx.sessions.reset(sessionId);
          runtime.invalidate(sessionId);
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;
        }

        case 'setProgramVersion': {
          ctx.sessions.pinProgramVersion(sessionId, step.programId, step.versionId);
          runtime.invalidate(sessionId);
          results.push({
            stepId: step.id,
            kind: step.kind,
            name: step.name,
            success: true,
            errorMessage: null,
            durationMs: performance.now() - start,
          });
          break;
        }

        case 'tx': {
          if (step.ixs.length === 0) {
            throw new RelayError(ErrorCode.INVALID_INPUT, `tx step "${step.name}" has no ixs`);
          }
          // Snapshot + apply version pins. Restoration handled by the
          // try/finally below so leaks can't happen on throws either.
          const overrides = step.programVersionOverrides ?? {};
          const previousPins: Record<string, string | null> = {};
          {
            const sessionPre = ctx.sessions.get(sessionId);
            for (const pid of Object.keys(overrides)) {
              previousPins[pid] = sessionPre.programVersionOverrides?.[pid] ?? null;
            }
            for (const [pid, vid] of Object.entries(overrides)) {
              ctx.sessions.pinProgramVersion(sessionId, pid, vid);
            }
            if (Object.keys(overrides).length > 0) runtime.invalidate(sessionId);
          }
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
            // ephemeral payer needs SOL for fees
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
          results.push({
            stepId: step.id,
            kind: 'tx',
            name: step.name,
            success: txResult.success,
            errorMessage: txResult.errorMessage,
            durationMs: performance.now() - start,
            tx: {
              cuConsumed: txResult.cuConsumed.toString(),
              logs: txResult.logs,
              errorMessage: txResult.errorMessage,
              success: txResult.success,
            },
          });
          if (!txResult.success) {
            return results; // stop on first failed tx step (finally restores pins)
          }
          break;
          } finally {
            for (const [pid, prev] of Object.entries(previousPins)) {
              ctx.sessions.pinProgramVersion(sessionId, pid, prev);
            }
            if (Object.keys(previousPins).length > 0) runtime.invalidate(sessionId);
          }
        }
      }
    } catch (err) {
      results.push({
        stepId: step.id,
        kind: step.kind,
        name: step.name,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      });
      return results; // halt on first error
    }
  }
  return results;
}
