import { readFile, readdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const categoryTitles = {
  added: 'Adicionado',
  improved: 'Melhorado',
  changed: 'Alterado',
  fixed: 'Corrigido',
  removed: 'Removido',
  technical: 'Técnico',
};

export function renderReleaseNotes(release) {
  if (
    !release ||
    typeof release !== 'object' ||
    typeof release.version !== 'string' ||
    !release.changes
  ) {
    throw new Error('O changelog informado não possui uma versão válida.');
  }
  const lines = [`# Eternity Realms ${release.version}`, '', `Publicado em ${release.date}.`, ''];
  for (const [category, title] of Object.entries(categoryTitles)) {
    const changes = release.changes[category];
    if (!Array.isArray(changes)) throw new Error(`Categoria ausente no changelog: ${category}.`);
    if (changes.length)
      lines.push(`## ${title}`, '', ...changes.map((change) => `- ${change}`), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function generateReleaseNotes(root, version, outputPath) {
  const directory = path.join(root, 'content/changelogs');
  const filenames = await readdir(directory);
  const wanted = version.replace(/^v/, '');
  const filename = filenames.find((candidate) => candidate === `${wanted}.json`);
  if (!filename) throw new Error(`Nenhum changelog empacotado para ${wanted}.`);
  const release = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
  const markdown = renderReleaseNotes(release);
  await writeFile(outputPath, markdown, 'utf8');
  return markdown;
}

export async function runReleaseNotesCommand(args, root) {
  const [version, outputPath] = args;
  if (!version || !outputPath)
    throw new Error('Uso: node scripts/generate-release-notes.mjs <versão> <arquivo-destino>.');
  return generateReleaseNotes(root, version, outputPath);
}

export function formatReleaseNotesError(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await runReleaseNotesCommand(process.argv.slice(2), root);
  } catch (error) {
    process.stderr.write(`${formatReleaseNotesError(error)}\n`);
    process.exitCode = 1;
  }
}
