import { type Context, createContext, runInContext } from 'node:vm';
import { ErrorCode, RelayError } from '@reley/shared';

export interface ScriptSandboxOptions {
  /** Allowed URL prefixes (exact or regex strings) for fetch. Default deny. */
  networkAllowlist?: Array<string | RegExp>;
  /** Hard wall-clock timeout in ms. Default 5_000. */
  timeoutMs?: number;
  /** Pass `reley` API into the script - typically a thin wrapper around Dispatcher.call. */
  reley?: unknown;
  /** @deprecated use `reley`. Kept so older callers/scripts keep working. */
  relay?: unknown;
}

export interface ScriptResult {
  ok: boolean;
  returnValue: unknown;
  logs: string[];
  durationMs: number;
  error?: string;
}

/**
 * Run a TypeScript-flavoured (transpiled to JS by caller) script in a sandboxed
 * vm.Context. Default policy (per D-7): no fs, no process, no child_process,
 * no worker_threads, network allowed only via fetch against `networkAllowlist`.
 */
export async function runScript(
  source: string,
  opts: ScriptSandboxOptions = {},
): Promise<ScriptResult> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const allowlist = opts.networkAllowlist ?? [];
  const logs: string[] = [];

  const consoleProxy = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
  };

  const fetchProxy = async (url: string, init?: unknown): Promise<unknown> => {
    if (typeof url !== 'string') {
      throw new RelayError(ErrorCode.INVALID_INPUT, 'fetch requires a string URL');
    }
    const allowed = allowlist.some((entry) =>
      typeof entry === 'string' ? url.startsWith(entry) : entry.test(url),
    );
    if (!allowed) {
      throw new RelayError(
        ErrorCode.UNAUTHORIZED,
        `network access denied: ${url} not in script network allowlist`,
      );
    }
    return fetch(url, init as RequestInit | undefined);
  };

  const api = opts.reley ?? opts.relay;
  const sandbox: Record<string, unknown> = {
    console: consoleProxy,
    fetch: fetchProxy,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Promise,
    Buffer,
    reley: api,
    // Deprecated: keep `relay` global for scripts written pre-rename.
    relay: api,
  };

  const ctx: Context = createContext(sandbox, {
    name: 'reley-script',
    codeGeneration: { strings: false, wasm: false },
  });

  const wrapper = `
    (async () => {
      ${source}
    })()
  `;
  const start = performance.now();
  try {
    const result = await runInContext(wrapper, ctx, {
      timeout: timeoutMs,
      displayErrors: true,
    });
    return {
      ok: true,
      returnValue: result,
      logs,
      durationMs: performance.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      returnValue: null,
      logs,
      durationMs: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
