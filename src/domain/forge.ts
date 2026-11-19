import type { ContentCatalog } from '../content/registry';
import type { Character } from './types';

export type EquipmentSlot =
  'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'primary' | 'secondary' | 'accessory';

export function forgeItem(
  character: Character,
  content: ContentCatalog,
  recipeId: string,
): Character {
  const recipe = content.recipes.get(recipeId);
  if (!recipe) {
    throw new Error(`Unknown forge recipe: ${recipeId}`);
  }
  const result = content.items.get(recipe.resultItemId);
  if (!result) {
    throw new Error(`Forge recipe ${recipeId} has no result item.`);
  }
  const inventory = { ...character.inventory };
  for (const [itemId, quantity] of Object.entries(recipe.inputs)) {
    if ((inventory[itemId] ?? 0) < quantity) {
      throw new Error(`Insufficient material: ${itemId}.`);
    }
    inventory[itemId] = inventory[itemId]! - quantity;
  }
  const quantity = (inventory[result.id] ?? 0) + recipe.resultQuantity;
  if (!Number.isSafeInteger(quantity)) {
    throw new Error(`Inventory quantity exceeds the safe integer range for item: ${result.id}`);
  }
  inventory[result.id] = quantity;
  return { ...character, inventory };
}

function addToInventory(inventory: Record<string, number>, itemId: string): Record<string, number> {
  const quantity = (inventory[itemId] ?? 0) + 1;
  if (!Number.isSafeInteger(quantity)) {
    throw new Error(`Inventory quantity exceeds the safe integer range for item: ${itemId}`);
  }
  return { ...inventory, [itemId]: quantity };
}

export function equipItem(
  character: Character,
  content: ContentCatalog,
  itemId: string,
  requestedSlot?: EquipmentSlot,
): Character {
  const item = content.items.get(itemId);
  if (!item?.slot) {
    throw new Error(`Item ${itemId} cannot be equipped.`);
  }
  if ((character.inventory[itemId] ?? 0) <= 0) {
    throw new Error(`Item ${itemId} is not in inventory.`);
  }
  const slot = requestedSlot ?? item.slot;
  if (slot !== item.slot) {
    throw new Error(`Item ${itemId} does not fit slot ${slot}.`);
  }
  const primaryId = character.equipment.primary;
  if (
    slot === 'secondary' &&
    typeof primaryId === 'string' &&
    content.items.get(primaryId)?.properties?.includes('two-handed')
  ) {
    throw new Error('A two-handed primary weapon leaves no secondary slot.');
  }
  const inventory = { ...character.inventory, [itemId]: character.inventory[itemId]! - 1 };
  const equipment = { ...character.equipment };
  if (slot === 'accessory') {
    const oldAccessories = equipment.accessories;
    equipment.accessories = [...oldAccessories, itemId];
  } else {
    const previous = equipment[slot];
    if (typeof previous === 'string') {
      inventory[previous] = (inventory[previous] ?? 0) + 1;
    }
    equipment[slot] = itemId;
  }
  return { ...character, inventory, equipment };
}

export function unequipItem(
  character: Character,
  content: ContentCatalog,
  slot: EquipmentSlot,
): Character {
  const equipment = { ...character.equipment };
  if (slot === 'accessory') {
    const itemId = equipment.accessories.at(-1);
    if (!itemId) {
      throw new Error('No item is equipped in slot accessory.');
    }
    equipment.accessories = equipment.accessories.slice(0, -1);
    if (!content.items.has(itemId)) {
      throw new Error(`Unknown equipped item: ${itemId}.`);
    }
    return { ...character, equipment, inventory: addToInventory(character.inventory, itemId) };
  }
  const itemId = equipment[slot];
  if (typeof itemId !== 'string') {
    throw new Error(`No item is equipped in slot ${slot}.`);
  }
  if (!content.items.has(itemId)) {
    throw new Error(`Unknown equipped item: ${itemId}.`);
  }
  equipment[slot] = null;
  return { ...character, equipment, inventory: addToInventory(character.inventory, itemId) };
}
