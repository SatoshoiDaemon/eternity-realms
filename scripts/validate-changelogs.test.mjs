import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatChangelogError,
  isChangelogCommand,
  runChangelogCommand,
  validateChangelogData,
  validateRepositoryChangelogs,
} from './validate-changelogs.mjs';

const entry = {
  version: '1.2.0',
  date: '2026-11-19',
  changes: { added: ['Feature'], improved: [], changed: [], fixed: [], removed: [], technical: [] },
};

describe('changelog release validation', () => {
  it('accepts current semantic version entries with all categories', () => {
    expect(validateChangelogData([entry], '1.2.0')).toBe(true);
  });

  it('rejects empty entries, invalid versions, and duplicate versions', () => {
    expect(() => validateChangelogData([], '1.2.0')).toThrow(
      'At least one changelog entry is required.',
    );
    expect(() => validateChangelogData([{ ...entry, version: 'bad' }], 'bad')).toThrow(
      'semantic version',
    );
    expect(() => validateChangelogData([entry, entry], '1.2.0')).toThrow(
      'Duplicate changelog version',
    );
  });

  it('rejects invalid dates and missing category records', () => {
    expect(() => validateChangelogData([{ ...entry, date: 'unknown' }], '1.2.0')).toThrow(
      'Invalid release date',
    );
    expect(() => validateChangelogData([{ ...entry, changes: undefined }], '1.2.0')).toThrow(
      'Missing change categories',
    );
  });

  it('rejects invalid category items and missing current version', () => {
    expect(() =>
      validateChangelogData([{ ...entry, changes: { ...entry.changes, fixed: ['  '] } }], '1.2.0'),
    ).toThrow('Invalid fixed changes');
    expect(() => validateChangelogData([entry], '2.0.0')).toThrow(
      'No changelog matches application version',
    );
  });

  it('validates repository filenames, package version, and emits a CI summary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eternity-changelog-'));
    const output = [];
    try {
      await mkdir(path.join(root, 'content/changelogs'), { recursive: true });
      await writeFile(path.join(root, 'content/changelogs/1.2.0.json'), JSON.stringify(entry));
      await writeFile(path.join(root, 'content/changelogs/notes.txt'), 'ignored');
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.0' }));
      await validateRepositoryChangelogs(root, (message) => output.push(message));
      expect(output).toEqual(['Validated 1 changelog version(s).\n']);
      await rm(path.join(root, 'content/changelogs/1.2.0.json'));
      await writeFile(
        path.join(root, 'content/changelogs/1.2.0.json'),
        JSON.stringify({ ...entry, version: '1.3.0' }),
      );
      await expect(validateRepositoryChangelogs(root, () => {})).rejects.toThrow(
        'filename does not match',
      );
      await rm(path.join(root, 'content/changelogs/1.2.0.json'));
      await writeFile(path.join(root, 'content/changelogs/1.2.0.json'), '{');
      await expect(validateRepositoryChangelogs(root, () => {})).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('identifies direct CLI invocation and formats thrown and non-Error failures', () => {
    const scriptPath = path.resolve('scripts/validate-changelogs.mjs');
    expect(isChangelogCommand(scriptPath)).toBe(true);
    expect(
      isChangelogCommand(
        '/repo/scripts/validate-changelogs.mjs',
        '/repo/scripts/validate-changelogs.mjs',
      ),
    ).toBe(true);
    expect(isChangelogCommand(undefined, '/repo/scripts/validate-changelogs.mjs')).toBe(false);
    expect(
      isChangelogCommand('/repo/scripts/test.mjs', '/repo/scripts/validate-changelogs.mjs'),
    ).toBe(false);
    expect(formatChangelogError(new Error('bad release'))).toBe('bad release\n');
    expect(formatChangelogError('bad release')).toBe('bad release\n');
  });

  it('executes the CLI entry point and reports repository errors', async () => {
    const scriptPath = path.resolve('scripts/validate-changelogs.mjs');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.fn();
    try {
      process.argv = [process.execPath, scriptPath];
      const success = pathToFileURL(scriptPath);
      success.searchParams.set('coverage', 'success');
      await import(success.href);
      expect(stdout).toHaveBeenCalledWith('Validated 1 changelog version(s).\n');

      await runChangelogCommand('/repository/with/no/changelogs', { write: stderr });
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      stdout.mockRestore();
    }
  });
});
import process from 'node:process';
