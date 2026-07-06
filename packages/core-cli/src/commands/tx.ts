import { readFile } from 'node:fs/promises';
import { IpcMethod } from '@reley/shared';
import { Keypair } from '@solana/web3.js';
import { createHost } from '../host.js';
import { printJson } from './print.js';

export async function txSendCmd(opts: {
  session: string;
  program: string;
  payer?: string;
  data: string;
  account?: string[];
  airdrop?: string;
  computeUnits?: string;
}): Promise<void> {
  const { dispatcher } = await createHost();

  let payerKp: Keypair;
  if (opts.payer) {
    const raw = JSON.parse(await readFile(opts.payer, 'utf8')) as number[];
    payerKp = Keypair.fromSecretKey(new Uint8Array(raw));
  } else {
    payerKp = Keypair.generate();
  }

  const dataHex = opts.data.startsWith('0x') ? opts.data.slice(2) : opts.data;
  const dataBase64 = Buffer.from(dataHex, 'hex').toString('base64');

  const accounts = (opts.account ?? []).map((spec) => {
    const parts = spec.split(':');
    if (parts.length !== 3) {
      throw new Error(`invalid --account spec "${spec}"; expected pubkey:isSigner:isWritable`);
    }
    const [pubkey, isSigner, isWritable] = parts as [string, string, string];
    return {
      pubkey,
      isSigner: isSigner === 'true' || isSigner === '1',
      isWritable: isWritable === 'true' || isWritable === '1',
    };
  });

  const result = await dispatcher.call(IpcMethod.TxSend, {
    sessionId: opts.session,
    build: {
      payer: payerKp.publicKey.toBase58(),
      ixs: [
        {
          programId: opts.program,
          accounts,
          dataBase64,
        },
      ],
      signers: [
        {
          pubkey: payerKp.publicKey.toBase58(),
          secretKey: Array.from(payerKp.secretKey),
        },
      ],
      airdropPayer: opts.airdrop ?? '10000000000',
      ...(opts.computeUnits !== undefined && { computeUnitLimit: Number(opts.computeUnits) }),
    },
  });
  printJson(result);
}

export async function txHistoryCmd(opts: { session: string }): Promise<void> {
  const { dispatcher } = await createHost();
  printJson(await dispatcher.call(IpcMethod.TxHistory, { sessionId: opts.session }));
}

export async function txReplayCmd(
  signature: string,
  opts: { session?: string; rpcUrl?: string },
): Promise<void> {
  const { dispatcher } = await createHost();
  const params: Record<string, unknown> = { signature };
  if (opts.session) params.sessionId = opts.session;
  if (opts.rpcUrl) params.rpcUrl = opts.rpcUrl;
  printJson(await dispatcher.call(IpcMethod.TxReplay, params));
}
