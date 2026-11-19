import { describe, expect, it } from 'vitest';
import { createCharacter } from '../domain/model';
import { loadOfficialContent } from '../content/registry';
import type { ItemDefinition } from '../content/schema';
import { createCharacterCombatActor } from './player-actor';
import type { CombatAction } from './types';

const content = loadOfficialContent();
const character = () => ({
  ...createCharacter({ id: 'hero', name: 'Hero', raceId: 'human', classId: 'wanderer' }),
  attributes: {
    physical: { vigor: 6, resistance: 8, speed: 12, dexterity: 6, precision: 4, strength: 10 },
    energetic: { spirit: 4 },
  },
  energy: { affinity: 'mana', reserves: { mana: 30 } },
});
const defaults = { accuracy: 0.9, intervalMs: 1_000 };

describe('shared character combat contract', () => {
  it('maps canonical physical attributes, Tenacity, energy, and a default unarmed action', () => {
    const actor = createCharacterCombatActor(character(), content.items, defaults);
    expect(actor).toMatchObject({
      id: 'player:hero',
      side: 'party',
      attributes: { vigor: 6, resistance: 8, speed: 12, dexterity: 6, precision: 4, strength: 10 },
      hp: { current: 30, maximum: 30 },
      tenacity: { current: 80, maximum: 80 },
      energy: { mana: 30 },
      actions: [{ damage: { amount: 35, subtype: 'crushing' }, accuracy: 0.9, intervalMs: 1_000 }],
    });
  });

  it('uses equipped weapons, item properties, armor mitigation, speed, and configured abilities', () => {
    const ability: CombatAction = {
      id: 'build:fire',
      name: 'Fire',
      kind: 'magic',
      target: 'enemy',
      intervalMs: 2_000,
      accuracy: 1,
      damage: {
        amount: 4,
        channel: 'magical',
        element: 'fire',
        properties: [],
        origin: { kind: 'node', id: 'build:fire' },
      },
    };
    const equipped = {
      ...character(),
      equipment: {
        ...character().equipment,
        primary: 'gear:adamantite-breaker',
        chest: 'gear:vibranium-plate',
      },
    };
    const actor = createCharacterCombatActor(equipped, content.items, defaults, [ability]);
    expect(actor.actions.map((action) => action.id)).toEqual([
      'gear:adamantite-breaker',
      ability.id,
    ]);
    expect(actor.actions[0]).toMatchObject({
      damage: { amount: 57, subtype: 'crushing', properties: ['armor-penetrating', 'adamantite'] },
      properties: ['armor-penetrating', 'adamantite'],
    });
    expect(actor.mitigation.physical).toBeCloseTo(0.2);
    expect(actor.attributes.speed).toBe(12);
    expect(actor.equipment).toEqual(
      expect.arrayContaining([
        { id: 'gear:adamantite-breaker', properties: ['armor-penetrating', 'adamantite'] },
        { id: 'gear:vibranium-plate', properties: ['impact-absorbing'] },
      ]),
    );
  });

  it('uses the declared slot weapon and rejects impossible combat profiles', () => {
    const mithril = {
      ...character(),
      equipment: { ...character().equipment, primary: 'gear:mithril-spear' },
    };
    expect(createCharacterCombatActor(mithril, content.items, defaults).attributes.speed).toBe(14);
    expect(() =>
      createCharacterCombatActor(
        {
          ...character(),
          attributes: {
            ...character().attributes,
            physical: { ...character().attributes.physical, speed: 0 },
          },
        },
        content.items,
        defaults,
      ),
    ).toThrow('Character needs positive Speed for combat.');
    expect(() =>
      createCharacterCombatActor(
        { ...character(), equipment: { ...character().equipment, primary: 'missing' } },
        content.items,
        defaults,
      ),
    ).toThrow('Unknown equipped item: missing.');
    expect(() =>
      createCharacterCombatActor(character(), content.items, { ...defaults, accuracy: 2 }),
    ).toThrow('Combat defaults have invalid accuracy or interval.');
  });

  it('carries material interactions, resource costs, and energy reserves into combat', () => {
    const anchored = createCharacterCombatActor(
      { ...character(), equipment: { ...character().equipment, primary: 'gear:unobtanio-spear' } },
      content.items,
      defaults,
    );
    const focusCharacter = {
      ...character(),
      energy: { affinity: 'mana', reserves: { mana: 4 } },
      equipment: { ...character().equipment, primary: 'gear:dilthio-wand' },
    };
    const focus = createCharacterCombatActor(focusCharacter, content.items, defaults);
    expect(anchored.actions[0]?.damage?.properties).toContain('anchoring');
    expect(focus.actions[0]?.cost).toEqual({ resource: 'mana', amount: 1 });
    expect(focus.energy.mana).toBe(9);
    const gold = createCharacterCombatActor(
      { ...character(), equipment: { ...character().equipment, primary: 'gear:gold-conductor' } },
      content.items,
      defaults,
    );
    expect(gold.actions[0]?.damage).toMatchObject({
      channel: 'magical',
      element: 'lightning',
      properties: expect.arrayContaining(['conductive']),
    });
  });

  it('uses secondary weapons, ranged precision, and unequipped items without combat profiles', () => {
    const secondaryItem = {
      ...content.items.get('gear:mithril-spear')!,
      id: 'gear:secondary-spear',
      slot: 'secondary' as const,
    };
    const rangedItem = {
      ...content.items.get('gear:mithril-spear')!,
      id: 'gear:ranged-bow',
      slot: 'primary' as const,
      combat: {
        damage: {
          amount: 10,
          channel: 'physical' as const,
          properties: ['ranged'],
          origin: { kind: 'weapon' as const, id: 'gear:ranged-bow' },
        },
      },
    };
    const noProfile = { ...content.items.get('gear:iron-plate')!, id: 'gear:plain-plate' };
    const modifiedItem = {
      ...rangedItem,
      id: 'gear:plain-modified',
      properties: undefined,
      combat: {
        damage: {
          ...rangedItem.combat!.damage!,
          properties: [],
          modifiers: [
            {
              id: 'edge',
              operation: 'add' as const,
              value: 2,
              potency: 1,
              origin: { kind: 'item' as const, id: 'edge' },
            },
          ],
        },
      },
    };
    const implicitPropertiesItem = {
      ...rangedItem,
      id: 'gear:implicit-properties',
      combat: { damage: { ...rangedItem.combat!.damage!, properties: undefined } },
    } as unknown as ItemDefinition;
    const extendedItems = new Map<string, ItemDefinition>(content.items);
    extendedItems.set(secondaryItem.id, secondaryItem);
    extendedItems.set(rangedItem.id, rangedItem);
    extendedItems.set(noProfile.id, noProfile);
    extendedItems.set(modifiedItem.id, modifiedItem);
    extendedItems.set(implicitPropertiesItem.id, implicitPropertiesItem);
    const extended = { ...content, items: extendedItems };
    const secondary = createCharacterCombatActor(
      {
        ...character(),
        equipment: { ...character().equipment, secondary: secondaryItem.id, chest: noProfile.id },
      },
      extended.items,
      defaults,
    );
    expect(secondary.actions[0]?.id).toBe(secondaryItem.id);
    expect(secondary.actions[0]?.damage?.amount).toBe(41);
    const ranged = createCharacterCombatActor(
      { ...character(), equipment: { ...character().equipment, primary: rangedItem.id } },
      extended.items,
      defaults,
    );
    expect(ranged.actions[0]).toMatchObject({
      kind: 'ranged',
      damage: { amount: 24, properties: expect.arrayContaining(['ranged']) },
    });
    const modified = createCharacterCombatActor(
      { ...character(), equipment: { ...character().equipment, primary: modifiedItem.id } },
      extended.items,
      defaults,
    );
    expect(modified.actions[0]?.damage?.modifiers?.[0]?.origin).toEqual({
      kind: 'item',
      id: 'edge',
    });
    const implicit = createCharacterCombatActor(
      {
        ...character(),
        equipment: { ...character().equipment, primary: implicitPropertiesItem.id },
      },
      extended.items,
      defaults,
    );
    expect(implicit.actions[0]?.kind).toBe('attack');
  });

  it('rejects invalid character bars, equipped profiles, and malformed combat defaults', () => {
    expect(() =>
      createCharacterCombatActor(
        {
          ...character(),
          attributes: {
            ...character().attributes,
            physical: { ...character().attributes.physical, vigor: Number.MAX_SAFE_INTEGER },
          },
        },
        content.items,
        defaults,
      ),
    ).toThrow('invalid combat bars');
    const badMitigation = {
      ...content.items.get('gear:iron-plate')!,
      combat: { mitigation: { physical: 1, magical: 0 } },
    };
    const invalidMitigationContent = {
      ...content,
      items: new Map([
        ...content.items,
        ['gear:bad-armor', { ...badMitigation, id: 'gear:bad-armor' }],
      ]),
    };
    expect(() =>
      createCharacterCombatActor(
        { ...character(), equipment: { ...character().equipment, chest: 'gear:bad-armor' } },
        invalidMitigationContent.items,
        defaults,
      ),
    ).toThrow('invalid physical mitigation');
    expect(() =>
      createCharacterCombatActor(character(), content.items, { ...defaults, intervalMs: 0 }),
    ).toThrow('invalid accuracy or interval');
    expect(() =>
      createCharacterCombatActor(
        {
          ...character(),
          attributes: {
            ...character().attributes,
            physical: { ...character().attributes.physical, strength: Number.NaN },
          },
        },
        content.items,
        defaults,
      ),
    ).toThrow('invalid physical attributes');
    expect(
      createCharacterCombatActor(
        { ...character(), extensions: { combatEvasion: { chance: 'bad', guaranteed: 1 } } },
        content.items,
        defaults,
      ).evasion,
    ).toBeUndefined();
    expect(
      createCharacterCombatActor(
        { ...character(), extensions: { combatEvasion: { chance: 0.2, guaranteed: 2 } } },
        content.items,
        defaults,
      ).evasion,
    ).toEqual({ chance: 0.2, guaranteed: 2 });
    const negativeSpeed = {
      ...content.items.get('gear:iron-plate')!,
      id: 'gear:negative-speed',
      combat: { speed: -20 },
    };
    const negativeSpeedItems = new Map<string, ItemDefinition>(content.items);
    negativeSpeedItems.set(negativeSpeed.id, negativeSpeed);
    expect(() =>
      createCharacterCombatActor(
        { ...character(), equipment: { ...character().equipment, chest: negativeSpeed.id } },
        negativeSpeedItems,
        defaults,
      ),
    ).toThrow('Character needs positive Speed for combat.');
    const energyItem = {
      ...content.items.get('gear:iron-plate')!,
      id: 'gear:energy-item',
      combat: { energyBonus: { focus: 5 } },
    };
    const energyItems = new Map<string, ItemDefinition>(content.items);
    energyItems.set(energyItem.id, energyItem);
    expect(
      createCharacterCombatActor(
        { ...character(), equipment: { ...character().equipment, chest: energyItem.id } },
        energyItems,
        defaults,
      ).energy.focus,
    ).toBe(5);
  });
});
