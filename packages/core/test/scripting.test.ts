import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scripting/sandbox.js';

describe('runScript', () => {
  it('runs simple js and returns value', async () => {
    const r = await runScript('return 2 + 3;');
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe(5);
  });

  it('captures console output', async () => {
    const r = await runScript('console.log("hello", 42);');
    expect(r.logs).toContain('hello 42');
  });

  it('denies fetch by default', async () => {
    const r = await runScript('await fetch("https://example.com");');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network access denied/);
  });

  it('allows fetch when allowlist matches', async () => {
    const r = await runScript('return typeof fetch;', {
      networkAllowlist: ['https://api.mainnet-beta.solana.com'],
    });
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe('function');
  });

  it('isolates from fs', async () => {
    const r = await runScript('return typeof require;');
    expect(r.ok).toBe(true);
    expect(r.returnValue).toBe('undefined');
  });

  it('rejects code-gen at runtime (eval/Function)', async () => {
    const r = await runScript('return Function("return 1")();');
    expect(r.ok).toBe(false);
  });

  it('passes reley API through', async () => {
    const r = await runScript('return reley.greeting;', {
      reley: { greeting: 'hi' },
    });
    expect(r.returnValue).toBe('hi');
  });

  it('keeps `relay` global as deprecated alias', async () => {
    const r = await runScript('return relay.greeting;', {
      reley: { greeting: 'hi' },
    });
    expect(r.returnValue).toBe('hi');
  });
});
