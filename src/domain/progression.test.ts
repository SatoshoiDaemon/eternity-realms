import { describe, expect, it } from 'vitest';
import {
  awardExperience,
  awardSkillExperience,
  applyTrainingEffect,
  grantCurrency,
  grantItems,
  grantLootDrops,
  spendAttributePoint,
} from './progression';
import { createTestState } from '../test/fixtures';

describe('character progression', () => {
  it('carries excess experience through multiple levels and awards canonical attributes', () => {
    const character = createTestState().character!;
    const next = awardExperience(character, 350, { experiencePerLevel: 100 });

    expect(next.character.level).toBe(4);
    expect(next.character.experience).toEqual({ current: 50, total: 350 });
    expect(next.events.map((event) => event.type)).toEqual([
      'experience.gained',
      'level.increased',
      'level.increased',
      'level.increased',
      'attribute.points_awarded',
    ]);
    expect(next.character.extensions.attributePoints).toBe(24);
  });

  it('stops level and attribute-point growth at the documented level 1000', () => {
    const character = {
      ...createTestState().character!,
      level: 1_000,
      experience: { current: 0, total: 0 },
    };
    const next = awardExperience(character, 250, { experiencePerLevel: 100, maxLevel: 1_000 });
    expect(next.character.level).toBe(1_000);
    expect(next.character.experience).toEqual({ current: 250, total: 250 });
    expect(next.character.extensions.attributePoints).toBe(0);
    expect(next.events.map((event) => event.type)).toEqual(['experience.gained']);
  });

  it('accepts zero experience without emitting a level event', () => {
    const character = createTestState().character!;
    const next = awardExperience(character, 0, { experiencePerLevel: 100 });

    expect(next.character).toEqual(character);
    expect(next.events).toEqual([]);
  });

  it('spends earned attribute points on physical and energetic stats', () => {
    const character = { ...createTestState().character!, extensions: { attributePoints: 2 } };
    expect(() => spendAttributePoint(createTestState().character!, 'physical:strength')).toThrow(
      'No unspent attribute points are available.',
    );
    const physical = spendAttributePoint(character, 'physical:strength');
    const energy = spendAttributePoint(physical, 'energy:mana');
    expect(energy.attributes.physical.strength).toBe(2);
    expect(energy.attributes.energetic.mana).toBe(1);
    expect(energy.extensions.attributePoints).toBe(0);
    expect(() => spendAttributePoint(energy, 'physical:vigor')).toThrow(
      'No unspent attribute points are available.',
    );
    expect(() =>
      spendAttributePoint({ ...character, extensions: { attributePoints: -1 } }, 'physical:vigor'),
    ).toThrow('Unspent attribute points must be a non-negative safe integer.');
    expect(() => spendAttributePoint(character, 'energy:luck')).toThrow(
      'Unknown attribute: energy:luck.',
    );
  });

  it('applies a training cycle to its declared attribute and emits one activity event', () => {
    const character = createTestState().character!;
    const trained = applyTrainingEffect(
      character,
      { attributeId: 'energy:chi', amount: 2 },
      'meditate',
    );
    expect(trained.character.attributes.energetic.chi).toBe(2);
    expect(trained.events).toEqual([
      {
        id: 'meditate:attribute:energy:chi',
        type: 'attribute.increased',
        occurredAt: 0,
        attributeId: 'energy:chi',
        amount: 2,
        total: 2,
      },
    ]);
    expect(applyTrainingEffect(character, undefined, 'session')).toEqual({ character, events: [] });
    expect(() =>
      applyTrainingEffect(character, { attributeId: 'physical:strength', amount: 0 }, 'bad'),
    ).toThrow('Training amount must be a positive safe integer.');
    expect(() =>
      applyTrainingEffect(character, { attributeId: 'energy:luck', amount: 1 }, 'bad'),
    ).toThrow('Unknown training attribute: energy:luck.');
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
    ).toThrow('Character level must be between 1 and maximum level 1000.');
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

  it('levels each profession independently and records each skill level event', () => {
    const character = createTestState().character!;
    const next = awardSkillExperience(character, 'mining-skill', 250, 100, 'session-a');

    expect(next.character.skills['mining-skill']).toEqual({
      level: 3,
      experience: 50,
      extensions: {},
    });
    expect(next.character.skills['herbalism-skill']).toBeUndefined();
    expect(next.events).toEqual([
      {
        id: 'session-a:skill:mining-skill:level:2',
        type: 'skill.level_increased',
        occurredAt: 0,
        skillId: 'mining-skill',
        level: 2,
      },
      {
        id: 'session-a:skill:mining-skill:level:3',
        type: 'skill.level_increased',
        occurredAt: 0,
        skillId: 'mining-skill',
        level: 3,
      },
    ]);
  });

  it('stores currencies in the character wallet with safe integer checks', () => {
    const character = createTestState().character!;
    const earned = grantCurrency(character, 'fragments', 25, 'session-b');
    const repeated = grantCurrency(earned.character, 'fragments', 5, 'session-c');

    expect((repeated.character.extensions.wallet as Record<string, number>).fragments).toBe(30);
    expect(earned.events).toEqual([
      {
        id: 'session-b:currency:fragments',
        type: 'currency.earned',
        occurredAt: 0,
        currency: 'fragments',
        amount: 25,
      },
    ]);
    expect(() => grantCurrency(character, '', 1)).toThrow('Currency id cannot be empty.');
    expect(() => grantCurrency(character, 'fragments', -1)).toThrow(
      'Currency amount must be a non-negative safe integer.',
    );
    expect(() =>
      grantCurrency(
        { ...character, extensions: { wallet: { fragments: Number.MAX_SAFE_INTEGER } } },
        'fragments',
        1,
      ),
    ).toThrow('Currency balance exceeds the safe integer range for fragments.');
  });

  it('validates optional progression rules and protects point totals', () => {
    const character = createTestState().character!;
    expect(() => awardExperience(character, 1, { experiencePerLevel: 100, maxLevel: 0 })).toThrow(
      'Maximum character level must be a positive safe integer.',
    );
    expect(() =>
      awardExperience(character, 1, { experiencePerLevel: 100, attributePointsPerLevel: 0 }),
    ).toThrow('Attribute points per level must be a positive safe integer.');
    expect(
      awardExperience(character, 1, { experiencePerLevel: 100 }).character.experience.current,
    ).toBe(1);
    expect(() =>
      awardExperience({ ...character, extensions: { attributePoints: 'bad' } }, 1, {
        experiencePerLevel: 100,
      }),
    ).toThrow('Unspent attribute points must be a non-negative safe integer.');
    expect(() =>
      awardExperience(
        { ...character, extensions: { attributePoints: Number.MAX_SAFE_INTEGER } },
        100,
        { experiencePerLevel: 100 },
      ),
    ).toThrow('Unspent attribute points exceed the safe integer range.');
  });

  it('validates attribute allocation and training for physical and energetic attributes', () => {
    const character = { ...createTestState().character!, extensions: { attributePoints: 1 } };
    expect(() => spendAttributePoint(character, 'strength')).toThrow(
      'Unknown attribute: strength.',
    );
    expect(() =>
      spendAttributePoint(
        {
          ...character,
          attributes: {
            ...character.attributes,
            physical: { ...character.attributes.physical, strength: Number.MAX_SAFE_INTEGER },
          },
        },
        'physical:strength',
      ),
    ).toThrow('Attribute value is invalid for physical:strength.');
    expect(() =>
      spendAttributePoint(
        {
          ...character,
          attributes: { ...character.attributes, energetic: { mana: Number.POSITIVE_INFINITY } },
        },
        'energy:mana',
      ),
    ).toThrow('Attribute value is invalid for energy:mana.');
    expect(() =>
      spendAttributePoint(
        { ...character, extensions: { attributePoints: Number.NaN } },
        'physical:strength',
      ),
    ).toThrow('Unspent attribute points must be a non-negative safe integer.');
    const physical = applyTrainingEffect(
      character,
      { attributeId: 'physical:strength', amount: 2 },
      'physical-training',
    );
    expect(physical.character.attributes.physical.strength).toBe(
      character.attributes.physical.strength + 2,
    );
    for (const value of ['bad', Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        applyTrainingEffect(
          {
            ...character,
            attributes: {
              ...character.attributes,
              physical: { ...character.attributes.physical, strength: value as number },
            },
          },
          { attributeId: 'physical:strength', amount: 1 },
          'invalid-physical',
        ),
      ).toThrow('Attribute value is invalid for physical:strength.');
    }
    expect(() =>
      applyTrainingEffect(
        {
          ...character,
          attributes: { ...character.attributes, energetic: { chi: Number.POSITIVE_INFINITY } },
        },
        { attributeId: 'energy:chi', amount: 1 },
        'invalid-energy',
      ),
    ).toThrow('Attribute value is invalid for energy:chi.');
    expect(() =>
      applyTrainingEffect(character, { attributeId: 'energy:luck', amount: 1 }, 'unknown'),
    ).toThrow('Unknown training attribute: energy:luck.');
  });

  it('validates skill awards, currency wallet forms, and idempotent loot records', () => {
    const character = createTestState().character!;
    expect(() => awardSkillExperience(character, ' ', 1)).toThrow('Skill id cannot be empty.');
    expect(() => awardSkillExperience(character, 'test', -1)).toThrow(
      'Skill experience must be a non-negative safe integer.',
    );
    expect(() => awardSkillExperience(character, 'test', 1, 0)).toThrow(
      'Skill experience per level must be positive.',
    );
    expect(awardSkillExperience(character, 'test', 0)).toEqual({ character, events: [] });
    expect(() =>
      awardSkillExperience(
        {
          ...character,
          skills: { test: { level: 1, experience: Number.MAX_SAFE_INTEGER, extensions: {} } },
        },
        'test',
        1,
      ),
    ).toThrow('Skill experience exceeds the safe integer range for test.');
    expect(() =>
      awardSkillExperience(
        {
          ...character,
          skills: { test: { level: Number.MAX_SAFE_INTEGER, experience: 99, extensions: {} } },
        },
        'test',
        1,
      ),
    ).toThrow('Skill level exceeds the safe integer range for test.');
    expect(grantCurrency(character, 'fragments', 0)).toEqual({ character, events: [] });
    expect(
      grantCurrency({ ...character, extensions: { wallet: null } }, 'fragments', 1).character
        .extensions.wallet,
    ).toEqual({ fragments: 1 });
    expect(() => grantCurrency(character, 'fragments', Number.NaN)).toThrow(
      'Currency amount must be a non-negative safe integer.',
    );
    const processedDrop = {
      rewardId: 'seen',
      itemId: 'iron-ore',
      quantity: 1,
      sourceTableId: 'table',
    };
    expect(grantLootDrops(character, [processedDrop], new Set(['seen']))).toEqual({
      character,
      events: [],
    });
    for (const invalid of [
      { ...processedDrop, rewardId: '' },
      { ...processedDrop, itemId: '' },
      { ...processedDrop, sourceTableId: '' },
      { ...processedDrop, quantity: Number.NaN },
    ]) {
      expect(() => grantLootDrops(character, [invalid])).toThrow(
        'Loot drops require unique IDs, item IDs, source tables, and positive quantities.',
      );
    }
  });
});
