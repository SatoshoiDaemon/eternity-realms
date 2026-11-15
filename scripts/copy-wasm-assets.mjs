import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cwd } from 'node:process';

export async function copyWasmAssets(root = cwd()) {
  const sourceDirectory = resolve(root, 'node_modules');
  const destinationDirectory = resolve(root, 'public', 'assets');
  await mkdir(destinationDirectory, { recursive: true });
  await Promise.all([
    copyFile(
      resolve(sourceDirectory, 'sql.js', 'dist', 'sql-wasm.wasm'),
      resolve(destinationDirectory, 'sql-wasm.wasm'),
    ),
    copyFile(
      resolve(sourceDirectory, 'wasmoon', 'dist', 'glue.wasm'),
      resolve(destinationDirectory, 'glue.wasm'),
    ),
  ]);
}
