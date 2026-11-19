import type { Character, DomainEvent } from './types';
import type { LootDrop } from '../combat/loot';

export interface ProgressionRules {
  experiencePerLevel: number;
}

export interface CharacterUpdate {
  character: Character;
  events: DomainEvent[];
}

function validatePositiveSafeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(message);
  }
}

export function awardExperience(
  character: Character,
  amount: number,
  rules: ProgressionRules,
  eventPrefix = 'experience',
): CharacterUpdate {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Experience must be a non-negative safe integer.');
  }
  validatePositiveSafeInteger(
    rules.experiencePerLevel,
    'Experience per level must be a positive safe integer.',
  );
  if (amount === 0) {
    return { character, events: [] };
  }

  const lifetimeExperience = character.experience.total + amount;
  if (!Number.isSafeInteger(lifetimeExperience)) {
    throw new Error('Total experience exceeds the safe integer range.');
  }

  const events: DomainEvent[] = [
    {
      id: `${eventPrefix}:experience`,
      type: 'experience.gained',
      occurredAt: 0,
      amount,
    },
  ];
  let level = character.level;
  let currentExperience = character.experience.current + amount;
  while (currentExperience >= rules.experiencePerLevel) {
    currentExperience -= rules.experiencePerLevel;
    level += 1;
    if (!Number.isSafeInteger(level)) {
      throw new Error('Character level exceeds the safe integer range.');
    }
    events.push({
      id: `${eventPrefix}:level:${level}`,
      type: 'level.increased',
      occurredAt: 0,
      level,
    });
  }

  return {
    character: {
      ...character,
      level,
      experience: { current: currentExperience, total: lifetimeExperience },
    },
    events,
  };
}

export function grantItems(
  character: Character,
  items: Record<string, number>,
  eventPrefix = 'items',
): CharacterUpdate {
  const inventory = { ...character.inventory };
  const events: DomainEvent[] = [];
  for (const [itemId, quantity] of Object.entries(items)) {
    if (!itemId.trim() || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error('Item quantities must be positive safe integers.');
    }
    const total = (inventory[itemId] ?? 0) + quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`Inventory quantity exceeds the safe integer range for item: ${itemId}`);
    }
    inventory[itemId] = total;
    events.push({
      id: `${eventPrefix}:item:${itemId}`,
      type: 'item.acquired',
      occurredAt: 0,
      itemId,
      quantity,
    });
  }
  return { character: { ...character, inventory }, events };
}

export function grantLootDrops(
  character: Character,
  drops: LootDrop[],
  processedRewardIds: Set<string> = new Set(),
): CharacterUpdate {
  const inventory = { ...character.inventory };
  const rewardIds = new Set<string>();
  const events: DomainEvent[] = [];
  for (const drop of drops) {
    if (
      !drop.rewardId.trim() ||
      !drop.itemId.trim() ||
      !drop.sourceTableId.trim() ||
      !Number.isSafeInteger(drop.quantity) ||
      drop.quantity <= 0
    ) {
      throw new Error(
        'Loot drops require unique IDs, item IDs, source tables, and positive quantities.',
      );
    }
    if (rewardIds.has(drop.rewardId)) {
      throw new Error('Loot reward ids must be unique.');
    }
    rewardIds.add(drop.rewardId);
    if (processedRewardIds.has(drop.rewardId)) {
      continue;
    }
    const total = (inventory[drop.itemId] ?? 0) + drop.quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`Inventory quantity exceeds the safe integer range for item: ${drop.itemId}`);
    }
    inventory[drop.itemId] = total;
    events.push({
      id: drop.rewardId,
      type: 'item.acquired',
      occurredAt: 0,
      itemId: drop.itemId,
      quantity: drop.quantity,
    });
  }
  return { character: events.length ? { ...character, inventory } : character, events };
}
