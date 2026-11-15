import { LuaFactory } from 'wasmoon';

export function getLuaWasmUri(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return new URL('assets/glue.wasm', document.baseURI).toString();
}

export async function runLuaTransform<TInput, TOutput>(
  source: string,
  input: TInput,
): Promise<TOutput> {
  const inputJson = JSON.stringify(input);
  if (inputJson === undefined) {
    throw new Error('Lua input must be JSON-serializable.');
  }

  const lua = await new LuaFactory(getLuaWasmUri()).createEngine({ functionTimeout: 1_000 });
  try {
    lua.global.set('contextJson', inputJson);
    const result: unknown = await lua.doString(`${source}\nreturn transform(contextJson)`);
    if (typeof result !== 'string') {
      throw new Error('Lua transform must return JSON text.');
    }
    try {
      return JSON.parse(result) as TOutput;
    } catch {
      throw new Error('Lua transform must return valid JSON.');
    }
  } finally {
    lua.global.close();
  }
}
