import { describe, expect, it } from 'vitest';
import { awardExperience, grantItems, grantLootDrops } from './progression';
import { createTestState } from '../test/fixtures';

describe('character progression', () => {
  it('carries excess experience through multiple levels without a level cap', () => {
    const character = createTestState().character!;
    const next = awardExperience(character, 350, { experiencePerLevel: 100 });

    expect(next.character.level).toBe(4);
    expect(next.character.experience).toEqual({ current: 50, total: 350 });
    expect(next.events.map((event) => event.type)).toEqual([
      'experience.gained',
      'level.increased',
      'level.increased',
      'level.increased',
    ]);
  });

  it('accepts zero experience without emitting a level event', () => {
    const character = createTestState().character!;
    const next = awardExperience(character, 0, { experiencePerLevel: 100 });

    expect(next.character).toEqual(character);
    expect(next.events).toEqual([]);
  });

  it('rejects invalid experience values and thresholds', () => {
    const character = createTestState().character!;
    expect(() => awardExperience(character, -1, { experiencePerLevel: 100 })).toThrow(
      'Experience must be a non-negative safe integer.',
    );
    expect(() =>
      awardExperience(character, Number.MAX_SAFE_INTEGER + 1, { experiencePerLevel: 100 }),
    ).toThrow('Experience must be a non-negative safe integer.');
    expect(() => awardExperience(character, 5, { experiencePerLevel: 0 })).toThrow(
      'Experience per level must be a positive safe integer.',
    );
    expect(() =>
      awardExperience(
        { ...character, experience: { current: 0, total: Number.MAX_SAFE_INTEGER } },
        1,
        { experiencePerLevel: 100 },
      ),
    ).toThrow('Total experience exceeds the safe integer range.');
    expect(() =>
      awardExperience({ ...character, level: Number.MAX_SAFE_INTEGER }, 100, {
        experiencePerLevel: 100,
      }),
    ).toThrow('Character level exceeds the safe integer range.');
  });

  it('adds items without an inventory capacity and rejects invalid quantities', () => {
    const character = createTestState().character!;
    const fullInventory = grantItems(character, { 'iron-ore': 1_000_000 });
    const stacked = grantItems(fullInventory.character, { 'iron-ore': 7, 'ancient-relic': 1 });

    expect(stacked.character.inventory).toEqual({
      'iron-ore': 1_000_007,
      'ancient-relic': 1,
    });
    expect(stacked.events.map((event) => event.type)).toEqual(['item.acquired', 'item.acquired']);
    expect(() => grantItems(character, { 'iron-ore': 0 })).toThrow(
      'Item quantities must be positive safe integers.',
    );
    expect(() => grantItems(character, { 'iron-ore': Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      'Item quantities must be positive safe integers.',
    );
    expect(() => grantItems(character, { '': 1 })).toThrow(
      'Item quantities must be positive safe integers.',
    );
    expect(() =>
      grantItems(
        { ...character, inventory: { 'iron-ore': Number.MAX_SAFE_INTEGER } },
        { 'iron-ore': 1 },
      ),
    ).toThrow('Inventory quantity exceeds the safe integer range for item: iron-ore');
  });

  it('grants combat loot once by unique kill reward id', () => {
    const character = createTestState().character!;
    const drops = [
      {
        rewardId: 'session:kill:1:table:guaranteed:0',
        itemId: 'iron-ore',
        quantity: 2,
        sourceTableId: 'table',
      },
      {
        rewardId: 'session:kill:2:table:guaranteed:0',
        itemId: 'wild-herb',
        quantity: 1,
        sourceTableId: 'table',
      },
    ];
    const first = grantLootDrops(character, drops);
    const repeated = grantLootDrops(
      first.character,
      drops,
      new Set(first.events.map((event) => event.id)),
    );

    expect(first.character.inventory).toMatchObject({ 'iron-ore': 2, 'wild-herb': 1 });
    expect(first.events.map((event) => event.id)).toEqual(drops.map((drop) => drop.rewardId));
    expect(repeated.character).toEqual(first.character);
    expect(repeated.events).toEqual([]);
    expect(() => grantLootDrops(character, [{ ...drops[0]!, quantity: 0 }])).toThrow();
    expect(() =>
      grantLootDrops(character, [drops[0]!, { ...drops[0]!, itemId: 'wild-herb' }]),
    ).toThrow('Loot reward ids must be unique.');
    expect(() =>
      grantLootDrops({ ...character, inventory: { 'iron-ore': Number.MAX_SAFE_INTEGER } }, [
        drops[0]!,
      ]),
    ).toThrow('Inventory quantity exceeds the safe integer range for item: iron-ore');
  });
});
