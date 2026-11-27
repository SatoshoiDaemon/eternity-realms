import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import type { SkillDefinition } from '../content/schema';
import type { Character } from './types';
import { createCharacter } from './model';
import { getCombatSkillAction } from './combat-skill-effects';
import type { CombatAction } from '../combat/types';

const content = loadOfficialContent();
const baseCharacter = (): Character =>
  createCharacter({
    id: 'combat-skill-hero',
    name: 'Hero',
    raceId: 'human',
    classId: 'wanderer',
  });

function action(overrides: Partial<CombatAction> = {}): CombatAction {
  return {
    id: 'test:action',
    name: 'Test action',
    kind: 'attack',
    target: 'enemy',
    intervalMs: 1_000,
    accuracy: 0.8,
    damage: {
      amount: 100,
      channel: 'physical',
      properties: [],
      origin: { kind: 'ability', id: 'test:action' },
    },
    ...overrides,
  };
}

function definition(id: string, milestones: SkillDefinition['milestones']): SkillDefinition {
  return {
    id,
    kind: 'skill',
    name: id,
    description: 'Combat skill fixture.',
    activityIds: [],
    milestones,
  };
}

describe('combat skill effects', () => {
  it('applies the declared Mana magic, Archery damage, and Targeting accuracy milestones', () => {
    const hero = {
      ...baseCharacter(),
      skills: {
        'magic-skill': { level: 10, experience: 0, extensions: {} },
        'archery-skill': { level: 5, experience: 0, extensions: {} },
        'targeting-skill': { level: 10, experience: 0, extensions: {} },
      },
    };
    const skills = [...content.skills.values()];

    expect(
      getCombatSkillAction(
        hero,
        action({ kind: 'magic', damage: { ...action().damage!, channel: 'magical' } }),
        skills,
      ).damage?.amount,
    ).toBe(130);
    const ranged = getCombatSkillAction(hero, action({ kind: 'ranged', accuracy: 0.8 }), skills);
    expect(ranged.damage?.amount).toBe(110);
    expect(ranged.accuracy).toBeCloseTo(0.95);
  });

  it('only applies each damage milestone to its matching action channel', () => {
    const hero = {
      ...baseCharacter(),
      skills: {
        'magic-skill': { level: 5, experience: 0, extensions: {} },
        'archery-skill': { level: 10, experience: 0, extensions: {} },
      },
    };
    const skills = [...content.skills.values()];
    const magicalMelee = action({
      kind: 'attack',
      damage: { ...action().damage!, channel: 'magical' },
    });
    const physicalMelee = action();
    const rangedMagic = action({
      kind: 'ranged',
      damage: { ...action().damage!, channel: 'magical' },
    });

    expect(getCombatSkillAction(hero, magicalMelee, skills).damage?.amount).toBe(110);
    expect(getCombatSkillAction(hero, physicalMelee, skills).damage?.amount).toBe(100);
    expect(getCombatSkillAction(hero, rangedMagic, skills).damage?.amount).toBe(110);
  });

  it('leaves untrained, invalid, locked, and unrelated skill data inert', () => {
    const skill = definition('adapted-skill', [
      {
        level: 0,
        name: 'invalid level',
        effects: [{ type: 'magic_damage_bonus_percent', value: 1 }],
      },
      { level: 5, name: 'locked', effects: [{ type: 'magic_damage_bonus_percent', value: 1 }] },
      {
        level: 1,
        name: 'invalid effects',
        effects: [
          { type: 'magic_damage_bonus_percent', value: -1 },
          { type: 'magic_damage_bonus_percent', value: Number.POSITIVE_INFINITY },
          { type: 'magic_damage_bonus_percent', value: '1' },
          { type: 'unrelated_effect', value: 1 },
        ],
      },
    ]);
    const hero = {
      ...baseCharacter(),
      skills: { 'adapted-skill': { level: 0, experience: 0, extensions: {} } },
    };
    const magical = action({ kind: 'magic', damage: { ...action().damage!, channel: 'magical' } });

    expect(getCombatSkillAction(hero, magical, [skill])).toEqual(magical);
    expect(getCombatSkillAction(baseCharacter(), magical, [skill])).toEqual(magical);
  });

  it('ignores malformed effect records and safely ignores overflowing accumulated bonuses', () => {
    const malformed = definition('malformed', [
      {
        level: 1,
        name: 'malformed effects',
        effects: [
          null,
          'not an effect',
          { type: 'magic_damage_bonus_percent', value: Number.MAX_VALUE },
          { type: 'magic_damage_bonus_percent', value: Number.MAX_VALUE },
        ],
      },
    ] as unknown as SkillDefinition['milestones']);
    const hero = {
      ...baseCharacter(),
      skills: { malformed: { level: 1, experience: 0, extensions: {} } },
    };
    const noDamage = action({ kind: 'support', damage: undefined });

    expect(getCombatSkillAction(hero, noDamage, [malformed])).toEqual(noDamage);
  });

  it('rejects skill bonuses that would overflow combat damage storage', () => {
    const overflowing = definition('overflowing', [
      {
        level: 1,
        name: 'unsafe damage',
        effects: [{ type: 'magic_damage_bonus_percent', value: Number.MAX_VALUE }],
      },
    ]);
    const hero = {
      ...baseCharacter(),
      skills: { overflowing: { level: 1, experience: 0, extensions: {} } },
    };
    const magical = action({ kind: 'magic', damage: { ...action().damage!, channel: 'magical' } });

    expect(() => getCombatSkillAction(hero, magical, [overflowing])).toThrow(
      'Combat skill effects exceed the safe damage range for test:action.',
    );
  });

  it('uses level-one skills without activating future milestones and keeps action data immutable', () => {
    const hero = {
      ...baseCharacter(),
      skills: { 'targeting-skill': { level: 1, experience: 0, extensions: {} } },
    };
    const ranged = action({ kind: 'ranged' });
    const result = getCombatSkillAction(hero, ranged, [...content.skills.values()]);

    expect(result).toEqual(ranged);
    expect(result).not.toBe(ranged);
    expect(result.damage).not.toBe(ranged.damage);
  });

  it('accepts skill definitions without optional milestone data', () => {
    const hero = {
      ...baseCharacter(),
      skills: { 'no-milestones': { level: 1, experience: 0, extensions: {} } },
    };
    const skill = definition('no-milestones', undefined);
    const ranged = action({ kind: 'ranged' });

    expect(getCombatSkillAction(hero, ranged, [skill])).toEqual(ranged);
  });
});
