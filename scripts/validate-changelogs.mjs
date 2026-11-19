import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredCategories = ['added', 'improved', 'changed', 'fixed', 'removed', 'technical'];

export function validateChangelogData(entries, applicationVersion) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('At least one changelog entry is required.');
  const versions = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version)
    ) {
      throw new Error('Each changelog entry requires a semantic version.');
    }
    if (versions.has(entry.version))
      throw new Error(`Duplicate changelog version: ${entry.version}.`);
    versions.add(entry.version);
    if (typeof entry.date !== 'string' || Number.isNaN(Date.parse(entry.date)))
      throw new Error(`Invalid release date for ${entry.version}.`);
    if (!entry.changes || typeof entry.changes !== 'object')
      throw new Error(`Missing change categories for ${entry.version}.`);
    for (const category of requiredCategories) {
      if (
        !Array.isArray(entry.changes[category]) ||
        entry.changes[category].some((change) => typeof change !== 'string' || !change.trim())
      ) {
        throw new Error(`Invalid ${category} changes for ${entry.version}.`);
      }
    }
  }
  if (!versions.has(applicationVersion))
    throw new Error(`No changelog matches application version ${applicationVersion}.`);
  return true;
}

export async function validateRepositoryChangelogs(
  root,
  write = (message) => process.stdout.write(message),
) {
  const filenames = await readdir(path.join(root, 'content/changelogs'));
  const entries = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith('.json'))
      .map(async (filename) => {
        const parsed = JSON.parse(
          await readFile(path.join(root, 'content/changelogs', filename), 'utf8'),
        );
        if (path.basename(filename, '.json') !== parsed.version)
          throw new Error(`Changelog filename does not match version ${parsed.version}.`);
        return parsed;
      }),
  );
  const packageData = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  validateChangelogData(entries, packageData.version);
  write(`Validated ${entries.length} changelog version(s).\n`);
}

export function isChangelogCommand(invokedPath, scriptPath = fileURLToPath(import.meta.url)) {
  return Boolean(invokedPath && path.resolve(invokedPath) === scriptPath);
}

export function formatChangelogError(error) {
  return `${error instanceof Error ? error.message : String(error)}\n`;
}

export async function runChangelogCommand(root, stderr = process.stderr) {
  try {
    await validateRepositoryChangelogs(root);
  } catch (error) {
    stderr.write(formatChangelogError(error));
    process.exitCode = 1;
  }
}

if (isChangelogCommand(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await runChangelogCommand(root);
}
