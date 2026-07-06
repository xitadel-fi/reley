import type { LogLine, TraceNode } from '@reley/shared';

/**
 * Solana log lines we care about:
 *   "Program <id> invoke [<depth>]"
 *   "Program <id> success"
 *   "Program <id> failed: <reason>"
 *   "Program <id> consumed <n> of <m> compute units"
 *   "Program log: <text>"
 *   "Program data: <base64>"
 *   "Program return: <id> <base64>"
 */

const RE_INVOKE = /^Program (\S+) invoke \[(\d+)\]$/;
const RE_SUCCESS = /^Program (\S+) success$/;
const RE_FAILED = /^Program (\S+) failed: (.+)$/;
const RE_CONSUMED = /^Program (\S+) consumed (\d+) of (\d+) compute units$/;
const RE_PROG_LOG = /^Program log: (.*)$/;
const RE_PROG_DATA = /^Program data: (.*)$/;
const RE_PROG_RETURN = /^Program return: (\S+) (.+)$/;

export interface ParseTraceOptions {
  /** instruction index for the root frame; used to align inner-instruction indices. */
  rootInstructionIndex?: number;
}

export function classifyLog(raw: string): LogLine {
  if (RE_INVOKE.test(raw)) return { raw, level: 'invoke' };
  if (RE_SUCCESS.test(raw)) return { raw, level: 'success' };
  if (RE_FAILED.test(raw)) return { raw, level: 'failure' };
  if (RE_CONSUMED.test(raw)) return { raw, level: 'consumed' };
  if (RE_PROG_LOG.test(raw)) return { raw, level: 'log' };
  if (RE_PROG_DATA.test(raw)) return { raw, level: 'data' };
  if (RE_PROG_RETURN.test(raw)) return { raw, level: 'return' };
  return { raw, level: 'unknown' };
}

interface Frame extends TraceNode {}

function newFrame(programId: string, depth: number, ixIndex: number): Frame {
  return {
    programId,
    depth,
    instructionIndex: ixIndex,
    cuConsumed: 0n,
    cuRemaining: 0n,
    logs: [],
    events: [],
    returnData: null,
    children: [],
    error: null,
  };
}

/**
 * Parse a flat log stream into a tree of TraceNode frames. Returns the list of
 * root frames (one per top-level instruction).
 */
export function parseTrace(logs: string[], opts: ParseTraceOptions = {}): TraceNode[] {
  const roots: Frame[] = [];
  const stack: Frame[] = [];
  let nextRootIndex = opts.rootInstructionIndex ?? 0;

  for (const raw of logs) {
    const line = classifyLog(raw);

    const invoke = raw.match(RE_INVOKE);
    if (invoke) {
      const programId = invoke[1];
      const depth = Number(invoke[2]);
      if (!programId) continue;
      let frame: Frame;
      if (depth === 1) {
        frame = newFrame(programId, depth, nextRootIndex);
        roots.push(frame);
        stack.length = 0;
        stack.push(frame);
        nextRootIndex += 1;
      } else {
        const parent = stack[stack.length - 1];
        if (!parent) continue;
        frame = newFrame(programId, depth, parent.children.length);
        parent.children.push(frame);
        stack.push(frame);
      }
      frame.logs.push(line);
      continue;
    }

    const consumed = raw.match(RE_CONSUMED);
    if (consumed) {
      const programId = consumed[1];
      const used = consumed[2];
      const total = consumed[3];
      const frame = stack[stack.length - 1];
      if (frame && programId === frame.programId && used && total) {
        frame.cuConsumed = BigInt(used);
        frame.cuRemaining = BigInt(total) - BigInt(used);
        frame.logs.push(line);
      }
      continue;
    }

    const failed = raw.match(RE_FAILED);
    if (failed) {
      const programId = failed[1];
      const reason = failed[2];
      const frame = stack[stack.length - 1];
      if (frame && programId === frame.programId && reason) {
        frame.error = reason;
        frame.logs.push(line);
        stack.pop();
      }
      continue;
    }

    if (RE_SUCCESS.test(raw)) {
      const top = stack[stack.length - 1];
      if (top) {
        top.logs.push(line);
        stack.pop();
      }
      continue;
    }

    const ret = raw.match(RE_PROG_RETURN);
    if (ret) {
      const data = ret[2];
      const frame = stack[stack.length - 1];
      if (frame && data) {
        frame.returnData = base64ToBytes(data);
        frame.logs.push(line);
      }
      continue;
    }

    const top = stack[stack.length - 1];
    if (top) top.logs.push(line);
    else roots.push({ ...newFrame('<unknown>', 0, nextRootIndex++), logs: [line] });
  }

  return roots;
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
