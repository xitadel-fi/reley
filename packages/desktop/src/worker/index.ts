import { parentPort, workerData } from 'node:worker_threads';
import { CoreContext, Dispatcher, buildHandlers } from '@reley/core';

interface WorkerInit {
  projectRoot: string;
  defaultRpcUrl: string;
  sealAvailable: boolean;
  windowId: number;
}

async function main(): Promise<void> {
  if (!parentPort) throw new Error('worker must be launched with parentPort');

  const init = workerData as WorkerInit;

  // RPC requests can arrive before ctx.load() finishes. Buffer them on a
  // dedicated listener attached BEFORE the seal adapter (which otherwise
  // would be the only listener and consume queued messages).
  const rpcBuffer: unknown[] = [];
  let onRpc: ((msg: unknown) => void) | null = (msg) => rpcBuffer.push(msg);
  parentPort.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { __relaySealReply?: boolean; __relaySeal?: boolean; method?: string };
    if (m.__relaySealReply || m.__relaySeal) return;
    if (typeof m.method !== 'string') return;
    onRpc?.(msg);
  });

  // Dev wallets stay plaintext on disk — sealing disabled. Keypairs are
  // project-scoped (<projectRoot>/.relay/keypairs/) so they travel with the
  // project folder.
  const ctx = new CoreContext({ projectRoot: init.projectRoot });
  await ctx.load();

  const dispatcher = new Dispatcher(
    buildHandlers({
      ctx,
      resolveRpcUrl: (endpointId) => {
        if (endpointId.startsWith('http://') || endpointId.startsWith('https://')) {
          return endpointId;
        }
        return init.defaultRpcUrl;
      },
      persist: () => ctx.save(),
    }),
  );

  // Swap buffer for live dispatch, then drain buffered requests.
  onRpc = (msg) => {
    void dispatcher.dispatch(msg as never).then((resp) => parentPort!.postMessage(resp));
  };
  for (const msg of rpcBuffer.splice(0)) onRpc(msg);

  parentPort.postMessage({
    event: 'ready',
    payload: { pid: process.pid, projectRoot: init.projectRoot, windowId: init.windowId },
  });
}

main().catch((err) => {
  // Worker died during init. Surface via stderr (parent ignores) and post a
  // fatal message back to the parent so the renderer can show something
  // actionable instead of a silent blank window.
  const msg = `worker init failed: ${(err as Error).stack ?? String(err)}`;
  try {
    process.stderr.write(`${msg}\n`);
  } catch {
    /* ignore */
  }
  if (parentPort) {
    try {
      parentPort.postMessage({ event: 'fatal', payload: { message: msg } });
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
});
