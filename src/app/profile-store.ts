import { z } from 'zod';
import type { GameState } from '../domain/types';
import { createSaveFile, parseSaveFile } from '../persistence/save-format';
import type { StoragePort } from './device-settings';

export const PROFILE_STORE_KEY = 'eternity-realms:profiles:v1';

const ProfileIndexSchema = z.array(z.object({ id: z.string().min(1), save: z.string() }));

export interface ProfileSummary {
  id: string;
  name: string;
  level: number;
  updatedAt: number;
}

export function listProfiles(storage: StoragePort): ProfileSummary[] {
  let entries: Array<{ id: string; save: string }>;
  try {
    entries = ProfileIndexSchema.parse(JSON.parse(storage.getItem(PROFILE_STORE_KEY) ?? '[]'));
  } catch {
    return [];
  }
  return entries.flatMap(({ id, save }) => {
    try {
      const { gameState: state, metadata } = parseSaveFile(save);
      if (!state.character || state.character.id !== id) return [];
      return [
        {
          id,
          name: state.character.name,
          level: state.character.level,
          updatedAt: metadata.exportedAt,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function persistProfile(
  storage: StoragePort,
  state: GameState,
  now: number,
  modDependencies: string[] = [],
): void {
  const character = state.character;
  if (!character) return;
  let entries: Array<{ id: string; save: string }> = [];
  try {
    entries = ProfileIndexSchema.parse(JSON.parse(storage.getItem(PROFILE_STORE_KEY) ?? '[]'));
  } catch {
    // Invalid profile indexes are replaced with a clean entry below.
  }
  const save = createSaveFile(state, {
    applicationVersion: '0.1.0',
    databaseVersion: 2,
    exportedAt: now,
    modDependencies,
  });
  storage.setItem(
    PROFILE_STORE_KEY,
    JSON.stringify([
      ...entries.filter((entry) => entry.id !== character.id),
      { id: character.id, save },
    ]),
  );
}

export function loadProfile(storage: StoragePort, id: string): GameState | null {
  try {
    const entries = ProfileIndexSchema.parse(
      JSON.parse(storage.getItem(PROFILE_STORE_KEY) ?? '[]'),
    );
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return null;
    const state = parseSaveFile(entry.save).gameState;
    return state.character?.id === id ? state : null;
  } catch {
    return null;
  }
}

export function requireProfile(storage: StoragePort, id: string): GameState {
  const profile = loadProfile(storage, id);
  if (!profile) throw new Error('O save deste personagem não está disponível.');
  return profile;
}

export function removeProfile(storage: StoragePort, id: string): void {
  try {
    const entries = ProfileIndexSchema.parse(
      JSON.parse(storage.getItem(PROFILE_STORE_KEY) ?? '[]'),
    );
    storage.setItem(PROFILE_STORE_KEY, JSON.stringify(entries.filter((entry) => entry.id !== id)));
  } catch {
    storage.setItem(PROFILE_STORE_KEY, '[]');
  }
}
