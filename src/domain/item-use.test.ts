import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createTestState } from '../test/fixtures';
import type { ContentCatalog } from '../content/registry';
import type { ItemDefinition } from '../content/schema';
import { consumeItem } from './item-use';

const content = loadOfficialContent();

describe('consumable items', () => {
  it('uses a healing potion, records its event, and remains idempotent after save reload', () => {
    const state = createTestState();
    state.character!.inventory['healing-potion'] = 1;
    state.character!.extensions.combatHp = 1;
    const used = consumeItem(state, content, 'healing-potion', 'use:healing:1', 123);
    expect(used.character?.inventory['healing-potion']).toBe(0);
    expect(used.character?.extensions.combatHp).toBe(5);
    expect(used.events).toMatchObject([
      { type: 'item.consumed', itemId: 'healing-potion', quantity: 1, occurredAt: 123 },
      { type: 'resource.restored', resource: 'hp', amount: 4, occurredAt: 123 },
    ]);
    const reopened = JSON.parse(JSON.stringify(used));
    expect(consumeItem(reopened, content, 'healing-potion', 'use:healing:1', 456)).toEqual(
      reopened,
    );
  });

  it('restores Mana within the reserve derived from the Mana attribute', () => {
    const state = createTestState();
    state.character!.attributes.energetic.mana = 5;
    state.character!.energy.reserves.mana = 40;
    state.character!.inventory['mana-potion'] = 1;
    const used = consumeItem(state, content, 'mana-potion', 'use:mana:1', 123);
    expect(used.character?.energy.reserves.mana).toBe(50);
    expect(used.events.at(-1)).toMatchObject({
      type: 'resource.restored',
      resource: 'mana',
      amount: 10,
    });
  });

  it('applies the catalytic heart potency to consumed positive effects', () => {
    const state = createTestState();
    state.character!.attributes.energetic.mana = 5;
    state.character!.energy.reserves.mana = 0;
    state.character!.inventory['mana-potion'] = 1;
    state.character!.extensions.installedImplants = ['implant-09'];
    const used = consumeItem(state, content, 'mana-potion', 'use:catalytic:1', 123);
    expect(used.character?.energy.reserves.mana).toBe(45);
    expect(used.events.at(-1)).toMatchObject({
      type: 'resource.restored',
      resource: 'mana',
      amount: 45,
    });
  });

  it('applies the alchemy potency milestones to healing and resource consumables', () => {
    const healing = createTestState();
    healing.character!.attributes.physical.vigor = 20;
    healing.character!.extensions.combatHp = 1;
    healing.character!.inventory['healing-potion'] = 1;
    healing.character!.skills['alchemy-skill'] = { level: 5, experience: 0, extensions: {} };
    const healed = consumeItem(healing, content, 'healing-potion', 'use:alchemy:heal', 123);
    expect(healed.character?.extensions.combatHp).toBe(56);
    expect(healed.events.at(-1)).toMatchObject({ type: 'resource.restored', amount: 55 });

    const mana = createTestState();
    mana.character!.attributes.energetic.mana = 8;
    mana.character!.energy.reserves.mana = 0;
    mana.character!.inventory['mana-potion'] = 1;
    mana.character!.skills['alchemy-skill'] = { level: 10, experience: 0, extensions: {} };
    mana.character!.extensions.installedImplants = ['implant-09'];
    const restored = consumeItem(mana, content, 'mana-potion', 'use:alchemy:mana', 123);
    expect(restored.character?.energy.reserves.mana).toBe(58);
    expect(restored.events.at(-1)).toMatchObject({ type: 'resource.restored', amount: 58 });
  });

  it('rejects invalid, absent, unusable, or full resources without consuming the item', () => {
    const state = createTestState();
    state.character!.inventory['healing-potion'] = 1;
    state.character!.inventory['mana-potion'] = 1;
    expect(() => consumeItem(state, content, 'healing-potion', 'full', 123)).toThrow(
      'Character has no missing HP.',
    );
    expect(() => consumeItem(state, content, 'mana-potion', 'empty', 123)).toThrow(
      'Character has no mana capacity.',
    );
    expect(() => consumeItem(state, content, 'iron-ore', 'ore', 123)).toThrow(
      'Item cannot be consumed: iron-ore.',
    );
    expect(() => consumeItem(state, content, 'missing', 'unknown', 123)).toThrow(
      'Unknown item: missing.',
    );
    expect(() => consumeItem(state, content, 'healing-potion', '', 123)).toThrow(
      'Item use id cannot be empty.',
    );
    expect(() => consumeItem(state, content, 'healing-potion', 'invalid-time', -1)).toThrow(
      'Item use time must be a valid non-negative epoch timestamp.',
    );
    const noCharacter = { ...state, character: null };
    expect(() => consumeItem(noCharacter, content, 'healing-potion', 'no-character', 123)).toThrow(
      'A character is required to use items.',
    );
    const noPotion = {
      ...state,
      character: {
        ...state.character!,
        inventory: { ...state.character!.inventory, 'healing-potion': 0 },
      },
    };
    expect(() => consumeItem(noPotion, content, 'healing-potion', 'not-owned', 123)).toThrow(
      'Item is not in inventory: healing-potion.',
    );
  });

  it('covers save compatibility, journal idempotency, and malformed item or HP state', () => {
    const state = createTestState();
    expect(() => consumeItem(state, content, 'healing-potion', 'fractional-time', 8.5)).toThrow(
      'Item use time must be a valid non-negative epoch timestamp.',
    );
    expect(() =>
      consumeItem(state, content, 'healing-potion', 'invalid-date-range', 8_640_000_000_000_001),
    ).toThrow('Item use time must be a valid non-negative epoch timestamp.');
    const prepared = {
      ...state,
      character: {
        ...state.character!,
        inventory: { 'healing-potion': 1 },
        extensions: { combatHp: 1 },
      },
    };
    expect(() => consumeItem(prepared, content, 'healing-potion', ' ', 123)).toThrow(
      'Item use id cannot be empty.',
    );
    const duplicate = { ...prepared, processedEventIds: ['same:item.consumed'] };
    expect(consumeItem(duplicate, content, 'healing-potion', 'same', 123)).toBe(duplicate);
    const journalDuplicate = {
      ...prepared,
      processedEventIds: [],
      events: [
        {
          id: 'journal:item.consumed',
          type: 'item.consumed',
          occurredAt: 0,
          itemId: 'healing-potion',
          quantity: 1,
        },
      ],
    } as never;
    expect(consumeItem(journalDuplicate, content, 'healing-potion', 'journal', 123)).toBe(
      journalDuplicate,
    );
    expect(() =>
      consumeItem({ ...prepared, character: null }, content, 'healing-potion', 'no-char', 123),
    ).toThrow('A character is required to use items.');
    expect(() =>
      consumeItem(prepared, content, 'healing-potion', 'bad-quantity', 123),
    ).not.toThrow();
    const invalidQuantity = {
      ...prepared,
      character: { ...prepared.character!, inventory: { 'healing-potion': Number.NaN } },
    };
    expect(() =>
      consumeItem(invalidQuantity, content, 'healing-potion', 'bad-quantity', 123),
    ).toThrow('Item is not in inventory: healing-potion.');
    expect(() =>
      consumeItem(
        { ...prepared, character: { ...prepared.character!, inventory: {} } },
        content,
        'healing-potion',
        'missing-quantity',
        123,
      ),
    ).toThrow('Item is not in inventory: healing-potion.');
    for (const extensions of [{ combatHp: -1 }, { combatHp: 31 }, { combatHp: Number.NaN }]) {
      expect(() =>
        consumeItem(
          { ...prepared, character: { ...prepared.character!, extensions } },
          content,
          'healing-potion',
          'bad-hp',
          123,
        ),
      ).toThrow('Character HP state is invalid.');
    }
    const fullByDefault = { ...prepared, character: { ...prepared.character!, extensions: {} } };
    expect(() => consumeItem(fullByDefault, content, 'healing-potion', 'legacy-hp', 123)).toThrow(
      'Character has no missing HP.',
    );
  });

  it('restores Aura and custom resources from saved capacity and rejects invalid resource state', () => {
    const state = createTestState();
    state.character!.attributes.energetic.chi = 50;
    state.character!.energy.reserves.aura = 0;
    state.character!.inventory['aura-tonic'] = 1;
    const aura = consumeItem(state, content, 'aura-tonic', 'use:aura', 123);
    expect(aura.character?.energy.reserves.aura).toBe(30);

    const focusPotion: ItemDefinition = {
      ...content.items.get('mana-potion')!,
      id: 'test:focus-potion',
      consumable: { effect: 'restore-resource', resource: 'focus', amount: 7 },
    };
    const items = new Map(content.items).set(focusPotion.id, focusPotion);
    const customContent = { ...content, items } as ContentCatalog;
    const custom = {
      ...createTestState(),
      character: {
        ...createTestState().character!,
        inventory: { 'test:focus-potion': 1 },
        energy: { affinity: 'mana', reserves: { focus: 2 } },
        extensions: { resourceMaxima: { focus: 10 } },
      },
    };
    expect(
      consumeItem(custom, customContent, focusPotion.id, 'use:focus', 123).character?.energy
        .reserves.focus,
    ).toBe(9);
    const invalidMax = {
      ...custom,
      character: { ...custom.character!, extensions: { resourceMaxima: { focus: -1 } } },
    };
    expect(() => consumeItem(invalidMax, customContent, focusPotion.id, 'bad-max', 123)).toThrow(
      'Character has no focus capacity.',
    );
    for (const current of [-1, 11, Number.NaN]) {
      const invalidCurrent = {
        ...custom,
        character: {
          ...custom.character!,
          energy: { affinity: 'mana', reserves: { focus: current } },
        },
      };
      expect(() =>
        consumeItem(invalidCurrent, customContent, focusPotion.id, 'bad-current', 123),
      ).toThrow('Character focus state is invalid.');
    }
    const full = {
      ...custom,
      character: { ...custom.character!, energy: { affinity: 'mana', reserves: { focus: 10 } } },
    };
    expect(() => consumeItem(full, customContent, focusPotion.id, 'full-focus', 123)).toThrow(
      'Character has no missing focus.',
    );
    const missingMaxima = { ...custom, character: { ...custom.character!, extensions: {} } };
    expect(() =>
      consumeItem(missingMaxima, customContent, focusPotion.id, 'no-maxima', 123),
    ).toThrow('Character has no focus capacity.');
    const duplicateSecondary = {
      ...custom,
      processedEventIds: ['secondary:resource.restored:focus'],
    };
    const used = consumeItem(duplicateSecondary, customContent, focusPotion.id, 'secondary', 123);
    expect(used.events.map((event) => event.type)).toEqual(['item.consumed']);

    const noAuraAttribute = {
      ...createTestState(),
      character: {
        ...createTestState().character!,
        inventory: { 'aura-tonic': 1 },
        energy: { affinity: 'aura', reserves: { aura: 0 } },
      },
    };
    expect(() => consumeItem(noAuraAttribute, content, 'aura-tonic', 'no-aura-max', 123)).toThrow(
      'Character has no aura capacity.',
    );
  });

  it('does not use Mana or Aura restoratives outside the selected energy path', () => {
    const mana = createTestState();
    mana.character!.energy.affinity = 'mana';
    mana.character!.attributes.energetic.mana = 5;
    mana.character!.attributes.energetic.chi = 50;
    mana.character!.inventory['aura-tonic'] = 1;
    expect(() => consumeItem(mana, content, 'aura-tonic', 'wrong-path:aura', 123)).toThrow(
      'Character has no aura capacity.',
    );

    const aura = createTestState();
    aura.character!.energy.affinity = 'aura';
    aura.character!.attributes.energetic.mana = 5;
    aura.character!.attributes.energetic.chi = 50;
    aura.character!.inventory['mana-potion'] = 1;
    expect(() => consumeItem(aura, content, 'mana-potion', 'wrong-path:mana', 123)).toThrow(
      'Character has no mana capacity.',
    );
  });
});
