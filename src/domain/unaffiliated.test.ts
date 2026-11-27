import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createCharacter } from './model';
import { getUnaffiliatedEffects } from './unaffiliated';

const content = loadOfficialContent();
const character = (affinity = 'unaffiliated') => ({
  ...createCharacter({
    id: 'unaffiliated-hero',
    name: 'Hero',
    raceId: 'human',
    classId: 'wanderer',
  }),
  energy: { affinity, reserves: {} },
});

describe('Sem Afinidade progression effects', () => {
  it('loads the Incomplete mechanics from the declarative energy registry', () => {
    expect(
      getUnaffiliatedEffects(character(), content.energies.get('energy:unaffiliated')),
    ).toEqual({
      damageReduction: 0.2,
      physicalAttributeBonus: 40,
      trainingGainMultiplier: 2,
      directEnergyEffectMultiplier: 1,
      forbiddenAttributes: ['energy:chi', 'energy:mana', 'energy:spirit'],
    });
  });

  it('preserves the documented Restrição Celestial values for an explicitly staged save', () => {
    expect(
      getUnaffiliatedEffects(
        {
          ...character(),
          energy: {
            affinity: 'unaffiliated',
            unaffiliatedStage: 'celestial-restriction',
            reserves: {},
          },
        },
        content.energies.get('energy:unaffiliated'),
      ),
    ).toMatchObject({
      damageReduction: 0.4,
      physicalAttributeBonus: 150,
      trainingGainMultiplier: 2,
      directEnergyEffectMultiplier: 0.2,
    });
  });

  it('uses neutral defaults for other energy paths, absent records, and unknown stages', () => {
    expect(
      getUnaffiliatedEffects(character('mana'), content.energies.get('energy:unaffiliated')),
    ).toMatchObject({ damageReduction: 0, physicalAttributeBonus: 0, trainingGainMultiplier: 1 });
    expect(getUnaffiliatedEffects(character(), undefined)).toMatchObject({
      damageReduction: 0,
      physicalAttributeBonus: 0,
      trainingGainMultiplier: 1,
    });
    expect(
      getUnaffiliatedEffects(
        {
          ...character(),
          energy: { affinity: 'unaffiliated', unaffiliatedStage: 'missing' as never, reserves: {} },
        },
        content.energies.get('energy:unaffiliated'),
      ),
    ).toMatchObject({ damageReduction: 0, physicalAttributeBonus: 0 });
  });

  it('ignores malformed optional stage effects and defaults missing modifiers safely', () => {
    const definition = content.energies.get('energy:unaffiliated')!;
    const malformed = {
      ...definition,
      progression: [
        {
          stage: 'incomplete',
          damageReduction: Number.NaN,
          physicalAttributeBonus: 'invalid',
          trainingGainMultiplier: Number.POSITIVE_INFINITY,
          directEnergyEffectMultiplier: 0.5,
          forbiddenAttributes: [5],
        },
      ],
    };
    expect(getUnaffiliatedEffects(character(), malformed)).toEqual({
      damageReduction: 0,
      physicalAttributeBonus: 0,
      trainingGainMultiplier: 1,
      directEnergyEffectMultiplier: 0.5,
      forbiddenAttributes: [],
    });
    expect(
      getUnaffiliatedEffects(character(), {
        ...definition,
        progression: [{ stage: 'incomplete' }],
      }),
    ).toEqual({
      damageReduction: 0,
      physicalAttributeBonus: 0,
      trainingGainMultiplier: 1,
      directEnergyEffectMultiplier: 1,
      forbiddenAttributes: [],
    });
  });
});
