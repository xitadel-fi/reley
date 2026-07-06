import { ErrorCode, RelayError } from '@reley/shared';
import type { HandlerMap, RpcRequest, RpcResponse } from './protocol.js';

export class Dispatcher {
  private readonly handlers: HandlerMap;

  constructor(handlers: HandlerMap) {
    this.handlers = handlers;
  }

  async dispatch(req: RpcRequest): Promise<RpcResponse> {
    const handler = this.handlers[req.method];
    if (!handler) {
      return {
        id: req.id,
        error: { code: ErrorCode.INVALID_INPUT, message: `unknown method: ${req.method}` },
      };
    }
    try {
      const result = await handler(req.params);
      return { id: req.id, result };
    } catch (err) {
      if (err instanceof RelayError) {
        return {
          id: req.id,
          error: {
            code: err.code,
            message: err.message,
            ...(err.details && { details: err.details }),
          },
        };
      }
      return {
        id: req.id,
        error: {
          code: ErrorCode.INTERNAL,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const resp = await this.dispatch({ id: 0, method, params });
    if ('error' in resp) {
      throw new RelayError(resp.error.code as ErrorCode, resp.error.message, resp.error.details);
    }
    return resp.result;
  }
}
