import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  generateReleaseNotes,
  formatReleaseNotesError,
  renderReleaseNotes,
  runReleaseNotesCommand,
} from './generate-release-notes.mjs';

const release = {
  version: '1.2.0',
  date: '2026-11-19',
  changes: {
    added: ['Nova atividade'],
    improved: ['Fila'],
    changed: [],
    fixed: ['Relógio'],
    removed: [],
    technical: ['Save v1'],
  },
};

describe('generated GitHub release notes', () => {
  it('formats Error and non-Error CLI failures', () => {
    expect(formatReleaseNotesError(new Error('failed'))).toBe('failed');
    expect(formatReleaseNotesError('failed')).toBe('failed');
  });

  it('renders each nonempty category and skips empty sections', () => {
    const notes = renderReleaseNotes(release);
    expect(notes).toContain('# Eternity Realms 1.2.0');
    expect(notes).toContain('## Adicionado\n\n- Nova atividade');
    expect(notes).toContain('## Melhorado\n\n- Fila');
    expect(notes).toContain('## Corrigido\n\n- Relógio');
    expect(notes).toContain('## Técnico\n\n- Save v1');
    expect(notes).not.toContain('## Alterado');
    expect(
      renderReleaseNotes({
        version: '1.2.0',
        date: 'date',
        changes: Object.fromEntries(Object.keys(release.changes).map((key) => [key, []])),
      }),
    ).toBe('# Eternity Realms 1.2.0\n\nPublicado em date.\n');
  });

  it('reports missing releases, invalid entries, and omitted category data', () => {
    expect(() => renderReleaseNotes(null)).toThrow('não possui uma versão válida');
    expect(() => renderReleaseNotes({ version: 'x', changes: { added: [] } })).toThrow(
      'Categoria ausente',
    );
  });

  it('finds the tagged changelog, accepts a v prefix, and writes the generated markdown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eternity-release-'));
    const output = path.join(root, 'release.md');
    try {
      await mkdir(path.join(root, 'content/changelogs'), { recursive: true });
      await writeFile(path.join(root, 'content/changelogs/1.2.0.json'), JSON.stringify(release));
      const notes = await generateReleaseNotes(root, 'v1.2.0', output);
      expect(await readFile(output, 'utf8')).toBe(notes);
      await expect(generateReleaseNotes(root, '2.0.0', output)).rejects.toThrow(
        'Nenhum changelog empacotado',
      );
      await writeFile(path.join(root, 'content/changelogs/2.0.0.json'), '{');
      await expect(generateReleaseNotes(root, '2.0.0', output)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs the CLI entry point for successful and failed release note generation', async () => {
    const output = path.join(os.tmpdir(), `eternity-release-${Date.now()}.md`);
    const scriptPath = path.resolve('scripts/generate-release-notes.mjs');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.argv = [process.execPath, scriptPath, 'v0.1.0', output];
      const success = pathToFileURL(scriptPath);
      success.searchParams.set('coverage', 'success');
      await import(success.href);
      expect(await readFile(output, 'utf8')).toContain('# Eternity Realms 0.1.0');

      process.argv = [process.execPath, scriptPath, '9.9.9', output];
      const failure = pathToFileURL(scriptPath);
      failure.searchParams.set('coverage', 'failure');
      await import(failure.href);
      expect(stderr).toHaveBeenCalledWith('Nenhum changelog empacotado para 9.9.9.\n');

      await expect(runReleaseNotesCommand([], process.cwd())).rejects.toThrow('Uso: node');
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      stderr.mockRestore();
      await rm(output, { force: true });
    }
  });
});
import process from 'node:process';
