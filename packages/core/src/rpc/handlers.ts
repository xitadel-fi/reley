import { BorshInstructionCoder, Program as AnchorProgram, type Idl } from '@coral-xyz/anchor';
import { ErrorCode, IpcMethod, type NetworkId, type PatchScope, RelayError } from '@relay/shared';
import { Connection, PublicKey } from '@solana/web3.js';
import { Cloner } from '../cloner/cloner.js';
import { AnchorCoder, serializeDecoded } from '../patcher/anchor-coder.js';
import { diffIdl } from '../patcher/idl-diff.js';
import { decodeNative, resolveLayout } from '../patcher/native-layouts.js';
import {
  decodeNativeIx,
  encodeNativeIx,
  findNativeInstruction,
  listNativeInstructions,
} from '../instructions/native-ix.js';
import { BUILTIN_PROGRAM_LIST, isBuiltinProgram } from '../util/builtins.js';
import { Replayer } from '../replayer/replayer.js';
import { SolanaRpcServer } from '../rpc-server/solana-rpc-server.js';
import { SessionRuntime } from '../runtime/session-runtime.js';
import {
  type InstructionSpec,
  type SignerInput,
  buildTransaction,
  signTransaction,
} from '../runtime/tx-builder.js';
import { runWorkflow, type WorkflowStepInput } from '../runtime/workflow-runner.js';
import { runTestSuite } from '../runtime/test-runner.js';
import type { TestCase, TestSuite } from '@relay/shared';
import {
  applySnapshot,
  captureFromSession,
  deserializeSnapshot,
  newSnapshotRef,
  serializeSnapshot,
  snapshotFingerprint,
} from '../snapshot/snapshot.js';
import type { CoreContext } from '../store/context.js';
import { parseTrace } from '../trace/parser.js';
import type { HandlerMap } from './protocol.js';

export interface HandlerEnv {
  ctx: CoreContext;
  /** Resolve an RPC URL by endpoint id (or fall back to env var). */
  resolveRpcUrl(endpointId: string): string;
  /** Persist after mutating handlers. */
  persist(): Promise<void>;
}

export function buildHandlers(env: HandlerEnv): HandlerMap {
  const { ctx, persist } = env;
  const runtime = new SessionRuntime(ctx);
  let solanaRpc: SolanaRpcServer | null = null;

  /**
   * Decode a serialized VersionedTransaction into TxTemplateInstruction[]
   * suitable for the project's tx-template store. Best-effort enrichment:
   * pulls program label from the project, ix name + summary from IDL/native
   * decoder when available.
   */
  async function decodeTxToTemplateIxs(
    rawTxBase64: string,
    project: { programs: Record<string, { label: string }> },
    coreCtx: CoreContext,
  ): Promise<
    Array<{
      programId: string;
      programLabel: string;
      instructionName: string;
      summary: string;
      accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
      dataBase64: string;
    }>
  > {
    const { VersionedTransaction } = await import('@solana/web3.js');
    const bytes = new Uint8Array(Buffer.from(rawTxBase64, 'base64'));
    const tx = VersionedTransaction.deserialize(bytes);
    const message = tx.message;
    const accountKeys = message.staticAccountKeys.map((k) => k.toBase58());
    const numSigners = message.header.numRequiredSignatures;
    const numReadonlySigners = message.header.numReadonlySignedAccounts;
    const numReadonlyUnsigned = message.header.numReadonlyUnsignedAccounts;
    const totalStatic = accountKeys.length;

    const isSigner = (idx: number): boolean => idx < numSigners;
    const isWritable = (idx: number): boolean => {
      if (idx < numSigners) return idx < numSigners - numReadonlySigners;
      const unsignedIdx = idx - numSigners;
      const unsignedTotal = totalStatic - numSigners;
      return unsignedIdx < unsignedTotal - numReadonlyUnsigned;
    };

    const out: Array<{
      programId: string;
      programLabel: string;
      instructionName: string;
      summary: string;
      accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
      dataBase64: string;
    }> = [];

    for (const cix of message.compiledInstructions) {
      const programIdIndex = cix.programIdIndex;
      const programId = accountKeys[programIdIndex] ?? '';
      const accounts = Array.from(cix.accountKeyIndexes).map((idx) => ({
        pubkey: accountKeys[idx] ?? '',
        isSigner: isSigner(idx),
        isWritable: isWritable(idx),
      }));
      const dataBase64 = Buffer.from(cix.data).toString('base64');
      const programLabel = project.programs[programId]?.label ?? programId;

      // Best-effort ix-name lookup via IDL or native registry.
      let instructionName = '(unknown)';
      let summary = `${accounts.length} accounts · ${cix.data.length} data bytes`;
      const idl = await coreCtx.idls.get(programId).catch(() => null);
      if (idl) {
        try {
          const coder = new BorshInstructionCoder(idl);
          const decoded = coder.decode(Buffer.from(cix.data));
          if (decoded) {
            instructionName = decoded.name;
            summary = `${instructionName} (${accounts.length} accts)`;
          }
        } catch {
          /* not an Anchor ix — try native */
        }
      }
      if (instructionName === '(unknown)') {
        const native = decodeNativeIx(programId, new Uint8Array(cix.data));
        if (native) {
          instructionName = native.name;
          summary = `${native.name} (${accounts.length} accts)`;
        }
      }

      out.push({
        programId,
        programLabel,
        instructionName,
        summary,
        accounts,
        dataBase64,
      });
    }
    return out;
  }

  /**
   * Best-effort onchain IDL fetch. Returns `null` on any failure (no IDL,
   * RPC down, decode error). Uses Anchor's standard IDL PDA + zstd
   * decompress via Program.fetchIdl.
   */
  async function fetchOnchainIdl(programId: string, rpcUrl: string): Promise<Idl | null> {
    try {
      const connection = new Connection(rpcUrl);
      // Anchor's fetchIdl only reads `provider.connection.getAccountInfo`.
      // No wallet needed; we cast a minimal provider shape.
      const provider = { connection, publicKey: new PublicKey('11111111111111111111111111111111') };
      const idl = await AnchorProgram.fetchIdl(programId, provider as never);
      return (idl as Idl | null) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Seed a fresh demo project with rich sample artifacts. Builds a concrete
   * System-transfer instruction (programId = System, from = default-payer,
   * to = stable placeholder) so the tx template + workflow + test suite are
   * actually runnable end-to-end with no further setup.
   */
  async function seedDemoArtifacts(proj: {
    id: string;
    workflows: any[];
    testSuites: any[];
    txTemplates: any[];
    patches: any[];
    sessionIds: string[];
    keypairRefs: string[];
  }): Promise<void> {
    const now = Date.now();
    const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
    // Demo recipient — generate a fresh valid pubkey at seed time. Unique
    // per demo project, no secret persisted (we only need an address).
    const { Keypair: KeypairCtor } = await import('@solana/web3.js');
    const RECIPIENT = KeypairCtor.generate().publicKey.toBase58();

    // Resolve default-payer pubkey (auto-bootstrap step above created it).
    let payerPubkey = RECIPIENT; // fallback so the template still parses
    let payerKeypairId: string | null = null;
    try {
      const keypairs = await ctx.keypairs.list();
      const def = keypairs.find((k) => k.id === proj.keypairRefs[0]);
      if (def) {
        payerPubkey = def.pubkey;
        payerKeypairId = def.id;
      }
    } catch {
      /* keypair store empty — fall through with placeholder */
    }

    // System Transfer instruction encoding:
    //   discriminator u32 LE = 2 (Transfer)
    //   amount       u64 LE
    const encodeSystemTransfer = (lamports: bigint): string => {
      const buf = Buffer.alloc(12);
      buf.writeUInt32LE(2, 0);
      buf.writeBigUInt64LE(lamports, 4);
      return buf.toString('base64');
    };

    const buildTransferIx = (amount: bigint) => ({
      programId: SYSTEM_PROGRAM_ID,
      programLabel: 'system',
      instructionName: 'transfer',
      summary: `transfer ${(Number(amount) / 1e9).toFixed(3)} SOL · payer → recipient`,
      accounts: [
        { pubkey: payerPubkey, isSigner: true, isWritable: true },
        { pubkey: RECIPIENT, isSigner: false, isWritable: true },
      ],
      dataBase64: encodeSystemTransfer(amount),
    });

    // ──────────── Tx Template ────────────
    const transferTemplateId = crypto.randomUUID();
    proj.txTemplates.push({
      id: transferTemplateId,
      name: 'demo: transfer 0.1 SOL',
      description: 'System transfer from default-payer to a stable demo recipient.',
      ixs: [buildTransferIx(100_000_000n)],
      computeUnitLimit: null,
      airdropLamports: null,
      createdAt: now,
      updatedAt: now,
    });

    // ──────────── Workflow ────────────
    proj.workflows.push({
      id: crypto.randomUUID(),
      name: 'demo: fund + transfer + warp',
      description:
        'Airdrop the payer, send 0.1 SOL, jump 1 hour, send again. Exercises tx + warp + blockhash expiry.',
      steps: [
        {
          kind: 'airdrop',
          id: crypto.randomUUID(),
          name: 'fund payer (10 SOL)',
          pubkey: payerPubkey,
          lamports: '10000000000',
        },
        {
          kind: 'tx',
          id: crypto.randomUUID(),
          name: 'transfer 0.1 SOL',
          ixs: [buildTransferIx(100_000_000n)],
          computeUnitLimit: null,
          airdropPayerLamports: null,
          payerKeypairId,
          additionalSignerKeypairIds: [],
          templateId: transferTemplateId,
        },
        {
          kind: 'warpTime',
          id: crypto.randomUUID(),
          name: 'jump 1 hour',
          seconds: 3600,
        },
        {
          kind: 'expireBlockhash',
          id: crypto.randomUUID(),
          name: 'force blockhash refresh',
        },
        {
          kind: 'tx',
          id: crypto.randomUUID(),
          name: 'transfer 0.05 SOL after warp',
          ixs: [buildTransferIx(50_000_000n)],
          computeUnitLimit: null,
          airdropPayerLamports: null,
          payerKeypairId,
          additionalSignerKeypairIds: [],
          templateId: transferTemplateId,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    // ──────────── Test Suite ────────────
    proj.testSuites.push({
      id: crypto.randomUUID(),
      name: 'demo: transfer happy + sad paths',
      description:
        'Covers a healthy transfer, an insufficient-funds rejection, and a warp-clock assertion.',
      cases: [
        {
          id: crypto.randomUUID(),
          name: 'happy path: transfer credits recipient',
          description:
            'Payer airdropped 10 SOL, transfers 0.1 SOL. Recipient must hold ≥ 0.1 SOL after.',
          resetBefore: true,
          steps: [
            {
              kind: 'airdrop',
              id: crypto.randomUUID(),
              name: 'fund payer',
              pubkey: payerPubkey,
              lamports: '10000000000',
            },
            {
              kind: 'tx',
              id: crypto.randomUUID(),
              name: 'transfer 0.1 SOL',
              ixs: [buildTransferIx(100_000_000n)],
              computeUnitLimit: null,
              airdropPayerLamports: null,
              payerKeypairId,
              additionalSignerKeypairIds: [],
              templateId: transferTemplateId,
              txExpectations: [{ kind: 'shouldSucceed', value: true }],
              accountExpectations: [
                {
                  kind: 'lamports',
                  address: RECIPIENT,
                  op: 'ge',
                  value: '100000000',
                },
              ],
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          name: 'sad path: insufficient funds rejected',
          description:
            'Payer airdropped 1 SOL, tries to transfer 1000 SOL. Expect tx failure with funds-related error.',
          resetBefore: true,
          steps: [
            {
              kind: 'airdrop',
              id: crypto.randomUUID(),
              name: 'fund payer (1 SOL only)',
              pubkey: payerPubkey,
              lamports: '1000000000',
            },
            {
              kind: 'tx',
              id: crypto.randomUUID(),
              name: 'attempt overspend',
              ixs: [buildTransferIx(1_000_000_000_000n)],
              computeUnitLimit: null,
              airdropPayerLamports: null,
              payerKeypairId,
              additionalSignerKeypairIds: [],
              templateId: transferTemplateId,
              txExpectations: [
                { kind: 'shouldSucceed', value: false },
                { kind: 'errorMessageContains', substring: 'insufficient' },
              ],
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          name: 'warp moves the clock',
          description: '8-day warp must advance unix_timestamp; recipient must exist after airdrop.',
          resetBefore: true,
          steps: [
            {
              kind: 'airdrop',
              id: crypto.randomUUID(),
              name: 'seed recipient',
              pubkey: RECIPIENT,
              lamports: '500000000',
              accountExpectations: [
                {
                  kind: 'accountExists',
                  address: RECIPIENT,
                  exists: true,
                },
              ],
            },
            {
              kind: 'warpTime',
              id: crypto.randomUUID(),
              name: 'jump 8 days',
              seconds: 8 * 86400,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    // ──────────── Patches ────────────
    // Project-scope patch: pre-fund the demo recipient with 2 SOL on every
    // sandbox open. Demonstrates the "always-on" patch pattern.
    proj.patches.push({
      id: crypto.randomUUID(),
      target: RECIPIENT,
      op: { kind: 'setLamports', lamports: 2_000_000_000n },
      createdAt: now,
      enabled: true,
    });

    // Sandbox-scope patch on the default sandbox: override recipient to 5
    // SOL just for this sandbox. Shows how sandbox patches layer over
    // project patches.
    const defaultSandboxId = proj.sessionIds[0];
    if (defaultSandboxId) {
      try {
        const session = ctx.sessions.get(defaultSandboxId);
        session.sessionPatches.push({
          id: crypto.randomUUID(),
          target: RECIPIENT,
          op: { kind: 'setLamports', lamports: 5_000_000_000n },
          createdAt: now,
          enabled: true,
        });
      } catch {
        /* sandbox missing — skip */
      }
    }
  }

  /**
   * Airdrop SOL to the project's first keypair (default-payer) on session
   * create / first project open. Lets newbies send tx without thinking
   * about funding.
   */
  async function fundDefaultPayer(sessionId: string, keypairRefs: string[]): Promise<void> {
    const defaultId = keypairRefs[0];
    if (!defaultId) return;
    try {
      const all = await ctx.keypairs.list();
      const meta = all.find((k) => k.id === defaultId);
      if (!meta) return;
      await runtime.airdrop(sessionId, meta.pubkey, 100_000_000_000n);
    } catch {
      /* keypair store unavailable or pubkey missing — non-fatal */
    }
  }

  const map: HandlerMap = {
    [IpcMethod.ProjectCreate]: async (p) => {
      const params = p as {
        name: string;
        description?: string;
        network: NetworkId;
        rpcEndpointId: string;
      };
      const project = ctx.projects.create(params);
      await persist();
      return project;
    },

    [IpcMethod.ProjectList]: async () => ctx.projects.list(),

    [IpcMethod.ProjectOpen]: async (p) => {
      const { id } = p as { id: string };
      ctx.projects.touchOpened(id);
      const proj = ctx.projects.get(id);

      // Newbie autobootstrap — runs once on first ever open of a fresh
      // project. Generates a default-payer keypair so tx-builder works
      // immediately; the per-sandbox airdrop below funds it.
      if (proj.keypairRefs.length === 0) {
        try {
          const kp = await ctx.keypairs.generate('default-payer');
          proj.keypairRefs = [kp.id];
        } catch {
          /* keypair store unavailable — non-fatal */
        }
      }

      // Auto-attach the common SVM-builtin programs (System, Token, ATA, etc).
      // They're synthetic entries — no RPC clone, no ELF bytes — so adding
      // them is essentially free and saves the newbie six clicks.
      if (Object.keys(proj.programs).length === 0) {
        const COMMON_BUILTINS = [
          '11111111111111111111111111111111', // System
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
          'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
          'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // ATA
          'ComputeBudget111111111111111111111111111111',
          'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo v2
        ];
        for (const pid of COMMON_BUILTINS) {
          if (proj.programs[pid] || !isBuiltinProgram(pid)) continue;
          const descriptor = BUILTIN_PROGRAM_LIST.find((b) => b.programId === pid);
          try {
            const blobHash = await ctx.blobs.put(new Uint8Array(0));
            ctx.projects.addProgram({
              projectId: id,
              programId: pid,
              elfBlobHash: blobHash,
              source: { kind: 'cloned', slot: 0n },
              upgradeAuthority: null,
              clonedAtSlot: 0n,
              label: descriptor?.label,
            });
          } catch {
            /* duplicate / store error — non-fatal */
          }
        }
      }

      // Auto-create a default sandbox on first open so newbies don't have to
      // manually create one before doing anything. Idempotent: skips if any
      // session already exists for this project.
      if (proj.sessionIds.length === 0) {
        const session = ctx.sessions.create({ projectId: id, name: 'default' });
        proj.sessionIds = [session.id];
        await fundDefaultPayer(session.id, proj.keypairRefs);
      }

      // Demo project: seed a sample tx template, workflow, test suite, and
      // patches so the user sees working examples of every feature. Only
      // runs on a fresh demo — keyed off the project name written by
      // `app.newDemoProject`.
      if (
        proj.name === 'Relay Demo' &&
        (proj.workflows?.length ?? 0) === 0 &&
        (proj.testSuites?.length ?? 0) === 0 &&
        (proj.txTemplates?.length ?? 0) === 0
      ) {
        await seedDemoArtifacts(proj);
      }

      await persist();
      return ctx.projects.get(id);
    },

    [IpcMethod.ProjectRename]: async (p) => {
      const { id, name } = p as { id: string; name: string };
      const project = ctx.projects.rename(id, name);
      await persist();
      return project;
    },

    [IpcMethod.ProjectDelete]: async (p) => {
      const { id } = p as { id: string };
      ctx.sessions.deleteByProject(id);
      ctx.projects.delete(id);
      await persist();
      return { ok: true };
    },

    // Re-read the project state from disk. Used after external edits
    // (Files mode save, .relay/ folder changes detected by the watcher).
    [IpcMethod.ProjectReload]: async () => {
      await ctx.load();
      const first = ctx.projects.exportAll()[0];
      return first ?? null;
    },

    [IpcMethod.SessionCreate]: async (p) => {
      const { projectId, name } = p as { projectId: string; name: string };
      const project = ctx.projects.get(projectId);
      const session = ctx.sessions.create({ projectId, name });
      project.sessionIds = [...project.sessionIds, session.id];
      await fundDefaultPayer(session.id, project.keypairRefs);
      await persist();
      return session;
    },

    [IpcMethod.SessionList]: async (p) => {
      const params = (p ?? {}) as { projectId?: string };
      return ctx.sessions.list(params.projectId);
    },

    [IpcMethod.SessionOpen]: async (p) => {
      const { id } = p as { id: string };
      return ctx.sessions.get(id);
    },

    [IpcMethod.SessionRename]: async (p) => {
      const { id, name } = p as { id: string; name: string };
      const s = ctx.sessions.rename(id, name);
      await persist();
      return s;
    },

    [IpcMethod.SessionAirdrop]: async (p) => {
      const { sessionId, pubkey, lamports } = p as {
        sessionId: string;
        pubkey: string;
        lamports: string | number | bigint;
      };
      await runtime.airdrop(sessionId, pubkey, BigInt(lamports.toString()));
      return { ok: true };
    },

    [IpcMethod.RpcServerStart]: async (p) => {
      const { port } = (p ?? {}) as { port?: number };
      if (!solanaRpc) solanaRpc = new SolanaRpcServer(ctx, runtime);
      const r = await solanaRpc.start(port ?? 8899);
      return { ok: true, ...r };
    },

    [IpcMethod.RpcServerStop]: async () => {
      if (solanaRpc) {
        await solanaRpc.stop();
      }
      return { ok: true };
    },

    [IpcMethod.RpcServerStatus]: async () => {
      if (!solanaRpc) return { running: false, port: null, host: null };
      const addr = solanaRpc.address();
      return { running: solanaRpc.isRunning(), ...(addr ?? { port: null, host: null }) };
    },

    [IpcMethod.SessionWarpToSlot]: async (p) => {
      const { sessionId, slot } = p as {
        sessionId: string;
        slot: string | number | bigint;
      };
      await runtime.warpToSlot(sessionId, BigInt(slot.toString()));
      return { ok: true };
    },

    [IpcMethod.SessionWarpByTime]: async (p) => {
      const { sessionId, seconds } = p as { sessionId: string; seconds: number };
      const { newSlot } = await runtime.warpByTime(sessionId, seconds);
      return { ok: true, newSlot: newSlot.toString() };
    },

    [IpcMethod.SessionExpireBlockhash]: async (p) => {
      const { sessionId } = p as { sessionId: string };
      await runtime.expireBlockhash(sessionId);
      return { ok: true };
    },

    [IpcMethod.SessionGetClock]: async (p) => {
      const { sessionId } = p as { sessionId: string };
      return runtime.getClock(sessionId);
    },

    [IpcMethod.SessionGetVersionPins]: async (p) => {
      const { sessionId } = p as { sessionId: string };
      const s = ctx.sessions.get(sessionId);
      return s.programVersionOverrides ?? {};
    },

    [IpcMethod.SessionReset]: async (p) => {
      const { id } = p as { id: string };
      const s = ctx.sessions.reset(id);
      runtime.invalidate(id);
      await persist();
      return s;
    },

    [IpcMethod.SessionDelete]: async (p) => {
      const { id } = p as { id: string };
      const session = ctx.sessions.get(id);
      const project = ctx.projects.get(session.projectId);
      project.sessionIds = project.sessionIds.filter((sid) => sid !== id);
      ctx.sessions.delete(id);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramAdd]: async (p) => {
      const params = p as {
        projectId: string;
        programId: string;
        rpcUrl?: string;
        slot?: string;
      };
      const project = ctx.projects.get(params.projectId);

      // SVM-builtin: skip RPC clone, register synthetic entry with empty ELF.
      if (isBuiltinProgram(params.programId)) {
        const descriptor = BUILTIN_PROGRAM_LIST.find((b) => b.programId === params.programId);
        const blobHash = await ctx.blobs.put(new Uint8Array(0));
        if (!project.programs[params.programId]) {
          ctx.projects.addProgram({
            projectId: project.id,
            programId: params.programId,
            elfBlobHash: blobHash,
            source: { kind: 'cloned', slot: 0n },
            upgradeAuthority: null,
            clonedAtSlot: 0n,
            label: descriptor?.label,
          });
        }
        await persist();
        return project.programs[params.programId];
      }

      const rpcUrl = params.rpcUrl ?? env.resolveRpcUrl(project.rpcEndpointId);
      const cloner = new Cloner(rpcUrl, { network: project.network });
      const cloned = await cloner.cloneProgram(
        new PublicKey(params.programId),
        params.slot ? BigInt(params.slot) : undefined,
      );
      const blobHash = await ctx.blobs.put(cloned.elf);
      // Idempotent: if program already exists, treat as refresh (update ELF + metadata, keep accounts)
      const existing = project.programs[params.programId];
      if (existing) {
        existing.elfBlobHash = blobHash;
        existing.source = { kind: 'cloned', slot: cloned.slot };
        existing.upgradeAuthority = cloned.upgradeAuthority?.toBase58() ?? null;
        existing.clonedAtSlot = cloned.slot;
        // Invalidate any open sessions in this project — ELF changed
        for (const sid of project.sessionIds) runtime.invalidate(sid);
      } else {
        ctx.projects.addProgram({
          projectId: project.id,
          programId: params.programId,
          elfBlobHash: blobHash,
          source: { kind: 'cloned', slot: cloned.slot },
          upgradeAuthority: cloned.upgradeAuthority?.toBase58() ?? null,
          clonedAtSlot: cloned.slot,
        });
      }
      // Try to fetch the Anchor IDL straight from chain + auto-attach. Silent
      // on failure — many programs don't publish an IDL onchain. Skipped if
      // an IDL is already attached for this program (manual or prior fetch).
      const existingIdl = await ctx.idls.get(params.programId).catch(() => null);
      if (!existingIdl) {
        const onchain = await fetchOnchainIdl(params.programId, rpcUrl);
        if (onchain) {
          try {
            await ctx.idls.attach(params.programId, onchain, 'onChain');
          } catch {
            /* attach failure non-fatal */
          }
        }
      }
      await persist();
      return project.programs[params.programId];
    },

    [IpcMethod.ProgramAddLocal]: async (p) => {
      const params = p as {
        projectId: string;
        programId: string;
        label?: string;
        bytesBase64: string;
        filePath?: string;
      };
      const project = ctx.projects.get(params.projectId);
      const bytes = new Uint8Array(Buffer.from(params.bytesBase64, 'base64'));
      const blobHash = await ctx.blobs.put(bytes);
      const source = { kind: 'localFile' as const, path: params.filePath ?? `(dropped:${params.label ?? params.programId})` };
      const existing = project.programs[params.programId];
      if (existing) {
        // Treat as new version on the existing program.
        const v = ctx.projects.addProgramVersion(params.projectId, params.programId, {
          label: params.label ?? `local-${Date.now()}`,
          elfBlobHash: blobHash,
          source,
        });
        await persist();
        return { kind: 'versionAdded', programId: params.programId, versionId: v.id };
      }
      ctx.projects.addProgram({
        projectId: project.id,
        programId: params.programId,
        elfBlobHash: blobHash,
        source,
        upgradeAuthority: null,
        clonedAtSlot: null,
        label: params.label,
      });
      await persist();
      return { kind: 'programAdded', programId: params.programId };
    },

    [IpcMethod.ProgramListBuiltins]: async () => BUILTIN_PROGRAM_LIST,

    [IpcMethod.ProgramListInstructions]: async (p) => {
      const { programId } = p as { programId: string };
      const idl = await ctx.idls.get(programId);
      if (!idl) {
        const native = listNativeInstructions(programId);
        if (native.length > 0) {
          return {
            hasIdl: false,
            source: 'native' as const,
            idlName: programId,
            instructions: native.map((ix) => ({
              name: ix.name,
              docs: ix.docs ? [ix.docs] : null,
              args: ix.args.map((a) => ({ name: a.name, type: a.type })),
              accounts: ix.accounts.map((acc) => ({
                name: acc.name,
                isWritable: acc.isWritable,
                isSigner: acc.isSigner,
                optional: acc.optional ?? false,
                docs: acc.docs ? [acc.docs] : null,
              })),
            })),
          };
        }
        return { hasIdl: false, source: 'none' as const, instructions: [] };
      }
      const instructions = (idl.instructions ?? []).map((ix) => ({
        name: ix.name,
        docs: ix.docs ?? null,
        args: (ix.args ?? []).map((a) => ({ name: a.name, type: a.type })),
        accounts: (ix.accounts ?? []).map((acc) => {
          const accAny = acc as {
            name: string;
            writable?: boolean;
            signer?: boolean;
            isMut?: boolean;
            isSigner?: boolean;
            optional?: boolean;
            docs?: string[];
          };
          return {
            name: accAny.name,
            isWritable: accAny.writable ?? accAny.isMut ?? false,
            isSigner: accAny.signer ?? accAny.isSigner ?? false,
            optional: accAny.optional ?? false,
            docs: accAny.docs ?? null,
          };
        }),
      }));
      return { hasIdl: true, source: 'anchor' as const, idlName: idl.metadata?.name ?? programId, instructions };
    },

    [IpcMethod.TxDecodeIx]: async (p) => {
      const { programId, dataBase64 } = p as { programId: string; dataBase64: string };
      const data = Buffer.from(dataBase64, 'base64');
      const idl = await ctx.idls.get(programId);
      if (idl) {
        const coder = new BorshInstructionCoder(idl);
        const decoded = coder.decode(data);
        if (decoded) {
          const idlIx = (idl.instructions ?? []).find((ix) => ix.name === decoded.name);
          const accountNames: string[] = idlIx
            ? (idlIx.accounts ?? []).map((acc) => {
                const a = acc as { name: string };
                return a.name;
              })
            : [];
          return {
            source: 'anchor' as const,
            name: decoded.name,
            args: serializeDecoded(decoded.data) as Record<string, unknown>,
            accountNames,
          };
        }
      }
      // Fall back to native registry
      const nativeDecoded = decodeNativeIx(programId, new Uint8Array(data));
      if (nativeDecoded) {
        const accountNames =
          (nativeDecoded as { accountNames?: string[] }).accountNames ?? [];
        return {
          source: 'native' as const,
          name: nativeDecoded.name,
          args: nativeDecoded.args,
          accountNames,
        };
      }
      return { source: 'none' as const, name: null, args: null, accountNames: [] };
    },

    [IpcMethod.TxEncodeIx]: async (p) => {
      const { programId, name, args } = p as {
        programId: string;
        name: string;
        args: Record<string, unknown>;
      };
      const idl = await ctx.idls.get(programId);
      if (idl) {
        const coder = new BorshInstructionCoder(idl);
        const data = coder.encode(name, args);
        return {
          dataBase64: Buffer.from(data).toString('base64'),
          dataHex: Buffer.from(data).toString('hex'),
          source: 'anchor' as const,
        };
      }
      if (findNativeInstruction(programId, name)) {
        const data = encodeNativeIx(programId, name, args);
        return {
          dataBase64: Buffer.from(data).toString('base64'),
          dataHex: Buffer.from(data).toString('hex'),
          source: 'native' as const,
        };
      }
      throw new RelayError(
        ErrorCode.INVALID_INPUT,
        `no IDL attached and no native instruction "${name}" for ${programId}`,
      );
    },

    [IpcMethod.ProgramList]: async (p) => {
      const { projectId } = p as { projectId: string };
      const project = ctx.projects.get(projectId);
      return Object.values(project.programs);
    },

    [IpcMethod.ProgramSetLabel]: async (p) => {
      const { projectId, programId, label } = p as {
        projectId: string;
        programId: string;
        label: string;
      };
      ctx.projects.setProgramLabel(projectId, programId, label);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramVersionList]: async (p) => {
      const { projectId, programId } = p as { projectId: string; programId: string };
      const project = ctx.projects.get(projectId);
      const prog = project.programs[programId];
      if (!prog) throw new Error(`program not in project: ${programId}`);
      return { versions: prog.versions, activeVersionId: prog.activeVersionId };
    },

    [IpcMethod.ProgramVersionAdd]: async (p) => {
      const params = p as {
        projectId: string;
        programId: string;
        label: string;
        idlId?: string | null;
        notes?: string;
        // Exactly one of these source kinds:
        fromRpc?: { rpcUrl?: string; slot?: string };
        fromFile?: { path: string };
        fromBlob?: { hash: string };
      };
      const project = ctx.projects.get(params.projectId);

      let blobHash: string;
      let source: { kind: 'cloned'; slot: bigint } | { kind: 'localFile'; path: string };

      if (params.fromRpc) {
        const rpcUrl = params.fromRpc.rpcUrl ?? env.resolveRpcUrl(project.rpcEndpointId);
        const cloner = new Cloner(rpcUrl, { network: project.network });
        const cloned = await cloner.cloneProgram(
          new PublicKey(params.programId),
          params.fromRpc.slot ? BigInt(params.fromRpc.slot) : undefined,
        );
        blobHash = await ctx.blobs.put(cloned.elf);
        source = { kind: 'cloned', slot: cloned.slot };
      } else if (params.fromFile) {
        const fs = await import('node:fs/promises');
        const bytes = await fs.readFile(params.fromFile.path);
        blobHash = await ctx.blobs.put(new Uint8Array(bytes));
        source = { kind: 'localFile', path: params.fromFile.path };
      } else if (params.fromBlob) {
        if (!(await ctx.blobs.has(params.fromBlob.hash))) {
          throw new Error(`blob not found: ${params.fromBlob.hash}`);
        }
        blobHash = params.fromBlob.hash;
        source = { kind: 'localFile', path: `(blob:${params.fromBlob.hash.slice(0, 12)}…)` };
      } else {
        throw new Error('program.versionAdd requires fromRpc, fromFile, or fromBlob');
      }

      const version = ctx.projects.addProgramVersion(params.projectId, params.programId, {
        label: params.label,
        elfBlobHash: blobHash,
        source,
        ...(params.idlId !== undefined && { idlId: params.idlId }),
        ...(params.notes !== undefined && { notes: params.notes }),
      });
      await persist();
      return version;
    },

    [IpcMethod.ProgramVersionRemove]: async (p) => {
      const { projectId, programId, versionId } = p as {
        projectId: string;
        programId: string;
        versionId: string;
      };
      ctx.projects.removeProgramVersion(projectId, programId, versionId);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramVersionSetActive]: async (p) => {
      const { projectId, programId, versionId } = p as {
        projectId: string;
        programId: string;
        versionId: string;
      };
      ctx.projects.setActiveProgramVersion(projectId, programId, versionId);
      // Active ELF for the program changed — drop cached SVMs so the next op
      // re-binds the new bytes.
      const project = ctx.projects.get(projectId);
      for (const sid of project.sessionIds) runtime.invalidate(sid);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramVersionSetLabel]: async (p) => {
      const { projectId, programId, versionId, label } = p as {
        projectId: string;
        programId: string;
        versionId: string;
        label: string;
      };
      ctx.projects.setProgramVersionLabel(projectId, programId, versionId, label);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramVersionPinForSession]: async (p) => {
      const { sessionId, programId, versionId } = p as {
        sessionId: string;
        programId: string;
        versionId: string | null;
      };
      ctx.sessions.pinProgramVersion(sessionId, programId, versionId);
      runtime.invalidate(sessionId);
      await persist();
      return { ok: true };
    },

    [IpcMethod.AccountSetLabel]: async (p) => {
      const { projectId, address, label } = p as {
        projectId: string;
        address: string;
        label: string;
      };
      ctx.projects.setAccountLabel(projectId, address, label);
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProgramRemove]: async (p) => {
      const { projectId, programId } = p as { projectId: string; programId: string };
      ctx.projects.removeProgram(projectId, programId);
      await persist();
      return { ok: true };
    },

    [IpcMethod.AccountAdd]: async (p) => {
      const params = p as {
        projectId: string;
        programId: string;
        address: string;
        label?: string;
        rpcUrl?: string;
        slot?: string;
      };
      const project = ctx.projects.get(params.projectId);
      const rpcUrl = params.rpcUrl ?? env.resolveRpcUrl(project.rpcEndpointId);
      const cloner = new Cloner(rpcUrl, { network: project.network });
      const cloned = await cloner.cloneAccount(
        new PublicKey(params.address),
        params.slot ? BigInt(params.slot) : undefined,
      );
      const blobHash = await ctx.blobs.put(new Uint8Array(cloned.account.data));
      ctx.projects.addAccount({
        projectId: project.id,
        programId: params.programId,
        address: params.address,
        ...(params.label !== undefined && { label: params.label }),
        blobHash,
        source: 'cloned',
        clonedAtSlot: cloned.slot,
      });
      await persist();
      const prog = project.programs[params.programId];
      if (!prog) {
        throw new RelayError(ErrorCode.NOT_FOUND, `program not in project: ${params.programId}`);
      }
      return prog.accounts.find((a) => a.address === params.address);
    },

    [IpcMethod.AccountList]: async (p) => {
      const { projectId, programId } = p as { projectId: string; programId?: string };
      const project = ctx.projects.get(projectId);
      if (programId) {
        const prog = project.programs[programId];
        return prog ? prog.accounts : [];
      }
      return Object.values(project.programs).flatMap((prog) => prog.accounts);
    },

    [IpcMethod.AddressDeriveAta]: async (p) => {
      const { owner, mint, tokenProgram } = p as {
        owner: string;
        mint: string;
        tokenProgram?: string;
      };
      const tp = new PublicKey(tokenProgram ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const ata = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
      const [address] = PublicKey.findProgramAddressSync(
        [new PublicKey(owner).toBuffer(), tp.toBuffer(), new PublicKey(mint).toBuffer()],
        ata,
      );
      return { address: address.toBase58() };
    },

    [IpcMethod.AddressDerivePda]: async (p) => {
      const { programId, seeds } = p as {
        programId: string;
        seeds: Array<{ kind: 'pubkey' | 'utf8' | 'hex' | 'u8' | 'u32' | 'u64'; value: string }>;
      };
      const seedBuffers: Buffer[] = seeds.map((s) => {
        switch (s.kind) {
          case 'pubkey':
            return new PublicKey(s.value).toBuffer();
          case 'utf8':
            return Buffer.from(s.value, 'utf8');
          case 'hex': {
            const clean = s.value.startsWith('0x') ? s.value.slice(2) : s.value;
            return Buffer.from(clean, 'hex');
          }
          case 'u8': {
            const buf = Buffer.alloc(1);
            buf.writeUInt8(Number(s.value), 0);
            return buf;
          }
          case 'u32': {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(Number(s.value), 0);
            return buf;
          }
          case 'u64': {
            const buf = Buffer.alloc(8);
            buf.writeBigUInt64LE(BigInt(s.value), 0);
            return buf;
          }
        }
      });
      const [address, bump] = PublicKey.findProgramAddressSync(seedBuffers, new PublicKey(programId));
      return { address: address.toBase58(), bump };
    },

    [IpcMethod.AccountRemove]: async (p) => {
      const { projectId, address } = p as { projectId: string; address: string };
      ctx.projects.removeAccount(projectId, address);
      await persist();
      return { ok: true };
    },

    [IpcMethod.PatchCreate]: async (p) => {
      const params = p as {
        scope: PatchScope;
        scopeId: string;
        target: string;
        op: unknown;
        enabled?: boolean;
      };
      const id = crypto.randomUUID();
      const patch = {
        id,
        target: params.target,
        op: params.op as never,
        createdAt: Date.now(),
        enabled: params.enabled ?? true,
      };
      if (params.scope === 'project') {
        const project = ctx.projects.get(params.scopeId);
        project.patches.push(patch);
        for (const sid of project.sessionIds) runtime.invalidate(sid);
      } else {
        const session = ctx.sessions.get(params.scopeId);
        session.sessionPatches.push(patch);
        runtime.invalidate(params.scopeId);
      }
      await persist();
      return patch;
    },

    [IpcMethod.PatchList]: async (p) => {
      const { scope, scopeId } = p as { scope: PatchScope; scopeId: string };
      if (scope === 'project') return ctx.projects.get(scopeId).patches;
      return ctx.sessions.get(scopeId).sessionPatches;
    },

    [IpcMethod.PatchToggle]: async (p) => {
      const { scope, scopeId, patchId, enabled } = p as {
        scope: PatchScope;
        scopeId: string;
        patchId: string;
        enabled: boolean;
      };
      const list =
        scope === 'project'
          ? ctx.projects.get(scopeId).patches
          : ctx.sessions.get(scopeId).sessionPatches;
      const patch = list.find((x) => x.id === patchId);
      if (!patch) throw new RelayError(ErrorCode.NOT_FOUND, `patch not found: ${patchId}`);
      patch.enabled = enabled;
      await persist();
      return patch;
    },

    [IpcMethod.IdlAttach]: async (p) => {
      const { programId, idl, versionId } = p as {
        programId: string;
        idl: Idl;
        versionId?: string | null;
      };
      return ctx.idls.attach(programId, idl, 'manual', versionId ?? null);
    },

    [IpcMethod.IdlFetchOnchain]: async (p) => {
      const { projectId, programId, rpcUrl } = p as {
        projectId: string;
        programId: string;
        rpcUrl?: string;
      };
      const project = ctx.projects.get(projectId);
      const url = rpcUrl ?? env.resolveRpcUrl(project.rpcEndpointId);
      const idl = await fetchOnchainIdl(programId, url);
      if (!idl) return { found: false };
      await ctx.idls.attach(programId, idl, 'onChain');
      return { found: true, idl };
    },

    [IpcMethod.IdlDetach]: async (p) => {
      const { programId, versionId } = p as { programId: string; versionId?: string | null };
      await ctx.idls.detach(programId, versionId ?? null);
      return { ok: true };
    },

    [IpcMethod.IdlList]: async () => ctx.idls.list(),

    [IpcMethod.IdlDiff]: async (p) => {
      const { left, right } = p as { left: import('@coral-xyz/anchor').Idl; right: import('@coral-xyz/anchor').Idl };
      return diffIdl(left, right);
    },

    [IpcMethod.IdlDiffPrograms]: async (p) => {
      const { leftProgramId, rightProgramId } = p as {
        leftProgramId: string;
        rightProgramId: string;
      };
      const left = await ctx.idls.get(leftProgramId);
      const right = await ctx.idls.get(rightProgramId);
      if (!left) throw new Error(`no IDL attached for ${leftProgramId}`);
      if (!right) throw new Error(`no IDL attached for ${rightProgramId}`);
      return diffIdl(left, right);
    },

    [IpcMethod.AccountDecode]: async (p) => {
      const { projectId, address, sessionId, versionId } = p as {
        projectId: string;
        address: string;
        sessionId?: string;
        versionId?: string;
      };
      const project = ctx.projects.get(projectId);
      // Locate the AccountEntry + owning program
      let entryProgramId: string | null = null;
      for (const [pid, prog] of Object.entries(project.programs)) {
        if (prog.accounts.some((a) => a.address === address)) {
          entryProgramId = pid;
          break;
        }
      }
      if (!entryProgramId) {
        throw new RelayError(ErrorCode.NOT_FOUND, `account not in project: ${address}`);
      }
      const accountEntry = project.programs[entryProgramId]?.accounts.find(
        (a) => a.address === address,
      );
      if (!accountEntry) {
        throw new RelayError(ErrorCode.NOT_FOUND, `account entry missing: ${address}`);
      }
      const data = await ctx.blobs.get(accountEntry.blobHash);
      if (!data) {
        throw new RelayError(
          ErrorCode.CACHE_IO_FAILURE,
          `account blob missing: ${accountEntry.blobHash}`,
        );
      }
      const rawBase64 = Buffer.from(data).toString('base64');
      // Resolve which program version's IDL applies:
      //   explicit `versionId` > session pin override > project active version
      let resolvedVersionId: string | null = versionId ?? null;
      if (!resolvedVersionId && sessionId) {
        try {
          const session = ctx.sessions.get(sessionId);
          resolvedVersionId = session.programVersionOverrides?.[entryProgramId] ?? null;
        } catch {
          /* missing session — ignore */
        }
      }
      if (!resolvedVersionId) {
        resolvedVersionId = project.programs[entryProgramId]?.activeVersionId ?? null;
      }
      const idlPrimary = await ctx.idls.get(entryProgramId, resolvedVersionId);
      if (idlPrimary) {
        const coder = new AnchorCoder(idlPrimary);
        const decoded = coder.decodeAny(Buffer.from(data));
        if (decoded) {
          return {
            address,
            programId: entryProgramId,
            accountName: decoded.name,
            value: serializeDecoded(decoded.value),
            dataLen: data.length,
            decoder: 'anchor',
            raw: rawBase64,
          };
        }
      }
      // Fall back to native layouts (SPL Token, Token-2022, …)
      const nativeLayout = resolveLayout(entryProgramId, data.length);
      if (nativeLayout) {
        const value = decodeNative(data, nativeLayout);
        return {
          address,
          programId: entryProgramId,
          accountName: nativeLayout.name,
          value: serializeDecoded(value),
          dataLen: data.length,
          decoder: 'native',
          editableFields: nativeLayout.fields.map((f) => ({ name: f.name, type: f.type })),
          raw: rawBase64,
        };
      }
      return {
        address,
        programId: entryProgramId,
        accountName: null,
        value: null,
        dataLen: data.length,
        raw: rawBase64,
        decoder: null,
      };
    },

    [IpcMethod.TxBuild]: async (p) => {
      const params = p as {
        sessionId: string;
        payer: string;
        ixs: InstructionSpec[];
        computeUnitLimit?: number;
        computeUnitPrice?: number;
      };
      const recentBlockhash = await runtime.latestBlockhash(params.sessionId);
      const tx = buildTransaction({
        payer: params.payer,
        ixs: params.ixs,
        recentBlockhash,
        ...(params.computeUnitLimit !== undefined && {
          computeUnitLimit: params.computeUnitLimit,
        }),
        ...(params.computeUnitPrice !== undefined && {
          computeUnitPrice: params.computeUnitPrice,
        }),
      });
      return {
        txBase64: Buffer.from(tx.serialize()).toString('base64'),
        recentBlockhash,
        messageBytes: Buffer.from(tx.message.serialize()).toString('base64'),
      };
    },

    [IpcMethod.TxSend]: async (p) => {
      const params = p as {
        sessionId: string;
        txBase64?: string;
        build?: {
          payer: string;
          ixs: InstructionSpec[];
          signers: SignerInput[];
          computeUnitLimit?: number;
          computeUnitPrice?: number;
          airdropPayer?: bigint | string | number;
          payerKeypairId?: string | null;
          additionalSignerKeypairIds?: string[];
        };
      };
      const session = ctx.sessions.get(params.sessionId);
      let txBytes: Uint8Array;

      if (params.txBase64) {
        txBytes = new Uint8Array(Buffer.from(params.txBase64, 'base64'));
      } else if (params.build) {
        let b = params.build;
        // Vault keypair payer: pull secret from KeypairStore.
        if (b.payerKeypairId) {
          const secret = await ctx.keypairs.exportSecretKey(b.payerKeypairId);
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.fromSecretKey(secret);
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        }
        // Ephemeral payer: replace AUTO with a fresh keypair
        else if (b.payer === 'AUTO' || b.signers.some((s) => s.pubkey === 'AUTO')) {
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.generate();
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        }
        if (b.additionalSignerKeypairIds && b.additionalSignerKeypairIds.length > 0) {
          const { Keypair } = await import('@solana/web3.js');
          const have = new Set(b.signers.map((s) => s.pubkey));
          const extras: SignerInput[] = [];
          for (const id of b.additionalSignerKeypairIds) {
            const secret = await ctx.keypairs.exportSecretKey(id);
            const kp = Keypair.fromSecretKey(secret);
            const pub = kp.publicKey.toBase58();
            if (have.has(pub)) continue;
            have.add(pub);
            extras.push({ pubkey: pub, secretKey: Array.from(kp.secretKey) });
          }
          b = { ...b, signers: [...b.signers, ...extras] };
        }
        if (b.airdropPayer !== undefined) {
          const lamports = BigInt(b.airdropPayer.toString());
          await runtime.airdrop(params.sessionId, b.payer, lamports);
        }
        // Force a fresh blockhash so re-running the same payload doesn't hit AlreadyProcessed.
        await runtime.expireBlockhash(params.sessionId);
        const recentBlockhash = await runtime.latestBlockhash(params.sessionId);
        const tx = buildTransaction({
          payer: b.payer,
          ixs: b.ixs,
          recentBlockhash,
          ...(b.computeUnitLimit !== undefined && { computeUnitLimit: b.computeUnitLimit }),
          ...(b.computeUnitPrice !== undefined && { computeUnitPrice: b.computeUnitPrice }),
        });
        signTransaction(tx, b.signers);
        txBytes = tx.serialize();
      } else {
        throw new RelayError(ErrorCode.INVALID_INPUT, 'tx.send requires txBase64 or build');
      }

      const result = await runtime.sendTransaction(params.sessionId, txBytes);
      const trace = parseTrace(result.logs);
      const rawTxBase64 = Buffer.from(txBytes).toString('base64');
      const record = {
        id: crypto.randomUUID(),
        signature: null,
        submittedAt: Date.now(),
        success: result.success,
        errorMessage: result.errorMessage,
        cuConsumed: result.cuConsumed,
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
        rawTxBase64,
      };
      session.txHistory.push(record);
      await persist();
      return {
        success: result.success,
        errorMessage: result.errorMessage,
        cuConsumed: result.cuConsumed,
        returnData: result.returnData ? Buffer.from(result.returnData).toString('base64') : null,
        logs: result.logs,
        trace,
        recordId: record.id,
      };
    },

    [IpcMethod.TxTemplateSave]: async (p) => {
      const params = p as {
        projectId: string;
        id?: string;
        name: string;
        description?: string;
        ixs: Array<{
          programId: string;
          programLabel: string;
          instructionName: string;
          summary: string;
          accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
          dataBase64: string;
        }>;
        computeUnitLimit?: number | null;
        airdropLamports?: string | null;
      };
      const project = ctx.projects.get(params.projectId);
      const now = Date.now();
      const existing = params.id
        ? project.txTemplates.find((t) => t.id === params.id)
        : undefined;
      if (existing) {
        existing.name = params.name;
        existing.description = params.description ?? '';
        existing.ixs = params.ixs;
        existing.computeUnitLimit = params.computeUnitLimit ?? null;
        existing.airdropLamports = params.airdropLamports ?? null;
        existing.updatedAt = now;
        await persist();
        return existing;
      }
      const tpl = {
        id: crypto.randomUUID(),
        name: params.name,
        description: params.description ?? '',
        ixs: params.ixs,
        computeUnitLimit: params.computeUnitLimit ?? null,
        airdropLamports: params.airdropLamports ?? null,
        createdAt: now,
        updatedAt: now,
      };
      project.txTemplates.push(tpl);
      await persist();
      return tpl;
    },

    [IpcMethod.TxTemplateList]: async (p) => {
      const { projectId } = p as { projectId: string };
      return ctx.projects.get(projectId).txTemplates;
    },

    [IpcMethod.ProjectFolderCreate]: async (p) => {
      const { projectId, section, name, parentId } = p as {
        projectId: string;
        section: 'programs' | 'templates' | 'workflows' | 'testSuites' | 'patches';
        name: string;
        parentId?: string | null;
      };
      const project = ctx.projects.get(projectId);
      if (!project.folders) project.folders = [];
      const folder = {
        id: crypto.randomUUID(),
        name: name.trim() || 'New folder',
        parentId: parentId ?? null,
        section,
        createdAt: Date.now(),
      };
      project.folders.push(folder);
      await persist();
      return folder;
    },

    [IpcMethod.ProjectFolderRename]: async (p) => {
      const { projectId, folderId, name } = p as {
        projectId: string;
        folderId: string;
        name: string;
      };
      const project = ctx.projects.get(projectId);
      const f = (project.folders ?? []).find((x) => x.id === folderId);
      if (!f) throw new RelayError(ErrorCode.NOT_FOUND, `folder not found: ${folderId}`);
      f.name = name.trim() || f.name;
      await persist();
      return f;
    },

    [IpcMethod.ProjectFolderRemove]: async (p) => {
      const { projectId, folderId, mode } = p as {
        projectId: string;
        folderId: string;
        mode?: 'merge-up' | 'recursive';
      };
      const project = ctx.projects.get(projectId);
      const folders = project.folders ?? [];
      const target = folders.find((f) => f.id === folderId);
      if (!target) return { ok: true };
      // Gather descendants
      const descendantIds = new Set<string>([folderId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const f of folders) {
          if (f.parentId && descendantIds.has(f.parentId) && !descendantIds.has(f.id)) {
            descendantIds.add(f.id);
            changed = true;
          }
        }
      }
      const recursive = mode === 'recursive';
      const detachIn = (collection: Array<{ folderId?: string | null }>, ids: Set<string>): void => {
        for (const it of collection) {
          if (it.folderId && ids.has(it.folderId)) it.folderId = null;
        }
      };
      const itemsForSection = (sec: string): Array<{ folderId?: string | null }> => {
        switch (sec) {
          case 'templates':
            return project.txTemplates as Array<{ folderId?: string | null }>;
          case 'programs':
            return Object.values(project.programs) as Array<{ folderId?: string | null }>;
          case 'workflows':
            return project.workflows as Array<{ folderId?: string | null }>;
          case 'testSuites':
            return project.testSuites as Array<{ folderId?: string | null }>;
          case 'patches':
            return project.patches as Array<{ folderId?: string | null }>;
          default:
            return [];
        }
      };
      const items = itemsForSection(target.section);
      if (recursive) {
        detachIn(items, descendantIds);
        project.folders = folders.filter((f) => !descendantIds.has(f.id));
      } else {
        for (const it of items) {
          if (it.folderId === folderId) it.folderId = target.parentId;
        }
        for (const f of folders) {
          if (f.parentId === folderId) f.parentId = target.parentId;
        }
        project.folders = folders.filter((f) => f.id !== folderId);
      }
      await persist();
      return { ok: true };
    },

    [IpcMethod.ProjectItemMove]: async (p) => {
      const { projectId, kind, id, folderId } = p as {
        projectId: string;
        kind: 'template' | 'program' | 'workflow' | 'testSuite' | 'patch';
        id: string;
        folderId: string | null;
      };
      const project = ctx.projects.get(projectId);
      let target: { folderId?: string | null } | undefined;
      switch (kind) {
        case 'template':
          target = project.txTemplates.find((t) => t.id === id);
          break;
        case 'program':
          target = project.programs[id];
          break;
        case 'workflow':
          target = project.workflows.find((w) => w.id === id);
          break;
        case 'testSuite':
          target = project.testSuites.find((s) => s.id === id);
          break;
        case 'patch':
          target = project.patches.find((p2) => p2.id === id);
          break;
      }
      if (!target) throw new RelayError(ErrorCode.NOT_FOUND, `${kind} not found: ${id}`);
      target.folderId = folderId;
      await persist();
      return { ok: true };
    },

    [IpcMethod.TxHistoryToTemplate]: async (p) => {
      const params = p as {
        sessionId: string;
        recordId: string;
        name: string;
        description?: string;
      };
      const session = ctx.sessions.get(params.sessionId);
      const record = session.txHistory.find((r) => r.id === params.recordId);
      if (!record) throw new RelayError(ErrorCode.NOT_FOUND, `tx record not found: ${params.recordId}`);
      if (!record.rawTxBase64) {
        throw new RelayError(
          ErrorCode.INVALID_INPUT,
          'this tx record was created before raw bytes were captured — cannot reconstruct',
        );
      }
      const project = ctx.projects.get(session.projectId);
      const ixs = await decodeTxToTemplateIxs(record.rawTxBase64, project, ctx);

      const now = Date.now();
      const tpl = {
        id: crypto.randomUUID(),
        name: params.name,
        description: params.description ?? '',
        ixs,
        computeUnitLimit: null,
        airdropLamports: null,
        createdAt: now,
        updatedAt: now,
      };
      project.txTemplates.push(tpl);
      await persist();
      return tpl;
    },

    [IpcMethod.WorkflowSave]: async (p) => {
      const params = p as {
        projectId: string;
        id?: string;
        name: string;
        description?: string;
        steps: WorkflowStepInput[];
      };
      const project = ctx.projects.get(params.projectId);
      const now = Date.now();
      const existing = params.id
        ? project.workflows.find((w) => w.id === params.id)
        : undefined;
      if (existing) {
        existing.name = params.name;
        existing.description = params.description ?? '';
        existing.steps = params.steps as never;
        existing.updatedAt = now;
        await persist();
        return existing;
      }
      const wf = {
        id: crypto.randomUUID(),
        name: params.name,
        description: params.description ?? '',
        steps: params.steps as never,
        createdAt: now,
        updatedAt: now,
      };
      project.workflows.push(wf);
      await persist();
      return wf;
    },

    [IpcMethod.WorkflowList]: async (p) => {
      const { projectId } = p as { projectId: string };
      return ctx.projects.get(projectId).workflows;
    },

    [IpcMethod.WorkflowDelete]: async (p) => {
      const { projectId, id } = p as { projectId: string; id: string };
      const project = ctx.projects.get(projectId);
      project.workflows = project.workflows.filter((w) => w.id !== id);
      await persist();
      return { ok: true };
    },

    [IpcMethod.WorkflowRun]: async (p) => {
      const params = p as {
        sessionId: string;
        workflowId?: string;
        steps?: WorkflowStepInput[];
      };
      const session = ctx.sessions.get(params.sessionId);
      let steps: WorkflowStepInput[] | undefined = params.steps;
      if (!steps && params.workflowId) {
        const project = ctx.projects.get(session.projectId);
        const wf = project.workflows.find((w) => w.id === params.workflowId);
        if (!wf) throw new RelayError(ErrorCode.NOT_FOUND, `workflow not found: ${params.workflowId}`);
        steps = wf.steps as WorkflowStepInput[];
      }
      if (!steps) {
        throw new RelayError(ErrorCode.INVALID_INPUT, 'workflow.run requires steps or workflowId');
      }
      const startedAt = Date.now();
      const stepResults = await runWorkflow(ctx, runtime, params.sessionId, steps);
      await persist();
      return {
        workflowId: params.workflowId ?? null,
        sessionId: params.sessionId,
        startedAt,
        completedAt: Date.now(),
        success: stepResults.every((r) => r.success),
        steps: stepResults,
      };
    },

    [IpcMethod.TestSuiteSave]: async (p) => {
      const params = p as {
        projectId: string;
        id?: string;
        name: string;
        description?: string;
        cases: TestCase[];
      };
      const project = ctx.projects.get(params.projectId);
      const now = Date.now();
      const existing = params.id
        ? project.testSuites.find((s) => s.id === params.id)
        : undefined;
      if (existing) {
        existing.name = params.name;
        existing.description = params.description ?? '';
        existing.cases = params.cases;
        existing.updatedAt = now;
        await persist();
        return existing;
      }
      const suite: TestSuite = {
        id: crypto.randomUUID(),
        name: params.name,
        description: params.description ?? '',
        cases: params.cases,
        createdAt: now,
        updatedAt: now,
      };
      project.testSuites.push(suite);
      await persist();
      return suite;
    },

    [IpcMethod.TestSuiteList]: async (p) => {
      const { projectId } = p as { projectId: string };
      return ctx.projects.get(projectId).testSuites;
    },

    [IpcMethod.TestSuiteDelete]: async (p) => {
      const { projectId, id } = p as { projectId: string; id: string };
      const project = ctx.projects.get(projectId);
      project.testSuites = project.testSuites.filter((s) => s.id !== id);
      await persist();
      return { ok: true };
    },

    [IpcMethod.TestSuiteRun]: async (p) => {
      const params = p as {
        sessionId: string;
        suiteId?: string;
        cases?: TestCase[];
      };
      const session = ctx.sessions.get(params.sessionId);
      let cases: TestCase[] | undefined = params.cases;
      let suiteId: string | null = params.suiteId ?? null;
      if (!cases && suiteId) {
        const project = ctx.projects.get(session.projectId);
        const suite = project.testSuites.find((s) => s.id === suiteId);
        if (!suite) throw new RelayError(ErrorCode.NOT_FOUND, `test suite not found: ${suiteId}`);
        cases = suite.cases;
      }
      if (!cases) {
        throw new RelayError(ErrorCode.INVALID_INPUT, 'testSuite.run requires cases or suiteId');
      }
      const startedAt = Date.now();
      const caseResults = await runTestSuite(ctx, runtime, params.sessionId, cases);
      await persist();
      return {
        suiteId,
        sessionId: params.sessionId,
        startedAt,
        completedAt: Date.now(),
        pass: caseResults.every((c) => c.pass),
        cases: caseResults,
      };
    },

    [IpcMethod.TxTemplateDelete]: async (p) => {
      const { projectId, id } = p as { projectId: string; id: string };
      const project = ctx.projects.get(projectId);
      project.txTemplates = project.txTemplates.filter((t) => t.id !== id);
      await persist();
      return { ok: true };
    },

    [IpcMethod.TxHistory]: async (p) => {
      const { sessionId } = p as { sessionId: string };
      return ctx.sessions.get(sessionId).txHistory;
    },

    [IpcMethod.TxHistoryClear]: async (p) => {
      const { sessionId } = p as { sessionId: string };
      const session = ctx.sessions.get(sessionId);
      const cleared = session.txHistory.length;
      session.txHistory = [];
      await persist();
      return { ok: true, cleared };
    },

    [IpcMethod.TxSimulate]: async (p) => {
      const params = p as {
        sessionId: string;
        txBase64?: string;
        build?: {
          payer: string;
          ixs: InstructionSpec[];
          signers: SignerInput[];
          computeUnitLimit?: number;
          computeUnitPrice?: number;
          airdropPayer?: bigint | string | number;
          payerKeypairId?: string | null;
          additionalSignerKeypairIds?: string[];
        };
      };
      let txBytes: Uint8Array;
      if (params.txBase64) {
        txBytes = new Uint8Array(Buffer.from(params.txBase64, 'base64'));
      } else if (params.build) {
        let b = params.build;
        if (b.payerKeypairId) {
          const secret = await ctx.keypairs.exportSecretKey(b.payerKeypairId);
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.fromSecretKey(secret);
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        } else if (b.payer === 'AUTO' || b.signers.some((s) => s.pubkey === 'AUTO')) {
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.generate();
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        }
        if (
          (b as { additionalSignerKeypairIds?: string[] }).additionalSignerKeypairIds &&
          (b as { additionalSignerKeypairIds: string[] }).additionalSignerKeypairIds.length > 0
        ) {
          const { Keypair } = await import('@solana/web3.js');
          const have = new Set(b.signers.map((s) => s.pubkey));
          const extras: SignerInput[] = [];
          for (const id of (b as { additionalSignerKeypairIds: string[] }).additionalSignerKeypairIds) {
            const secret = await ctx.keypairs.exportSecretKey(id);
            const kp = Keypair.fromSecretKey(secret);
            const pub = kp.publicKey.toBase58();
            if (have.has(pub)) continue;
            have.add(pub);
            extras.push({ pubkey: pub, secretKey: Array.from(kp.secretKey) });
          }
          b = { ...b, signers: [...b.signers, ...extras] };
        }
        if (b.airdropPayer !== undefined) {
          const lamports = BigInt(b.airdropPayer.toString());
          await runtime.airdrop(params.sessionId, b.payer, lamports);
        }
        await runtime.expireBlockhash(params.sessionId);
        const recentBlockhash = await runtime.latestBlockhash(params.sessionId);
        const tx = buildTransaction({
          payer: b.payer,
          ixs: b.ixs,
          recentBlockhash,
          ...(b.computeUnitLimit !== undefined && { computeUnitLimit: b.computeUnitLimit }),
          ...(b.computeUnitPrice !== undefined && { computeUnitPrice: b.computeUnitPrice }),
        });
        signTransaction(tx, b.signers);
        txBytes = tx.serialize();
      } else {
        throw new RelayError(ErrorCode.INVALID_INPUT, 'tx.simulate requires txBase64 or build');
      }
      const result = await runtime.simulateTransaction(params.sessionId, txBytes);
      const trace = parseTrace(result.logs);
      return {
        success: result.success,
        errorMessage: result.errorMessage,
        cuConsumed: result.cuConsumed,
        returnData: result.returnData ? Buffer.from(result.returnData).toString('base64') : null,
        logs: result.logs,
        trace,
        simulated: true,
      };
    },

    [IpcMethod.TxCompareVersions]: async (p) => {
      const params = p as {
        sessionId: string;
        programId: string;
        leftVersionId: string;
        rightVersionId: string;
        build: {
          payer: string;
          ixs: InstructionSpec[];
          signers: SignerInput[];
          computeUnitLimit?: number;
          computeUnitPrice?: number;
          airdropPayer?: bigint | string | number;
          payerKeypairId?: string | null;
          additionalSignerKeypairIds?: string[];
        };
      };
      const session = ctx.sessions.get(params.sessionId);
      const originalPin = session.programVersionOverrides?.[params.programId] ?? null;

      // Inline simulate that uses runtime — kept simple, mirrors TxSimulate.
      const simulateWithPin = async (versionId: string) => {
        ctx.sessions.pinProgramVersion(params.sessionId, params.programId, versionId);
        runtime.invalidate(params.sessionId);
        let b = params.build;
        if (b.payerKeypairId) {
          const secret = await ctx.keypairs.exportSecretKey(b.payerKeypairId);
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.fromSecretKey(secret);
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        } else if (b.payer === 'AUTO' || b.signers.some((s) => s.pubkey === 'AUTO')) {
          const { Keypair } = await import('@solana/web3.js');
          const kp = Keypair.generate();
          b = {
            ...b,
            payer: kp.publicKey.toBase58(),
            signers: [{ pubkey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }],
          };
        }
        if (
          (b as { additionalSignerKeypairIds?: string[] }).additionalSignerKeypairIds &&
          (b as { additionalSignerKeypairIds: string[] }).additionalSignerKeypairIds.length > 0
        ) {
          const { Keypair } = await import('@solana/web3.js');
          const have = new Set(b.signers.map((s) => s.pubkey));
          const extras: SignerInput[] = [];
          for (const id of (b as { additionalSignerKeypairIds: string[] }).additionalSignerKeypairIds) {
            const secret = await ctx.keypairs.exportSecretKey(id);
            const kp = Keypair.fromSecretKey(secret);
            const pub = kp.publicKey.toBase58();
            if (have.has(pub)) continue;
            have.add(pub);
            extras.push({ pubkey: pub, secretKey: Array.from(kp.secretKey) });
          }
          b = { ...b, signers: [...b.signers, ...extras] };
        }
        if (b.airdropPayer !== undefined) {
          const lamports = BigInt(b.airdropPayer.toString());
          await runtime.airdrop(params.sessionId, b.payer, lamports);
        }
        await runtime.expireBlockhash(params.sessionId);
        const recentBlockhash = await runtime.latestBlockhash(params.sessionId);
        const tx = buildTransaction({
          payer: b.payer,
          ixs: b.ixs,
          recentBlockhash,
          ...(b.computeUnitLimit !== undefined && { computeUnitLimit: b.computeUnitLimit }),
          ...(b.computeUnitPrice !== undefined && { computeUnitPrice: b.computeUnitPrice }),
        });
        signTransaction(tx, b.signers);
        const txBytes = tx.serialize();
        const result = await runtime.simulateTransaction(params.sessionId, txBytes);
        const trace = parseTrace(result.logs);
        return {
          success: result.success,
          errorMessage: result.errorMessage,
          cuConsumed: result.cuConsumed,
          returnData: result.returnData ? Buffer.from(result.returnData).toString('base64') : null,
          logs: result.logs,
          trace,
          simulated: true,
        };
      };

      try {
        const left = await simulateWithPin(params.leftVersionId);
        const right = await simulateWithPin(params.rightVersionId);
        const cuLeft = BigInt(left.cuConsumed.toString());
        const cuRight = BigInt(right.cuConsumed.toString());
        const summary = {
          successMatch: left.success === right.success,
          returnDataMatch: left.returnData === right.returnData,
          cuDelta: (cuRight - cuLeft).toString(),
          cuLeft: cuLeft.toString(),
          cuRight: cuRight.toString(),
        };
        return { left, right, summary };
      } finally {
        ctx.sessions.pinProgramVersion(params.sessionId, params.programId, originalPin);
        runtime.invalidate(params.sessionId);
      }
    },

    [IpcMethod.SnapshotSave]: async (p) => {
      const { sessionId, name } = p as { sessionId: string; name: string };
      const session = ctx.sessions.get(sessionId);
      const project = ctx.projects.get(session.projectId);
      const activeVersions: Record<string, string> = {};
      for (const prog of Object.values(project.programs)) {
        activeVersions[prog.programId] = prog.activeVersionId;
      }
      const payload = captureFromSession(session, activeVersions);
      const bytes = serializeSnapshot(payload);
      const hash = await ctx.blobs.put(bytes);
      const ref = newSnapshotRef(name, session.snapshots.at(-1)?.id ?? null);
      ref.blobHash = hash;
      ref.fingerprint = snapshotFingerprint(bytes);
      session.snapshots.push(ref);
      await persist();
      return ref;
    },

    [IpcMethod.SnapshotRestore]: async (p) => {
      const { sessionId, snapshotId, restoreVersions } = p as {
        sessionId: string;
        snapshotId: string;
        restoreVersions?: boolean;
      };
      const session = ctx.sessions.get(sessionId);
      const ref = session.snapshots.find((s) => s.id === snapshotId);
      if (!ref) throw new RelayError(ErrorCode.NOT_FOUND, `snapshot not found: ${snapshotId}`);
      if (!ref.blobHash) {
        throw new RelayError(
          ErrorCode.INTERNAL,
          'snapshot has no blobHash — cannot restore (was it saved before P6?)',
        );
      }
      const blob = await ctx.blobs.get(ref.blobHash);
      if (!blob) {
        throw new RelayError(ErrorCode.CACHE_IO_FAILURE, `snapshot blob missing: ${ref.blobHash}`);
      }
      const payload = deserializeSnapshot(blob);
      applySnapshot(session, payload, { restoreVersions: restoreVersions === true });
      runtime.invalidate(sessionId);
      await persist();
      return { ok: true, restoredFrom: ref.id };
    },

    [IpcMethod.SnapshotFork]: async (p) => {
      const { sessionId, snapshotId, name } = p as {
        sessionId: string;
        snapshotId: string;
        name: string;
      };
      const source = ctx.sessions.get(sessionId);
      const ref = source.snapshots.find((s) => s.id === snapshotId);
      if (!ref) throw new RelayError(ErrorCode.NOT_FOUND, `snapshot not found: ${snapshotId}`);
      const sourcePayload = captureFromSession(source);
      const newSession = ctx.sessions.create({ projectId: source.projectId, name });
      applySnapshot(newSession, sourcePayload);
      const project = ctx.projects.get(source.projectId);
      project.sessionIds = [...project.sessionIds, newSession.id];
      await persist();
      return newSession;
    },

    [IpcMethod.SnapshotDiff]: async (p) => {
      const { a, b } = p as {
        a: { sessionId: string; snapshotId?: string };
        b: { sessionId: string; snapshotId?: string };
      };
      const left = captureFromSession(ctx.sessions.get(a.sessionId));
      const right = captureFromSession(ctx.sessions.get(b.sessionId));
      const allAddrs = new Set<string>([
        ...Object.keys(left.accounts),
        ...Object.keys(right.accounts),
      ]);
      const diffs: Array<{
        address: string;
        side: 'leftOnly' | 'rightOnly' | 'changed' | 'equal';
        leftLamports?: string;
        rightLamports?: string;
        leftDataLen?: number;
        rightDataLen?: number;
      }> = [];
      for (const addr of allAddrs) {
        const la = left.accounts[addr];
        const ra = right.accounts[addr];
        if (la && !ra)
          diffs.push({
            address: addr,
            side: 'leftOnly',
            leftLamports: la.lamports.toString(),
            leftDataLen: la.data.length,
          });
        else if (!la && ra)
          diffs.push({
            address: addr,
            side: 'rightOnly',
            rightLamports: ra.lamports.toString(),
            rightDataLen: ra.data.length,
          });
        else if (la && ra) {
          const equal =
            la.lamports === ra.lamports &&
            la.owner === ra.owner &&
            la.data.length === ra.data.length &&
            la.data.every((byte, i) => byte === ra.data[i]);
          diffs.push({
            address: addr,
            side: equal ? 'equal' : 'changed',
            leftLamports: la.lamports.toString(),
            rightLamports: ra.lamports.toString(),
            leftDataLen: la.data.length,
            rightDataLen: ra.data.length,
          });
        }
      }
      return { diffs };
    },

    [IpcMethod.KeypairGenerate]: async (p) => {
      const { label } = p as { label: string };
      return ctx.keypairs.generate(label);
    },

    [IpcMethod.KeypairImport]: async (p) => {
      const { label, secretKey } = p as { label: string; secretKey: number[] | string };
      return ctx.keypairs.importSecret(label, secretKey);
    },

    [IpcMethod.KeypairList]: async () => ctx.keypairs.list(),

    [IpcMethod.KeypairDelete]: async (p) => {
      const { id } = p as { id: string };
      await ctx.keypairs.delete(id);
      return { ok: true };
    },

    [IpcMethod.KeypairReseal]: async () => ctx.keypairs.resealAll(),

    [IpcMethod.KeypairExportSecret]: async (p) => {
      const { id, format } = p as { id: string; format?: 'base58' | 'json' };
      const secret = await ctx.keypairs.exportSecretKey(id);
      if (format === 'json') {
        return { secret: JSON.stringify(Array.from(secret)) };
      }
      const bs58Mod = await import('bs58');
      const enc =
        (bs58Mod as { encode?: (b: Uint8Array) => string }).encode ??
        (bs58Mod as { default: { encode: (b: Uint8Array) => string } }).default.encode;
      return { secret: enc(secret) };
    },

    [IpcMethod.TxReplay]: async (p) => {
      const params = p as { sessionId?: string; signature: string; rpcUrl?: string };
      const rpcUrl =
        params.rpcUrl ??
        (params.sessionId
          ? env.resolveRpcUrl(
              ctx.projects.get(ctx.sessions.get(params.sessionId).projectId).rpcEndpointId,
            )
          : env.resolveRpcUrl('mainnet-beta'));
      const network = params.sessionId
        ? ctx.projects.get(ctx.sessions.get(params.sessionId).projectId).network
        : 'mainnet-beta';
      const replayer = new Replayer(rpcUrl, network);
      return replayer.replay({ signature: params.signature, rpcUrl, network });
    },

    [IpcMethod.PatchRemove]: async (p) => {
      const { scope, scopeId, patchId } = p as {
        scope: PatchScope;
        scopeId: string;
        patchId: string;
      };
      if (scope === 'project') {
        const project = ctx.projects.get(scopeId);
        project.patches = project.patches.filter((x) => x.id !== patchId);
      } else {
        const session = ctx.sessions.get(scopeId);
        session.sessionPatches = session.sessionPatches.filter((x) => x.id !== patchId);
      }
      await persist();
      return { ok: true };
    },
  };

  // ───────── Sandbox aliases ─────────
  // Mirror every `session.*` handler under its `sandbox.*` name so new
  // clients can use the new naming while old scripts keep working. Adds the
  // aliases AFTER the map is built so we just copy existing fn refs.
  const sandboxAliases: Array<[IpcMethod, IpcMethod]> = [
    [IpcMethod.SandboxCreate, IpcMethod.SessionCreate],
    [IpcMethod.SandboxList, IpcMethod.SessionList],
    [IpcMethod.SandboxOpen, IpcMethod.SessionOpen],
    [IpcMethod.SandboxRename, IpcMethod.SessionRename],
    [IpcMethod.SandboxReset, IpcMethod.SessionReset],
    [IpcMethod.SandboxDelete, IpcMethod.SessionDelete],
    [IpcMethod.SandboxAirdrop, IpcMethod.SessionAirdrop],
    [IpcMethod.SandboxWarpToSlot, IpcMethod.SessionWarpToSlot],
    [IpcMethod.SandboxWarpByTime, IpcMethod.SessionWarpByTime],
    [IpcMethod.SandboxExpireBlockhash, IpcMethod.SessionExpireBlockhash],
    [IpcMethod.SandboxGetClock, IpcMethod.SessionGetClock],
    [IpcMethod.SandboxGetVersionPins, IpcMethod.SessionGetVersionPins],
  ];
  // biome-ignore lint/suspicious/noExplicitAny: handler map index isn't typed by literal IpcMethod
  for (const [alias, target] of sandboxAliases) {
    (map as any)[alias] = (map as any)[target];
  }
  return map;
}
