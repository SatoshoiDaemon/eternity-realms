import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import type { ActivityDefinition } from '../content/schema';
import { createTestState } from '../test/fixtures';
import { getActivityAccessError, getUnlockedRegionIds } from './activity-access';

const content = loadOfficialContent();

describe('activity and region progression access', () => {
  it('unlocks regions in their declared level and prerequisite order', () => {
    const character = createTestState().character!;
    expect(getUnlockedRegionIds(character, content.regions)).toEqual(['apexia']);

    const advanced = { ...character, level: 4 };
    expect(getUnlockedRegionIds(advanced, content.regions)).toEqual([
      'apexia',
      'dross',
      'vaeloria',
    ]);
  });

  it('reports level, skill, and region requirements before a session is enqueued', () => {
    const character = createTestState().character!;
    const adamantite = content.activities.get('mine-adamantite')!;
    expect(getActivityAccessError(character, adamantite, content)).toBe(
      'Activity requires character level 10.',
    );
    expect(getActivityAccessError({ ...character, level: 10 }, adamantite, content)).toBe(
      'Activity requires mining-skill level 3.',
    );
    expect(
      getActivityAccessError(
        {
          ...character,
          level: 10,
          skills: { 'mining-skill': { level: 3, experience: 0, extensions: {} } },
        },
        adamantite,
        content,
      ),
    ).toBeUndefined();
  });

  it('rejects invalid region prerequisite cycles without looping', () => {
    const regions = new Map([
      ['one', { unlockRequirements: { regionIds: ['two'] } }],
      ['two', { unlockRequirements: { regionIds: ['one'] } }],
    ]);
    expect(getUnlockedRegionIds(createTestState().character!, regions as never)).toEqual([]);
  });

  it('reports malformed skill references and unknown or locked regions', () => {
    const character = createTestState().character!;
    const noSkill = {
      id: 'bad-skill-activity',
      name: 'Bad skill activity',
      description: '',
      requiredSkillLevel: 2,
    } as unknown as ActivityDefinition;
    expect(getActivityAccessError(character, noSkill, content)).toBe(
      'Activity has a skill requirement but no associated skill.',
    );
    expect(
      getActivityAccessError(
        character,
        { ...noSkill, requiredSkillLevel: undefined, regionId: 'missing-region' },
        content,
      ),
    ).toBe('Activity references unknown region missing-region.');
    expect(
      getActivityAccessError(
        character,
        { ...noSkill, requiredSkillLevel: undefined, regionId: 'vaeloria' },
        content,
      ),
    ).toBe('Region Vaeloria is locked.');
  });

  it('blocks Mana and Aura attribute training for Sem Afinidade characters', () => {
    const character = {
      ...createTestState().character!,
      energy: { affinity: 'unaffiliated', reserves: {} },
    };
    const meditation = {
      id: 'mana-cultivation',
      name: 'Mana cultivation',
      description: '',
      trainingEffect: { attributeId: 'energy:mana', amount: 2 },
    } as unknown as ActivityDefinition;
    expect(getActivityAccessError(character, meditation, content)).toBe(
      'Sem Afinidade characters cannot train energy attributes.',
    );
    expect(
      getActivityAccessError(
        character,
        { ...meditation, trainingEffect: { attributeId: 'physical:strength', amount: 2 } },
        content,
      ),
    ).toBeUndefined();
  });

  it('keeps queued energy training on the selected Mana or Aura path', () => {
    const aura = {
      ...createTestState().character!,
      energy: { affinity: 'aura', reserves: {} },
    };
    const mana = {
      ...createTestState().character!,
      energy: { affinity: 'mana', reserves: {} },
    };
    const chiTraining = {
      id: 'chi-cultivation',
      name: 'Chi cultivation',
      description: '',
      trainingEffect: { attributeId: 'energy:chi', amount: 1 },
    } as unknown as ActivityDefinition;
    const manaTraining = {
      ...chiTraining,
      trainingEffect: { attributeId: 'energy:mana', amount: 1 },
    } as unknown as ActivityDefinition;

    expect(getActivityAccessError(aura, manaTraining, content)).toBe(
      'Aura characters cannot train Mana or Spirit attributes.',
    );
    expect(getActivityAccessError(mana, chiTraining, content)).toBe(
      'Mana characters cannot train Chi through Aura cultivation.',
    );
    expect(getActivityAccessError(aura, chiTraining, content)).toBeUndefined();
  });
});
