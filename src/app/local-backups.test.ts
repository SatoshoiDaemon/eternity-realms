import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../domain/model';
import type { StoragePort } from './device-settings';
import {
  createLocalBackup,
  listLocalBackups,
  LOCAL_BACKUPS_KEY,
  restoreLocalBackup,
} from './local-backups';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('local save backups', () => {
  it('creates validated, ordered backups and restores the original state', () => {
    const storage = new MemoryStorage();
    const game = createInitialGameState();
    game.character = null;
    const summary = createLocalBackup(storage, game, 100, 7, ['example.mod']);

    expect(summary).toMatchObject({
      id: 'manual-100',
      characterName: 'Sem personagem',
      automatic: false,
    });
    const restored = restoreLocalBackup(storage, summary.id);
    expect(restored?.gameState).toEqual(game);
    expect(restored?.metadata.modDependencies).toEqual(['example.mod']);
    expect(listLocalBackups(storage)).toEqual([summary]);
  });

  it('applies retention, replaces same-time entries, and caps retention at thirty', () => {
    const storage = new MemoryStorage();
    const game = createInitialGameState();
    createLocalBackup(storage, game, 1, 3);
    createLocalBackup(storage, game, 2, 3);
    createLocalBackup(storage, game, 3, 3);
    createLocalBackup(storage, game, 3, 2);
    expect(listLocalBackups(storage).map((backup) => backup.id)).toEqual(['manual-3', 'manual-2']);
    for (let index = 4; index < 40; index += 1) createLocalBackup(storage, game, index, 99);
    expect(listLocalBackups(storage)).toHaveLength(30);
  });

  it('handles damaged storage, returns null for missing backups, and rejects invalid time', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_BACKUPS_KEY, '{');
    expect(listLocalBackups(storage)).toEqual([]);
    storage.setItem(LOCAL_BACKUPS_KEY, 'null');
    expect(listLocalBackups(storage)).toEqual([]);
    storage.setItem(LOCAL_BACKUPS_KEY, '{');
    expect(restoreLocalBackup(storage, 'missing')).toBeNull();
    expect(() => createLocalBackup(storage, createInitialGameState(), -1)).toThrow(
      'horário do backup é inválido',
    );
    storage.setItem(
      LOCAL_BACKUPS_KEY,
      JSON.stringify([{ id: 'bad', createdAt: 1, characterName: 'Broken', payload: '{' }]),
    );
    expect(() => restoreLocalBackup(storage, 'bad')).toThrow('JSON válido');
  });
});
