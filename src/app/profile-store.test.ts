import { describe, expect, it } from 'vitest';
import { createCharacter, createInitialGameState } from '../domain/model';
import type { GameState } from '../domain/types';
import type { StoragePort } from './device-settings';
import {
  listProfiles,
  loadProfile,
  persistProfile,
  PROFILE_STORE_KEY,
  requireProfile,
  removeProfile,
} from './profile-store';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function stateFor(id: string, name: string): GameState {
  const state = createInitialGameState();
  state.character = createCharacter({ id, name, raceId: 'human', classId: 'wanderer' });
  return state;
}

describe('local character profiles', () => {
  it('stores complete isolated character saves and lists profile summaries', () => {
    const storage = new MemoryStorage();
    const first = stateFor('one', 'Aria');
    first.character!.inventory['iron-ore'] = 8;
    persistProfile(storage, first, 100);
    persistProfile(storage, stateFor('two', 'Riven'), 200);

    expect(listProfiles(storage)).toEqual([
      { id: 'one', name: 'Aria', level: 1, updatedAt: 100 },
      { id: 'two', name: 'Riven', level: 1, updatedAt: 200 },
    ]);
    expect(loadProfile(storage, 'one')?.character?.inventory['iron-ore']).toBe(8);
    expect(loadProfile(storage, 'missing')).toBeNull();
  });

  it('updates an existing profile rather than creating duplicate entries', () => {
    const storage = new MemoryStorage();
    const state = stateFor('one', 'Aria');
    persistProfile(storage, state, 1);
    state.character!.name = 'Aria II';
    persistProfile(storage, state, 2);

    expect(listProfiles(storage)).toHaveLength(1);
    expect(listProfiles(storage)[0]).toMatchObject({ name: 'Aria II', updatedAt: 2 });
  });

  it('ignores damaged indexes, corrupt entries, and mismatched character identities', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_STORE_KEY, '{');
    expect(listProfiles(storage)).toEqual([]);
    expect(loadProfile(storage, 'bad')).toBeNull();
    removeProfile(storage, 'bad');
    expect(storage.getItem(PROFILE_STORE_KEY)).toBe('[]');

    storage.setItem(PROFILE_STORE_KEY, '{');
    persistProfile(storage, stateFor('recovered', 'Recovered'), 9);
    expect(listProfiles(storage)).toMatchObject([
      { id: 'recovered', name: 'Recovered', updatedAt: 9 },
    ]);

    storage.setItem(
      PROFILE_STORE_KEY,
      JSON.stringify([
        { id: 'wrong-id', save: JSON.stringify(stateFor('other', 'Mismatch')) },
        { id: 'broken', save: '{' },
      ]),
    );
    expect(listProfiles(storage)).toEqual([]);
    expect(loadProfile(storage, 'wrong-id')).toBeNull();
  });

  it('does not persist a state without a character and removes only the requested profile', () => {
    const storage = new MemoryStorage();
    persistProfile(storage, createInitialGameState(), 5);
    persistProfile(storage, stateFor('one', 'Aria'), 10);
    persistProfile(storage, stateFor('two', 'Riven'), 20);
    removeProfile(storage, 'one');

    expect(listProfiles(storage).map((profile) => profile.id)).toEqual(['two']);
  });

  it('treats a missing profile index as an empty list when loading and removing', () => {
    const storage = new MemoryStorage();
    expect(loadProfile(storage, 'missing')).toBeNull();
    removeProfile(storage, 'missing');
    expect(storage.getItem(PROFILE_STORE_KEY)).toBe('[]');
  });

  it('requires an available profile before switching characters', () => {
    const storage = new MemoryStorage();
    const expected = stateFor('active', 'Active');
    persistProfile(storage, expected, 10);
    expect(requireProfile(storage, 'active')).toMatchObject(expected);
    expect(() => requireProfile(storage, 'missing')).toThrow(
      'O save deste personagem não está disponível.',
    );
  });
});
