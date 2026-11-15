import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyWasmAssets } from './copy-wasm-assets.mjs';

describe('WebAssembly asset preparation', () => {
  let temporaryDirectory;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('copies SQLite and Lua runtimes into the offline application assets', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'eternity-realms-wasm-'));
    const sqliteSource = join(temporaryDirectory, 'node_modules', 'sql.js', 'dist');
    const luaSource = join(temporaryDirectory, 'node_modules', 'wasmoon', 'dist');
    await mkdir(sqliteSource, { recursive: true });
    await mkdir(luaSource, { recursive: true });
    await writeFile(join(sqliteSource, 'sql-wasm.wasm'), 'sqlite-wasm');
    await writeFile(join(luaSource, 'glue.wasm'), 'lua-wasm');

    await copyWasmAssets(temporaryDirectory);

    const assets = join(temporaryDirectory, 'public', 'assets');
    expect(await readFile(join(assets, 'sql-wasm.wasm'), 'utf8')).toBe('sqlite-wasm');
    expect(await readFile(join(assets, 'glue.wasm'), 'utf8')).toBe('lua-wasm');
  });
});
