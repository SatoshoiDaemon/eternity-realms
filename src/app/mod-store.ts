import { z } from 'zod';
import { loadOfficialContent } from '../content/registry';
import { ContentPackSchema } from '../content/schema';
import type { StoragePort } from './device-settings';
import { APPLICATION_VERSION } from './changelog';

export const MOD_STORE_KEY = 'eternity-realms:mods:v1';

const InstalledModSchema = z.object({ pack: ContentPackSchema, enabled: z.boolean() });
const ModStoreSchema = z.array(InstalledModSchema);
export type InstalledMod = z.infer<typeof InstalledModSchema>;

export interface ModStatus {
  id: string;
  name: string;
  version: string;
  author?: string;
  compatibility?: string;
  origin: 'local';
  dependencies: string[];
  enabled: boolean;
  loaded: boolean;
  error?: string;
}

export function readInstalledMods(storage: StoragePort): InstalledMod[] {
  try {
    return ModStoreSchema.parse(JSON.parse(storage.getItem(MOD_STORE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function validateEnabledMods(mods: InstalledMod[]): void {
  const enabled = mods.filter((mod) => mod.enabled);
  const enabledIds = new Set(['eternity.core', ...enabled.map((mod) => mod.pack.manifest.id)]);
  for (const mod of enabled) {
    if (
      mod.pack.manifest.compatibleWith &&
      mod.pack.manifest.compatibleWith !== APPLICATION_VERSION
    ) {
      throw new Error(
        `Mod "${mod.pack.manifest.id}" declara compatibilidade com ${mod.pack.manifest.compatibleWith}; versão atual ${APPLICATION_VERSION}.`,
      );
    }
    for (const dependency of mod.pack.manifest.dependencies ?? []) {
      if (!enabledIds.has(dependency)) {
        throw new Error(`Mod "${mod.pack.manifest.id}" requer o mod habilitado "${dependency}".`);
      }
    }
  }
  loadOfficialContent(enabled.map((mod) => mod.pack));
}

export function getModStatuses(storage: StoragePort): ModStatus[] {
  const mods = readInstalledMods(storage);
  const errors = new Map<string, string>();
  try {
    validateEnabledMods(mods);
  } catch (error) {
    const message = modLoadError(error);
    for (const mod of mods.filter((entry) => entry.enabled))
      errors.set(mod.pack.manifest.id, message);
  }
  return mods.map(({ pack, enabled }) => ({
    id: pack.manifest.id,
    name: pack.manifest.name,
    version: pack.manifest.version,
    ...(pack.manifest.author ? { author: pack.manifest.author } : {}),
    ...(pack.manifest.compatibleWith ? { compatibility: pack.manifest.compatibleWith } : {}),
    origin: 'local',
    dependencies: pack.manifest.dependencies ?? [],
    enabled,
    loaded: enabled && !errors.has(pack.manifest.id),
    ...(errors.has(pack.manifest.id) ? { error: errors.get(pack.manifest.id) } : {}),
  }));
}

export function modLoadError(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha ao carregar os mods.';
}

export function assertModDependenciesAvailable(dependencies: string[], mods: ModStatus[]): void {
  const available = new Set([
    'eternity.core',
    ...mods.filter((mod) => mod.enabled && mod.loaded).map((mod) => mod.id),
  ]);
  const missing = [...new Set(dependencies)].filter((dependency) => !available.has(dependency));
  if (missing.length)
    throw new Error(`Ative os mods exigidos por este save: ${missing.join(', ')}.`);
}

export function loadInstalledContent(storage: StoragePort) {
  const mods = readInstalledMods(storage);
  validateEnabledMods(mods);
  return loadOfficialContent(mods.filter((mod) => mod.enabled).map((mod) => mod.pack));
}

export function importContentMod(storage: StoragePort, source: string): InstalledMod[] {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new Error('O arquivo do mod não contém JSON válido.');
  }
  const pack = ContentPackSchema.parse(input);
  const mods = readInstalledMods(storage);
  if (
    pack.manifest.id === 'eternity.core' ||
    mods.some((mod) => mod.pack.manifest.id === pack.manifest.id)
  ) {
    throw new Error(`O mod "${pack.manifest.id}" já está instalado ou reservado.`);
  }
  const next = [...mods, { pack, enabled: true }];
  validateEnabledMods(next);
  storage.setItem(MOD_STORE_KEY, JSON.stringify(next));
  return next;
}

export function setModEnabled(storage: StoragePort, id: string, enabled: boolean): InstalledMod[] {
  const mods = readInstalledMods(storage);
  if (!mods.some((mod) => mod.pack.manifest.id === id)) throw new Error(`Mod desconhecido: ${id}`);
  const next = mods.map((mod) => (mod.pack.manifest.id === id ? { ...mod, enabled } : mod));
  validateEnabledMods(next);
  storage.setItem(MOD_STORE_KEY, JSON.stringify(next));
  return next;
}

export function removeInstalledMod(storage: StoragePort, id: string): InstalledMod[] {
  const mods = readInstalledMods(storage);
  if (!mods.some((mod) => mod.pack.manifest.id === id)) throw new Error(`Mod desconhecido: ${id}`);
  const next = mods.filter((mod) => mod.pack.manifest.id !== id);
  validateEnabledMods(next);
  storage.setItem(MOD_STORE_KEY, JSON.stringify(next));
  return next;
}
