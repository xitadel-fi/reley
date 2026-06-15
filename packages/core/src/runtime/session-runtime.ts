import { type AccountSnapshot, ErrorCode, RelayError } from '@relay/shared';
import { type AccountInfo, PublicKey } from '@solana/web3.js';
import type { CoreContext } from '../store/context.js';
import { applyPatchesAsync } from '../store/patch-engine.js';
import { SvmInstance, type SvmTxResult } from '../svm/svm.js';
import { isBuiltinProgram } from '../util/builtins.js';

interface RuntimeEntry {
  svm: SvmInstance;
  hydrated: boolean;
  /** Pubkeys currently set in the SVM. */
  knownAccounts: Set<string>;
  /** Last project patch fingerprint hydrated. */
  patchVersion: string;
}

/**
 * Per-session LiteSVM lifecycle.
 *
 * Hydration loads every program ELF + every project account into the SVM,
 * applying project- then session-level patches in order (FR-X-13).
 */
export class SessionRuntime {
  private readonly entries = new Map<string, RuntimeEntry>();

  constructor(private readonly ctx: CoreContext) {}

  async ensureHydrated(sessionId: string): Promise<SvmInstance> {
    const session = this.ctx.sessions.get(sessionId);
    const project = this.ctx.projects.get(session.projectId);

    const fingerprint = `${JSON.stringify(project.patches)}|${JSON.stringify(session.sessionPatches)}|${JSON.stringify(session.programVersionOverrides ?? {})}|${Object.values(project.programs)
      .map((p) => `${p.programId}:${p.activeVersionId}`)
      .sort()
      .join(',')}`;
    let entry = this.entries.get(sessionId);
    if (entry?.hydrated && entry.patchVersion === fingerprint) {
      return entry.svm;
    }
    if (!entry) {
      entry = {
        svm: new SvmInstance(),
        hydrated: false,
        knownAccounts: new Set(),
        patchVersion: '',
      };
      this.entries.set(sessionId, entry);
    } else {
      // Patch fingerprint changed — rebuild SVM cleanly.
      entry.svm = new SvmInstance();
      entry.hydrated = false;
      entry.knownAccounts.clear();
    }

    // Load programs. Session may pin a non-default version for some programs;
    // otherwise we use the project-level active version's ELF.
    const sessionPins = session.programVersionOverrides ?? {};
    for (const prog of Object.values(project.programs)) {
      if (isBuiltinProgram(prog.programId)) continue;
      const pinnedVersionId = sessionPins[prog.programId];
      const pinned = pinnedVersionId
        ? prog.versions.find((v) => v.id === pinnedVersionId)
        : undefined;
      const blobHash = pinned?.elfBlobHash ?? prog.elfBlobHash;
      const elf = await this.ctx.blobs.get(blobHash);
      if (!elf || elf.length === 0) {
        if (!elf) {
          throw new RelayError(
            ErrorCode.PROGRAM_LOAD_FAILURE,
            `program ELF blob missing for ${prog.programId}`,
          );
        }
        continue;
      }
      entry.svm.addProgram(new PublicKey(prog.programId), elf);
    }

    // Preload IDLs for every program owner referenced — patch engine resolveIdl is sync.
    // Honors per-session version pin (programVersionOverrides) and falls back
    // to the project's active version's IDL, then the program-default IDL.
    const idlCache = new Map<string, import('@coral-xyz/anchor').Idl | null>();
    for (const prog of Object.values(project.programs)) {
      const pinnedVid = sessionPins[prog.programId];
      const effectiveVid = pinnedVid ?? prog.activeVersionId;
      idlCache.set(prog.programId, await this.ctx.idls.get(prog.programId, effectiveVid));
    }
    const resolveIdl = (programId: string) => idlCache.get(programId) ?? null;

    for (const prog of Object.values(project.programs)) {
      for (const accEntry of prog.accounts) {
        const blob = await this.ctx.blobs.get(accEntry.blobHash);
        if (!blob) {
          throw new RelayError(
            ErrorCode.CACHE_IO_FAILURE,
            `account blob missing for ${accEntry.address}`,
          );
        }
        const initial: AccountSnapshot = {
          pubkey: accEntry.address,
          lamports: 1_000_000_000n, // default funded; original lamports lost (P0 sidecar metadata limitation)
          owner: prog.programId,
          executable: false,
          rentEpoch: 0n,
          data: new Uint8Array(blob),
          clonedAtSlot: accEntry.clonedAtSlot,
          source: 'cloned',
        };
        const patched = await applyPatchesAsync(initial, project.patches, session.sessionPatches, {
          resolveIdl,
        });
        entry.svm.setAccount(new PublicKey(patched.pubkey), this.toAccountInfo(patched));
        entry.knownAccounts.add(patched.pubkey);
      }
    }

    // Seed the SVM clock with real wallclock when starting from a fresh
    // sandbox. LiteSVM defaults `Clock::unix_timestamp = 0`, so any cloned
    // account whose `expiry` / `start` / `lockup_until` field holds a real
    // unix timestamp would never compare correctly until the user warped
    // ~55 years forward. We only seed when the user hasn't already warped
    // (currentSlot == 0 AND svm clock ts == 0) so warps + snapshots remain
    // authoritative.
    {
      const cur = entry.svm.getClockBig();
      if (session.currentSlot === 0n && cur.unixTimestamp === 0n) {
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        entry.svm.setClock({
          slot: cur.slot,
          epochStartTimestamp: cur.epochStartTimestamp === 0n ? nowSec : cur.epochStartTimestamp,
          epoch: cur.epoch,
          leaderScheduleEpoch: cur.leaderScheduleEpoch,
          unixTimestamp: nowSec,
        });
      }
    }

    entry.hydrated = true;
    entry.patchVersion = fingerprint;
    return entry.svm;
  }

  /** Force re-hydration on next call (e.g. after a session-state mutation). */
  invalidate(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  async sendTransaction(sessionId: string, txBytes: Uint8Array): Promise<SvmTxResult> {
    const svm = await this.ensureHydrated(sessionId);
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(txBytes);
    return svm.sendTransaction(tx);
  }

  async simulateTransaction(sessionId: string, txBytes: Uint8Array): Promise<SvmTxResult> {
    const svm = await this.ensureHydrated(sessionId);
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(txBytes);
    return svm.simulateTransaction(tx);
  }

  /** Funds the given pubkey on this session's SVM with lamports. */
  async airdrop(sessionId: string, pubkey: string, lamports: bigint): Promise<void> {
    const svm = await this.ensureHydrated(sessionId);
    svm.airdrop(new PublicKey(pubkey), lamports);
  }

  async latestBlockhash(sessionId: string): Promise<string> {
    const svm = await this.ensureHydrated(sessionId);
    return svm.latestBlockhash();
  }

  async warpToSlot(sessionId: string, slot: bigint): Promise<void> {
    const svm = await this.ensureHydrated(sessionId);
    const session = this.ctx.sessions.get(sessionId);
    const prevClock = svm.getClockBig();
    // LiteSVM.warpToSlot only moves the `slot` field. Bump unixTimestamp
    // proportionally so on-chain `Clock::unix_timestamp` checks (token
    // vesting cliffs, prediction-market expiries, etc.) advance with us.
    const slotDelta = slot - prevClock.slot;
    const tsDelta = (slotDelta * 4n) / 10n; // ~0.4 s per slot
    svm.setClock({
      slot,
      epochStartTimestamp: prevClock.epochStartTimestamp,
      epoch: prevClock.epoch,
      leaderScheduleEpoch: prevClock.leaderScheduleEpoch,
      unixTimestamp: prevClock.unixTimestamp + tsDelta,
    });
    session.currentSlot = slot;
  }

  async expireBlockhash(sessionId: string): Promise<void> {
    const svm = await this.ensureHydrated(sessionId);
    svm.expireBlockhash();
  }

  async getClock(sessionId: string): Promise<{
    slot: string;
    epoch: string;
    epochStartTimestamp: string;
    leaderScheduleEpoch: string;
    unixTimestamp: string;
  }> {
    const svm = await this.ensureHydrated(sessionId);
    return svm.getClock();
  }

  async warpByTime(sessionId: string, seconds: number): Promise<{ newSlot: bigint }> {
    const svm = await this.ensureHydrated(sessionId);
    const session = this.ctx.sessions.get(sessionId);
    const prevClock = svm.getClockBig();
    const slotAdvance = BigInt(Math.max(1, Math.round(seconds / 0.4)));
    const newSlot = prevClock.slot + slotAdvance;
    const newTs = prevClock.unixTimestamp + BigInt(Math.trunc(seconds));
    svm.setClock({
      slot: newSlot,
      epochStartTimestamp: prevClock.epochStartTimestamp,
      epoch: prevClock.epoch,
      leaderScheduleEpoch: prevClock.leaderScheduleEpoch,
      unixTimestamp: newTs,
    });
    session.currentSlot = newSlot;
    return { newSlot };
  }

  private toAccountInfo(snap: AccountSnapshot): AccountInfo<Buffer> {
    return {
      lamports: Number(snap.lamports),
      owner: new PublicKey(snap.owner),
      executable: snap.executable,
      rentEpoch: Number(snap.rentEpoch),
      data: Buffer.from(snap.data),
    };
  }
}
