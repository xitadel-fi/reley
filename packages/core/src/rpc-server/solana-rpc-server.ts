import http from 'node:http';
import { PublicKey, type VersionedTransaction, type Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { ErrorCode, RelayError } from '@relay/shared';
import type { CoreContext } from '../store/context.js';
import type { SessionRuntime } from '../runtime/session-runtime.js';
import { parseTrace } from '../trace/parser.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcOk {
  jsonrpc: '2.0';
  id: number | string | null;
  result: unknown;
}

interface JsonRpcErr {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcOk | JsonRpcErr;

const ERR_PARSE = -32700;
const ERR_INVALID_REQ = -32600;
const ERR_METHOD = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

/**
 * Per-session Solana JSON-RPC server. Maps a useful subset of Solana RPC verbs
 * onto the active session's LiteSVM so any client (`@solana/web3.js`, anchor,
 * curl) can target it like a real cluster.
 */
export class SolanaRpcServer {
  private server: http.Server | null = null;

  constructor(
    private readonly ctx: CoreContext,
    private readonly runtime: SessionRuntime,
  ) {}

  async start(port: number, host = '127.0.0.1'): Promise<{ port: number; host: string }> {
    if (this.server) {
      throw new RelayError(ErrorCode.INVALID_INPUT, 'RPC server already running');
    }
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    return { port, host };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      s.close(() => resolve());
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  address(): { port: number; host: string } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') return null;
    return { port: addr.port, host: addr.address };
  }

  // ── HTTP handling ──────────────────────────────────────────────────────

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS preflight for browser-based clients (rare but possible)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Relay LiteSVM RPC — POST JSON-RPC 2.0 to /session/<sessionId>');
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }

    // Parse session ID from URL: /session/<uuid>
    const url = req.url ?? '';
    const m = url.match(/^\/session\/([0-9a-f-]+)\/?$/i);
    if (!m) {
      res.statusCode = 404;
      res.end('expected /session/<sessionId>');
      return;
    }
    const sessionId = m[1]!;

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void this.processBody(sessionId, Buffer.concat(chunks).toString('utf8'), res);
    });
  }

  private async processBody(
    sessionId: string,
    body: string,
    res: http.ServerResponse,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendResponse(res, { jsonrpc: '2.0', id: null, error: { code: ERR_PARSE, message: 'parse error' } });
      return;
    }
    const isBatch = Array.isArray(parsed);
    const reqs = (isBatch ? parsed : [parsed]) as JsonRpcRequest[];
    const responses = await Promise.all(reqs.map((r) => this.dispatch(sessionId, r)));
    this.sendResponse(res, isBatch ? responses : responses[0]!);
  }

  private sendResponse(res: http.ServerResponse, payload: unknown): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  }

  // ── Method dispatch ────────────────────────────────────────────────────

  private async dispatch(sessionId: string, req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? null;
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: ERR_INVALID_REQ, message: 'invalid request' } };
    }
    try {
      const result = await this.invoke(sessionId, req.method, req.params);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      if (err instanceof MethodNotFound) {
        return { jsonrpc: '2.0', id, error: { code: ERR_METHOD, message: err.message } };
      }
      if (err instanceof InvalidParams) {
        return { jsonrpc: '2.0', id, error: { code: ERR_INVALID_PARAMS, message: err.message } };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { jsonrpc: '2.0', id, error: { code: ERR_INTERNAL, message: msg } };
    }
  }

  private async invoke(sessionId: string, method: string, params: unknown): Promise<unknown> {
    const args = (Array.isArray(params) ? params : []) as unknown[];
    const session = this.ctx.sessions.get(sessionId); // throws if not found

    switch (method) {
      case 'getHealth':
        return 'ok';

      case 'getVersion':
        return { 'solana-core': '1.18.0-relay', 'feature-set': 0 };

      case 'getGenesisHash':
        return '11111111111111111111111111111111';

      case 'getIdentity':
        return { identity: '11111111111111111111111111111111' };

      case 'getSlot':
        return Number(session.currentSlot);

      case 'getBlockHeight':
        return Number(session.currentSlot);

      case 'getEpochInfo':
        return {
          absoluteSlot: Number(session.currentSlot),
          blockHeight: Number(session.currentSlot),
          epoch: 0,
          slotIndex: Number(session.currentSlot),
          slotsInEpoch: 432000,
          transactionCount: session.txHistory.length,
        };

      case 'getLatestBlockhash': {
        await this.runtime.expireBlockhash(sessionId);
        const bh = await this.runtime.latestBlockhash(sessionId);
        return wrapContext(sessionId, this, {
          blockhash: bh,
          lastValidBlockHeight: Number(session.currentSlot) + 150,
        });
      }

      case 'getRecentBlockhash': {
        await this.runtime.expireBlockhash(sessionId);
        const bh = await this.runtime.latestBlockhash(sessionId);
        return wrapContext(sessionId, this, {
          blockhash: bh,
          feeCalculator: { lamportsPerSignature: 5000 },
        });
      }

      case 'getMinimumBalanceForRentExemption': {
        const dataLen = Number(args[0] ?? 0);
        // Solana rent: roughly (128 + dataLen) * 6960 lamports
        return (128 + dataLen) * 6960;
      }

      case 'getBalance': {
        const pubkey = expectString(args[0], 'pubkey');
        const svm = await this.runtime.ensureHydrated(sessionId);
        const acc = svm.getAccount(new PublicKey(pubkey));
        return wrapContext(sessionId, this, acc ? Number(acc.lamports) : 0);
      }

      case 'getAccountInfo': {
        const pubkey = expectString(args[0], 'pubkey');
        const opts = (args[1] ?? {}) as { encoding?: string; commitment?: string };
        const svm = await this.runtime.ensureHydrated(sessionId);
        const acc = svm.getAccount(new PublicKey(pubkey));
        return wrapContext(sessionId, this, acc ? encodeAccount(acc, opts.encoding) : null);
      }

      case 'getTokenAccountBalance': {
        const pubkey = expectString(args[0], 'pubkey');
        const svm = await this.runtime.ensureHydrated(sessionId);
        const acc = svm.getAccount(new PublicKey(pubkey));
        if (!acc) throw new InvalidParams( `account ${pubkey} not found`);
        const data = Buffer.from(acc.data);
        if (data.length < 72) throw new InvalidParams( 'not a token account');
        const mint = new PublicKey(data.subarray(0, 32)).toBase58();
        const amount = data.readBigUInt64LE(64).toString();
        const mintAcc = svm.getAccount(new PublicKey(mint));
        const decimals = mintAcc ? Buffer.from(mintAcc.data).readUInt8(44) : 0;
        const uiAmount = Number(amount) / 10 ** decimals;
        return wrapContext(sessionId, this, {
          amount,
          decimals,
          uiAmount,
          uiAmountString: uiAmount.toString(),
        });
      }

      case 'getTokenSupply': {
        const pubkey = expectString(args[0], 'pubkey');
        const svm = await this.runtime.ensureHydrated(sessionId);
        const acc = svm.getAccount(new PublicKey(pubkey));
        if (!acc) throw new InvalidParams( `mint ${pubkey} not found`);
        const data = Buffer.from(acc.data);
        if (data.length < 45) throw new InvalidParams( 'not a mint account');
        const supply = data.readBigUInt64LE(36).toString();
        const decimals = data.readUInt8(44);
        const uiAmount = Number(supply) / 10 ** decimals;
        return wrapContext(sessionId, this, {
          amount: supply,
          decimals,
          uiAmount,
          uiAmountString: uiAmount.toString(),
        });
      }

      case 'getMultipleAccounts': {
        const pubkeys = expectStringArray(args[0], 'pubkeys');
        const opts = (args[1] ?? {}) as { encoding?: string };
        const svm = await this.runtime.ensureHydrated(sessionId);
        const out = pubkeys.map((pk) => {
          const acc = svm.getAccount(new PublicKey(pk));
          return acc ? encodeAccount(acc, opts.encoding) : null;
        });
        return wrapContext(sessionId, this, out);
      }

      case 'requestAirdrop': {
        const pubkey = expectString(args[0], 'pubkey');
        const lamports = BigInt(String(args[1] ?? 0));
        await this.runtime.airdrop(sessionId, pubkey, lamports);
        return bs58.encode(new Uint8Array(64)); // fake sig (all zeros)
      }

      case 'sendTransaction': {
        const encoded = expectString(args[0], 'transaction');
        const opts = (args[1] ?? {}) as { encoding?: string; skipPreflight?: boolean };
        const txBytes = decodeTxBytes(encoded, opts.encoding ?? 'base58');
        const result = await this.runtime.sendTransaction(sessionId, txBytes);
        if (!result.success) {
          throw new Error(result.errorMessage ?? 'transaction failed');
        }
        // First 64 bytes of the tx are its signature
        return bs58.encode(txBytes.slice(0, 64));
      }

      case 'simulateTransaction': {
        const encoded = expectString(args[0], 'transaction');
        const opts = (args[1] ?? {}) as { encoding?: string; sigVerify?: boolean };
        const txBytes = decodeTxBytes(encoded, opts.encoding ?? 'base64');
        const result = await this.runtime.simulateTransaction(sessionId, txBytes);
        const trace = parseTrace(result.logs);
        return wrapContext(sessionId, this, {
          err: result.success ? null : result.errorMessage,
          logs: result.logs,
          accounts: null,
          unitsConsumed: Number(result.cuConsumed),
          returnData: result.returnData
            ? {
                programId: trace[0]?.programId ?? '11111111111111111111111111111111',
                data: [Buffer.from(result.returnData).toString('base64'), 'base64'],
              }
            : null,
        });
      }

      case 'getProgramAccounts': {
        const programId = expectString(args[0], 'programId');
        // Linear scan over hydrated accounts in session — best-effort, no real validator perf.
        const svm = await this.runtime.ensureHydrated(sessionId);
        const out: Array<{ pubkey: string; account: ReturnType<typeof encodeAccount> }> = [];
        const project = this.ctx.projects.get(session.projectId);
        for (const prog of Object.values(project.programs)) {
          for (const accEntry of prog.accounts) {
            const acc = svm.getAccount(new PublicKey(accEntry.address));
            if (!acc) continue;
            if (acc.owner.toBase58() === programId) {
              out.push({
                pubkey: accEntry.address,
                account: encodeAccount(acc, 'base64'),
              });
            }
          }
        }
        return out;
      }

      case 'getSignatureStatuses':
        return wrapContext(sessionId, this, [null]); // we don't index signatures

      case 'getTransaction':
        return null;

      case 'getFeeForMessage':
        return wrapContext(sessionId, this, 5000);

      default:
        throw new MethodNotFound(`method not supported: ${method}`);
    }
  }
}

class MethodNotFound extends Error {}
class InvalidParams extends Error {}

function expectString(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new InvalidParams(`expected string ${name}`);
  return v;
}

function expectStringArray(v: unknown, name: string): string[] {
  if (!Array.isArray(v)) throw new InvalidParams(`expected array ${name}`);
  return v.map((x, i) => {
    if (typeof x !== 'string') throw new InvalidParams(`expected string ${name}[${i}]`);
    return x;
  });
}

function encodeAccount(
  acc: { lamports: number; owner: PublicKey; executable: boolean; data: Buffer; rentEpoch?: number },
  encoding?: string,
): {
  lamports: number;
  owner: string;
  executable: boolean;
  rentEpoch: number;
  data: [string, string];
} {
  const enc = encoding === 'base58' ? 'base58' : 'base64';
  const dataStr =
    enc === 'base58' ? bs58.encode(new Uint8Array(acc.data)) : acc.data.toString('base64');
  return {
    lamports: acc.lamports,
    owner: acc.owner.toBase58(),
    executable: acc.executable,
    rentEpoch: acc.rentEpoch ?? 0,
    data: [dataStr, enc],
  };
}

function wrapContext<T>(sessionId: string, server: SolanaRpcServer, value: T): { context: { slot: number; apiVersion?: string }; value: T } {
  const ctx = server['ctx']; // intentional reflection — internal helper
  const session = ctx.sessions.get(sessionId);
  return {
    context: { slot: Number(session.currentSlot), apiVersion: '1.18.0-relay' },
    value,
  };
}

function decodeTxBytes(encoded: string, encoding: string): Uint8Array {
  if (encoding === 'base58') return bs58.decode(encoded);
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}

// Type smoothing so the imports don't get tree-shaken to nothing
export type _Internals = VersionedTransaction | Transaction;
