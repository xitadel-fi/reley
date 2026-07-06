import type { MessagePort } from 'node:worker_threads';
import type { SealAdapter } from '@reley/core';

interface SealRequest {
  __relaySeal: true;
  id: number;
  op: 'seal' | 'unseal';
  payload: string; // base64
}

interface SealResponse {
  __relaySealReply: true;
  id: number;
  ok: boolean;
  result?: string; // base64
  error?: string;
}

/**
 * Worker-side seal adapter. Posts seal/unseal requests to the parent (main)
 * process via `parentPort`. Main routes through Electron `safeStorage`.
 */
export function createWorkerSealAdapter(port: MessagePort, available: boolean): SealAdapter {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }>();

  port.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Partial<SealResponse>;
    if (!m.__relaySealReply || m.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok && m.result !== undefined) {
      p.resolve(new Uint8Array(Buffer.from(m.result, 'base64')));
    } else {
      p.reject(new Error(m.error ?? 'seal failed'));
    }
  });

  const ask = (op: 'seal' | 'unseal', input: Uint8Array): Promise<Uint8Array> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const req: SealRequest = {
        __relaySeal: true,
        id,
        op,
        payload: Buffer.from(input).toString('base64'),
      };
      port.postMessage(req);
    });
  };

  return {
    available,
    seal: (b) => ask('seal', b),
    unseal: (b) => ask('unseal', b),
  };
}
