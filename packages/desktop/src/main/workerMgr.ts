import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { WorkerClient } from '@relay/core';
import { app, safeStorage } from 'electron';

interface WorkerSealRequest {
  __relaySeal: true;
  id: number;
  op: 'seal' | 'unseal';
  payload: string;
}

interface WorkerHandle {
  windowId: number;
  worker: Worker;
  client: WorkerClient;
  projectRoot: string;
  ready: Promise<void>;
}

export interface SpawnOptions {
  projectRoot: string;
}

const workers = new Map<number, WorkerHandle>();
let workerScriptPath: string | null = null;

export function setWorkerScriptPath(p: string): void {
  workerScriptPath = p;
}

export function spawnWorkerForWindow(
  windowId: number,
  opts: SpawnOptions,
): Promise<WorkerHandle> {
  if (!workerScriptPath) throw new Error('worker script path not set');
  const existing = workers.get(windowId);
  if (existing) return Promise.resolve(existing);

  const defaultRpcUrl = process.env.RELAY_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const logPath = join(app.getPath('userData'), 'logs', `worker-${windowId}.log`);
  mkdirSync(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n=== worker ${windowId} spawn at ${new Date().toISOString()} ===\n`);
  logStream.write(`project: ${opts.projectRoot}\n`);

  const sealAvailable = safeStorage.isEncryptionAvailable();

  const worker = new Worker(workerScriptPath, {
    workerData: {
      projectRoot: opts.projectRoot,
      defaultRpcUrl,
      sealAvailable,
      windowId,
    },
    stdout: true,
    stderr: true,
  });

  worker.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Partial<WorkerSealRequest>;
    if (!m.__relaySeal || m.id === undefined || !m.op || m.payload === undefined) return;
    try {
      const input = Buffer.from(m.payload, 'base64');
      if (!sealAvailable) {
        worker.postMessage({
          __relaySealReply: true,
          id: m.id,
          ok: false,
          error: 'safeStorage not available on this platform',
        });
        return;
      }
      let result: Buffer;
      if (m.op === 'seal') {
        result = safeStorage.encryptString(input.toString('binary'));
      } else {
        result = Buffer.from(safeStorage.decryptString(input), 'binary');
      }
      worker.postMessage({
        __relaySealReply: true,
        id: m.id,
        ok: true,
        result: result.toString('base64'),
      });
    } catch (err) {
      worker.postMessage({
        __relaySealReply: true,
        id: m.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  });

  worker.stdout?.pipe(logStream);
  worker.stderr?.pipe(logStream);

  const client = new WorkerClient(worker);

  let resolveReady: () => void;
  const ready = new Promise<void>((res) => {
    resolveReady = res;
  });
  setTimeout(() => resolveReady(), 5000); // fallback if no ready event

  worker.on('message', (msg) => {
    if (msg && typeof msg === 'object' && (msg as { event?: string }).event === 'ready') {
      resolveReady();
    }
  });

  worker.on('exit', (code) => {
    logStream.write(`[exit ${code}]\n`);
    workers.delete(windowId);
  });

  worker.on('error', (err) => {
    logStream.write(`[error] ${err.stack ?? err.message}\n`);
    console.error(`[worker ${windowId}] error:`, err);
  });

  const handle: WorkerHandle = {
    windowId,
    worker,
    client,
    projectRoot: opts.projectRoot,
    ready,
  };
  workers.set(windowId, handle);
  return Promise.resolve(handle);
}

export function getClientForWindow(windowId: number): WorkerClient | null {
  return workers.get(windowId)?.client ?? null;
}

export function getWorkerHandleForWindow(windowId: number): WorkerHandle | null {
  return workers.get(windowId) ?? null;
}

export async function shutdownWorkerForWindow(windowId: number): Promise<void> {
  const h = workers.get(windowId);
  if (!h) return;
  workers.delete(windowId);
  try {
    await h.worker.terminate();
  } catch {
    /* ignore */
  }
}

export async function shutdownAll(): Promise<void> {
  await Promise.all(Array.from(workers.values()).map((h) => h.worker.terminate().catch(() => {})));
  workers.clear();
}
