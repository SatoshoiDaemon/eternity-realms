import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import type { SkillDefinition } from '../content/schema';
import { createCharacter } from './model';
import { getSkillEffectBonus } from './skill-effects';

const content = loadOfficialContent();

function skill(id: string, milestones: SkillDefinition['milestones']): SkillDefinition {
  return { id, kind: 'skill', name: id, description: 'Fixture', activityIds: [], milestones };
}

function characterWithSkill(id: string, level: number) {
  const character = createCharacter({
    id: 'alchemy-hero',
    name: 'Hero',
    raceId: 'human',
    classId: 'wanderer',
  });
  character.skills[id] = { level, experience: 0, extensions: {} };
  return character;
}

describe('declared skill milestone effects', () => {
  it('sums unlocked alchemy potion potency milestones and ignores later milestones', () => {
    const definition = content.skills.get('alchemy-skill')!;

    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 5),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(0.1);
    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 10),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBeCloseTo(0.3);
    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 1),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(0);
  });

  it('returns no bonus for missing definitions, empty effect IDs, absent progress, or invalid levels', () => {
    const definition = skill('alchemy-skill', [
      {
        level: 1,
        name: 'Practice',
        effects: [{ type: 'consumable_effect_bonus_percent', value: 1 }],
      },
    ]);

    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 1),
        undefined,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(0);
    expect(getSkillEffectBonus(characterWithSkill('alchemy-skill', 1), definition, '')).toBe(0);
    const noProgress = createCharacter({
      id: 'no-skill',
      name: 'Hero',
      raceId: 'human',
      classId: 'wanderer',
    });
    expect(getSkillEffectBonus(noProgress, definition, 'consumable_effect_bonus_percent')).toBe(0);
    for (const level of [0, -1, 1.5, Number.NaN]) {
      expect(
        getSkillEffectBonus(
          characterWithSkill('alchemy-skill', level),
          definition,
          'consumable_effect_bonus_percent',
        ),
      ).toBe(0);
    }
  });

  it('skips locked milestones, malformed levels and effects, and negative values', () => {
    const definition = skill('alchemy-skill', [
      {
        level: 0,
        name: 'invalid',
        effects: [{ type: 'consumable_effect_bonus_percent', value: 5 }],
      },
      {
        level: Number.NaN,
        name: 'not safe',
        effects: [{ type: 'consumable_effect_bonus_percent', value: 5 }],
      },
      {
        level: 2,
        name: 'locked',
        effects: [{ type: 'consumable_effect_bonus_percent', value: 5 }],
      },
      {
        level: 1,
        name: 'active',
        effects: [
          null,
          'not a record',
          { type: 'other_effect', value: 2 },
          { type: 'consumable_effect_bonus_percent', value: '2' },
          { type: 'consumable_effect_bonus_percent', value: Number.POSITIVE_INFINITY },
          { type: 'consumable_effect_bonus_percent', value: -2 },
          { type: 'consumable_effect_bonus_percent', value: 0.25 },
        ],
      },
    ] as unknown as SkillDefinition['milestones']);

    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 1),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(0.25);
  });

  it('supports legacy skills without milestone data', () => {
    const definition = skill('alchemy-skill', undefined);
    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 1),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(0);
  });

  it('ignores an effect that would overflow the accumulated bonus', () => {
    const definition = skill('alchemy-skill', [
      {
        level: 1,
        name: 'extreme values',
        effects: [
          { type: 'consumable_effect_bonus_percent', value: Number.MAX_VALUE },
          { type: 'consumable_effect_bonus_percent', value: Number.MAX_VALUE },
        ],
      },
    ]);

    expect(
      getSkillEffectBonus(
        characterWithSkill('alchemy-skill', 1),
        definition,
        'consumable_effect_bonus_percent',
      ),
    ).toBe(Number.MAX_VALUE);
  });
});
