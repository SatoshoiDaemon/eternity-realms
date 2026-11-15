import { createCharacter, createInitialGameState } from '../domain/model';
import { loadContentPacks } from '../content/registry';

export const testPack = {
  manifest: { id: 'test.core', name: 'Test Core', version: '1.0.0' },
  records: [
    { id: 'human', kind: 'race', name: 'Human', description: 'A test race.' },
    { id: 'wanderer', kind: 'class', name: 'Wanderer', description: 'A test class.' },
    { id: 'iron-ore', kind: 'item', name: 'Iron Ore', description: 'An ore.', stackable: true },
    {
      id: 'mining',
      kind: 'activity',
      name: 'Mining',
      description: 'Mine iron ore.',
      rewardId: 'mining-reward',
      category: 'gathering',
    },
    {
      id: 'foraging',
      kind: 'activity',
      name: 'Foraging',
      description: 'A second test activity.',
      rewardId: 'mining-reward',
      category: 'gathering',
    },
    {
      id: 'mining-reward',
      kind: 'reward',
      name: 'Mining Reward',
      description: 'A test reward.',
      experience: 120,
      items: [{ itemId: 'iron-ore', quantity: 2 }],
    },
    {
      id: 'mining-skill',
      kind: 'skill',
      name: 'Mining',
      description: 'A test skill.',
      activityIds: ['mining'],
    },
    {
      id: 'focused',
      kind: 'effect',
      name: 'Focused',
      description: 'A test effect.',
      payload: { marker: 'test' },
    },
  ],
  rules: { experiencePerLevel: 100 },
} as const;

export const testCatalog = loadContentPacks([testPack]);

export function createTestState() {
  return {
    ...createInitialGameState(),
    character: createCharacter({
      id: 'character-1',
      name: 'Test Hero',
      raceId: 'human',
      classId: 'wanderer',
    }),
  };
}

export function newTestSession(id: string, durationMs = 1_800_000) {
  return { id, activityId: 'mining', durationMs };
}
