// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLuaWasmUri, runLuaTransform } from './lua-runtime';

describe('WebAssembly Lua mod runtime', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a packaged local WebAssembly asset in browser builds and Node resolution in tests', () => {
    expect(getLuaWasmUri()).toBeUndefined();
    vi.stubGlobal('document', { baseURI: 'https://localhost/' });
    expect(getLuaWasmUri()).toBe('https://localhost/assets/glue.wasm');
  });

  it('passes JSON data through a mod transform and returns validated JSON', async () => {
    const result = await runLuaTransform<{ amount: number }, { amount: number }>(
      'function transform(input) return string.gsub(input, "1", "2") end',
      { amount: 1 },
    );

    expect(result).toEqual({ amount: 2 });
  });

  it('rejects scripts that do not return valid JSON', async () => {
    await expect(
      runLuaTransform('function transform(input) return "not-json" end', {}),
    ).rejects.toThrow('Lua transform must return valid JSON.');
  });

  it('rejects non-string results and values that are not JSON-serializable', async () => {
    await expect(runLuaTransform('function transform(input) return 7 end', {})).rejects.toThrow(
      'Lua transform must return JSON text.',
    );
    await expect(runLuaTransform('return nil', undefined)).rejects.toThrow(
      'Lua input must be JSON-serializable.',
    );
  });

  it('propagates Lua syntax and runtime errors', async () => {
    await expect(runLuaTransform('this is not valid lua', {})).rejects.toThrow();
  });
});
