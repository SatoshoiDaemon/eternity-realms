import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createCharacter } from './model';
import { getManaSpiritDamageBonus } from './mana-progression';

const content = loadOfficialContent();
const mana = content.energies.get('energy:mana')!;
const character = (affinity = 'mana', spirit = 0) => ({
  ...createCharacter({ id: 'mana-hero', name: 'Hero', raceId: 'human', classId: 'wanderer' }),
  attributes: {
    ...createCharacter({ id: 'mana-hero', name: 'Hero', raceId: 'human', classId: 'wanderer' })
      .attributes,
    energetic: { spirit },
  },
  energy: { affinity, reserves: {} },
});

describe('Mana Spirit combat progression', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 7],
    [3, 7],
    [4, 14],
    [5, 14],
  ])('adds the documented Spirit damage for %i points', (spirit, expected) => {
    expect(getManaSpiritDamageBonus(character('mana', spirit), 'magical', mana)).toBe(expected);
  });

  it('only applies to magical actions made with Mana', () => {
    expect(getManaSpiritDamageBonus(character('aura', 8), 'magical', mana)).toBe(0);
    expect(getManaSpiritDamageBonus(character('mana', 8), 'physical', mana)).toBe(0);
    expect(getManaSpiritDamageBonus(character('mana', 8), 'magical', undefined)).toBe(0);
  });

  it('returns zero if a modded Mana registry has no valid Spirit damage rule', () => {
    expect(getManaSpiritDamageBonus(character(), 'magical', { ...mana, progression: [] })).toBe(0);
    expect(
      getManaSpiritDamageBonus(character(), 'magical', {
        ...mana,
        progression: [{ stage: 'espírito', damagePerTwoPoints: Number.NaN }],
      }),
    ).toBe(0);
    expect(
      getManaSpiritDamageBonus(character(), 'magical', {
        ...mana,
        progression: [{ stage: 'espírito', damagePerTwoPoints: 'invalid' }],
      }),
    ).toBe(0);
    expect(
      getManaSpiritDamageBonus(character(), 'magical', {
        ...mana,
        progression: [{ stage: 'espírito', damagePerTwoPoints: -1 }],
      }),
    ).toBe(0);
  });

  it('ignores absent, negative, and non-finite Spirit attributes', () => {
    expect(getManaSpiritDamageBonus(character('mana', 0), 'magical', mana)).toBe(0);
    expect(getManaSpiritDamageBonus(character('mana', -2), 'magical', mana)).toBe(0);
    expect(getManaSpiritDamageBonus(character('mana', Number.NaN), 'magical', mana)).toBe(0);
    expect(
      getManaSpiritDamageBonus(
        {
          ...character('mana', 0),
          attributes: { ...character('mana', 0).attributes, energetic: {} },
        },
        'magical',
        mana,
      ),
    ).toBe(0);
  });
});
