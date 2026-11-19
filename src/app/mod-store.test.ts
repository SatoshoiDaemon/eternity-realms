import { describe, expect, it } from 'vitest';
import type { StoragePort } from './device-settings';
import {
  assertModDependenciesAvailable,
  getModStatuses,
  importContentMod,
  loadInstalledContent,
  MOD_STORE_KEY,
  modLoadError,
  readInstalledMods,
  removeInstalledMod,
  setModEnabled,
} from './mod-store';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const pack = (id: string, dependencies: string[] = [], author?: string) => ({
  manifest: {
    id,
    name: `${id} pack`,
    version: '1.2.0',
    ...(author ? { author } : {}),
    dependencies,
  },
  records: [],
});

describe('installed content packs', () => {
  it('validates and persists imported content then loads it into the official catalog', () => {
    const storage = new MemoryStorage();
    const imported = importContentMod(
      storage,
      JSON.stringify(pack('test.pack', ['eternity.core'], 'Krieg')),
    );

    expect(imported[0]?.enabled).toBe(true);
    expect(getModStatuses(storage)[0]).toMatchObject({
      id: 'test.pack',
      author: 'Krieg',
      loaded: true,
    });
    expect(loadInstalledContent(storage).packIds).toContain('test.pack');
  });

  it('rejects malformed, invalid, reserved, and duplicate mods without replacing stored data', () => {
    const storage = new MemoryStorage();
    expect(() => importContentMod(storage, '{')).toThrow(
      'O arquivo do mod não contém JSON válido.',
    );
    expect(() =>
      importContentMod(storage, JSON.stringify({ manifest: {}, records: [] })),
    ).toThrow();
    expect(() => importContentMod(storage, JSON.stringify(pack('eternity.core')))).toThrow(
      'já está instalado ou reservado',
    );
    importContentMod(storage, JSON.stringify(pack('test.pack')));
    const before = storage.getItem(MOD_STORE_KEY);
    expect(() => importContentMod(storage, JSON.stringify(pack('test.pack')))).toThrow(
      'já está instalado ou reservado',
    );
    expect(storage.getItem(MOD_STORE_KEY)).toBe(before);
  });

  it('enforces enabled dependencies when importing, disabling, or removing packs', () => {
    const storage = new MemoryStorage();
    expect(() => importContentMod(storage, JSON.stringify(pack('child', ['parent'])))).toThrow(
      'requer o mod habilitado',
    );
    importContentMod(storage, JSON.stringify(pack('parent')));
    importContentMod(storage, JSON.stringify(pack('child', ['parent'])));
    expect(() => setModEnabled(storage, 'parent', false)).toThrow('requer o mod habilitado');
    expect(() => removeInstalledMod(storage, 'parent')).toThrow('requer o mod habilitado');
    expect(readInstalledMods(storage)).toHaveLength(2);
    expect(
      setModEnabled(storage, 'child', false).find((mod) => mod.pack.manifest.id === 'child')
        ?.enabled,
    ).toBe(false);
    expect(
      setModEnabled(storage, 'parent', false).find((mod) => mod.pack.manifest.id === 'parent')
        ?.enabled,
    ).toBe(false);
  });

  it('reports invalid persisted dependencies and safely handles corrupt local storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      MOD_STORE_KEY,
      JSON.stringify([{ pack: pack('orphan', ['missing']), enabled: true }]),
    );
    expect(getModStatuses(storage)[0]).toMatchObject({
      loaded: false,
      error: expect.stringContaining('missing'),
    });
    expect(() => loadInstalledContent(storage)).toThrow('requer o mod habilitado');
    storage.setItem(MOD_STORE_KEY, '{');
    expect(readInstalledMods(storage)).toEqual([]);
    expect(getModStatuses(storage)).toEqual([]);
  });

  it('reports mods that target a different application version', () => {
    const storage = new MemoryStorage();
    const incompatible = {
      manifest: { id: 'old.pack', name: 'Old pack', version: '1.0.0', compatibleWith: '9.9.9' },
      records: [],
    };
    storage.setItem(MOD_STORE_KEY, JSON.stringify([{ pack: incompatible, enabled: true }]));
    expect(getModStatuses(storage)[0]).toMatchObject({
      id: 'old.pack',
      loaded: false,
      compatibility: '9.9.9',
      error: expect.stringContaining('versão atual 0.1.0'),
    });
  });

  it('formats unexpected mod loader failures without exposing raw values', () => {
    expect(modLoadError(new Error('validation failed'))).toBe('validation failed');
    expect(modLoadError('unexpected failure')).toBe('Falha ao carregar os mods.');
  });

  it('rejects operations on unknown installed ids', () => {
    const storage = new MemoryStorage();
    expect(() => setModEnabled(storage, 'missing', true)).toThrow('Mod desconhecido: missing');
    expect(() => removeInstalledMod(storage, 'missing')).toThrow('Mod desconhecido: missing');
  });

  it('checks save dependencies against active loaded mods', () => {
    const storage = new MemoryStorage();
    importContentMod(storage, JSON.stringify(pack('test.pack')));
    const statuses = getModStatuses(storage);
    expect(() =>
      assertModDependenciesAvailable(['eternity.core', 'test.pack'], statuses),
    ).not.toThrow();
    expect(() => assertModDependenciesAvailable(['absent.pack'], statuses)).toThrow(
      'Ative os mods exigidos',
    );
    expect(() =>
      assertModDependenciesAvailable(['test.pack'], [{ ...statuses[0]!, loaded: false }]),
    ).toThrow('Ative os mods exigidos');
  });
});
