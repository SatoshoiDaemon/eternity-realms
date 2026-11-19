import type { Character, GameState } from './types';
import { createNodeLibrary } from '../nodes/library';

export interface CreateCharacterInput {
  id: string;
  name: string;
  raceId: string;
  classId: string;
  extensions?: Record<string, unknown>;
}

function requireIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Character ${field} cannot be empty.`);
  }
  return normalized;
}

export function createCharacter(input: CreateCharacterInput): Character {
  const physical = {
    vigor: 1,
    resistance: 1,
    speed: 1,
    dexterity: 1,
    precision: 1,
    strength: 1,
  };

  return {
    id: requireIdentity(input.id, 'id'),
    name: requireIdentity(input.name, 'name'),
    raceId: requireIdentity(input.raceId, 'race id'),
    classId: requireIdentity(input.classId, 'class id'),
    level: 1,
    experience: { current: 0, total: 0 },
    attributes: { physical, energetic: {} },
    energy: { affinity: 'unawakened', reserves: {} },
    equipment: {
      head: null,
      chest: null,
      legs: null,
      hands: null,
      feet: null,
      primary: null,
      secondary: null,
      accessories: [],
    },
    inventory: {},
    abilities: [],
    nodeLibrary: createNodeLibrary(),
    skills: {},
    activityState: 'idle',
    extensions: input.extensions ? { ...input.extensions } : {},
  };
}

export function createInitialGameState(): GameState {
  return {
    schemaVersion: 1,
    revision: 0,
    character: null,
    sessions: [],
    queue: [],
    events: [],
    processedEventIds: [],
    combatRecords: [],
  };
}
