import { describe, expect, it } from 'vitest';
import { createCharacter } from './model';
import { forgeItem, equipItem, unequipItem } from './forge';
import { loadOfficialContent } from '../content/registry';

const content = loadOfficialContent();
const character = () => ({
  ...createCharacter({ id: 'hero', name: 'Hero', raceId: 'human', classId: 'wanderer' }),
  inventory: {
    'material-iron': 8,
    'material-silver': 3,
    'material-sacrite': 3,
    'material-mithril': 3,
    'material-adamantite': 3,
    'material-vibranium': 3,
    'material-gold': 3,
    'material-orichalcum': 3,
    'material-unobtanio': 3,
    'material-dilthio': 3,
    'material-chlorophyte': 3,
  },
});

describe('material-based forging and equipment', () => {
  it('consumes declared materials and crafts the selected equipment', () => {
    const result = forgeItem(character(), content, 'forge:iron-maul');
    expect(result.inventory).toMatchObject({ 'material-iron': 4, 'gear:iron-maul': 1 });
    expect(result.inventory['material-silver']).toBe(3);
  });

  it('exposes mechanical differences across weapon materials and armor', () => {
    const silver = forgeItem(character(), content, 'forge:silver-sabre');
    const sacrite = forgeItem(character(), content, 'forge:sacrite-mace');
    const ironArmor = forgeItem(character(), content, 'forge:iron-plate');
    const vibraniumArmor = forgeItem(character(), content, 'forge:vibranium-plate');
    expect(content.items.get('gear:silver-sabre')?.combat?.damage?.properties).toContain('silver');
    expect(content.items.get('gear:sacrite-mace')?.combat?.damage).toMatchObject({
      element: 'holy',
      properties: ['holy', 'anchoring'],
    });
    expect(content.items.get('gear:iron-plate')?.combat?.mitigation?.physical).toBe(0.1);
    expect(content.items.get('gear:vibranium-plate')?.combat?.mitigation?.physical).toBe(0.2);
    expect(silver.inventory['gear:silver-sabre']).toBe(1);
    expect(sacrite.inventory['gear:sacrite-mace']).toBe(1);
    expect(ironArmor.inventory['gear:iron-plate']).toBe(1);
    expect(vibraniumArmor.inventory['gear:vibranium-plate']).toBe(1);
    for (const recipeId of [
      'forge:gold-conductor',
      'forge:orichalcum-focus',
      'forge:unobtanio-spear',
      'forge:dilthio-wand',
      'forge:chlorophyte-vest',
    ]) {
      expect(
        forgeItem(character(), content, recipeId).inventory[
          content.recipes.get(recipeId)?.resultItemId ?? ''
        ],
      ).toBe(1);
    }
  });

  it('equips and unequips items in their declared slots without losing inventory', () => {
    const crafted = forgeItem(character(), content, 'forge:iron-maul');
    const equipped = equipItem(crafted, content, 'gear:iron-maul');
    expect(equipped.equipment.primary).toBe('gear:iron-maul');
    expect(equipped.inventory['gear:iron-maul']).toBe(0);
    const restored = unequipItem(equipped, content, 'primary');
    expect(restored.equipment.primary).toBeNull();
    expect(restored.inventory['gear:iron-maul']).toBe(1);
  });

  it('rejects unknown recipes, missing materials, non-equipment, wrong slots, and empty equipment slots', () => {
    expect(() => forgeItem(character(), content, 'missing')).toThrow(
      'Unknown forge recipe: missing',
    );
    expect(() => forgeItem({ ...character(), inventory: {} }, content, 'forge:iron-maul')).toThrow(
      'Insufficient material: material-iron.',
    );
    expect(() => equipItem(character(), content, 'iron-ore')).toThrow(
      'Item iron-ore cannot be equipped.',
    );
    expect(() =>
      equipItem(
        { ...character(), inventory: { 'gear:iron-maul': 1 } },
        content,
        'gear:iron-maul',
        'chest',
      ),
    ).toThrow('Item gear:iron-maul does not fit slot chest.');
    expect(() => equipItem(character(), content, 'gear:silver-sabre')).toThrow(
      'Item gear:silver-sabre is not in inventory.',
    );
    expect(() => unequipItem(character(), content, 'primary')).toThrow(
      'No item is equipped in slot primary.',
    );
  });

  it('replaces single-slot gear, equips multiple accessories, and blocks offhand with a two-handed weapon', () => {
    const owned = {
      ...character(),
      inventory: {
        ...character().inventory,
        'gear:iron-plate': 1,
        'gear:vibranium-plate': 1,
        'gear:silver-sabre': 1,
      },
    };
    const first = equipItem(owned, content, 'gear:iron-plate');
    const replaced = equipItem(
      { ...first, inventory: { ...first.inventory, 'gear:vibranium-plate': 1 } },
      content,
      'gear:vibranium-plate',
    );
    expect(replaced.equipment.chest).toBe('gear:vibranium-plate');
    expect(replaced.inventory['gear:iron-plate']).toBe(1);
    const preEquipped = {
      ...owned,
      equipment: { ...owned.equipment, chest: 'gear:iron-plate' },
      inventory: { 'gear:vibranium-plate': 1 },
    };
    expect(
      equipItem(preEquipped, content, 'gear:vibranium-plate').inventory['gear:iron-plate'],
    ).toBe(1);
    const customAccessory = {
      ...content.items.get('gear:iron-plate')!,
      id: 'gear:test-ring',
      name: 'Anel',
      slot: 'accessory' as const,
    };
    const withAccessory = {
      ...content,
      items: new Map([...content.items, [customAccessory.id, customAccessory]]),
    };
    const twoRings = equipItem(
      { ...owned, inventory: { ...owned.inventory, [customAccessory.id]: 2 } },
      withAccessory,
      customAccessory.id,
    );
    expect(
      equipItem(
        { ...twoRings, inventory: { ...twoRings.inventory, [customAccessory.id]: 1 } },
        withAccessory,
        customAccessory.id,
      ).equipment.accessories,
    ).toEqual([customAccessory.id, customAccessory.id]);
    const twoHanded = { ...content.items.get('gear:iron-maul')!, properties: ['two-handed'] };
    const secondaryBlade = {
      ...content.items.get('gear:silver-sabre')!,
      id: 'gear:secondary-blade',
      slot: 'secondary' as const,
    };
    const withTwoHanded = {
      ...content,
      items: new Map([
        ...content.items,
        [twoHanded.id, twoHanded],
        [secondaryBlade.id, secondaryBlade],
      ]),
    };
    expect(() =>
      equipItem(
        { ...owned, inventory: { ...owned.inventory, [twoHanded.id]: 1 } },
        withTwoHanded,
        twoHanded.id,
      ),
    ).not.toThrow();
    expect(() =>
      equipItem(
        {
          ...owned,
          equipment: { ...owned.equipment, primary: twoHanded.id },
          inventory: { ...owned.inventory, [secondaryBlade.id]: 1 },
        },
        withTwoHanded,
        secondaryBlade.id,
      ),
    ).toThrow('A two-handed primary weapon leaves no secondary slot.');
  });

  it('returns accessory items and rejects missing equipment definitions and unsafe inventory quantities', () => {
    const accessory = {
      ...content.items.get('gear:iron-plate')!,
      id: 'gear:test-ring',
      name: 'Anel',
      slot: 'accessory' as const,
    };
    const withAccessory = {
      ...content,
      items: new Map([...content.items, [accessory.id, accessory]]),
    };
    const equipped = {
      ...character(),
      equipment: { ...character().equipment, accessories: [accessory.id] },
    };
    expect(unequipItem(equipped, withAccessory, 'accessory').inventory[accessory.id]).toBe(1);
    expect(() => unequipItem(character(), withAccessory, 'accessory')).toThrow(
      'No item is equipped in slot accessory.',
    );
    expect(() =>
      unequipItem(
        { ...equipped, equipment: { ...equipped.equipment, accessories: ['missing'] } },
        withAccessory,
        'accessory',
      ),
    ).toThrow('Unknown equipped item: missing.');
    expect(() =>
      unequipItem(
        { ...character(), equipment: { ...character().equipment, chest: 'missing' } },
        content,
        'chest',
      ),
    ).toThrow('Unknown equipped item: missing.');
    expect(() =>
      unequipItem(
        { ...equipped, inventory: { [accessory.id]: Number.MAX_SAFE_INTEGER } },
        withAccessory,
        'accessory',
      ),
    ).toThrow('Inventory quantity exceeds the safe integer range');
    const overflowing = {
      ...content,
      recipes: new Map([
        ...content.recipes,
        [
          'forge:overflow',
          {
            id: 'forge:overflow',
            kind: 'recipe' as const,
            name: 'Overflow',
            description: '',
            inputs: {},
            resultItemId: 'gear:iron-maul',
            resultQuantity: Number.MAX_SAFE_INTEGER,
          },
        ],
      ]),
    };
    expect(() =>
      forgeItem(
        { ...character(), inventory: { 'gear:iron-maul': 1 } },
        overflowing,
        'forge:overflow',
      ),
    ).toThrow('Inventory quantity exceeds the safe integer range');
    const missingResult = {
      ...content,
      recipes: new Map([
        ...content.recipes,
        [
          'forge:missing-result',
          {
            id: 'forge:missing-result',
            kind: 'recipe' as const,
            name: 'Missing',
            description: '',
            inputs: {},
            resultItemId: 'missing:item',
            resultQuantity: 1,
          },
        ],
      ]),
    };
    expect(() => forgeItem(character(), missingResult, 'forge:missing-result')).toThrow(
      'has no result item',
    );
  });
});
