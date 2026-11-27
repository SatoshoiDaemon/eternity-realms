import type { Character, DomainEvent } from './types';
import type { LootDrop } from '../combat/loot';
import { getEnergyAttributeAccessError } from './energy-rules';

export interface ProgressionRules {
  experiencePerLevel: number;
  maxLevel?: number;
  attributePointsPerLevel?: number;
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
  const maxLevel = rules.maxLevel ?? 1_000;
  const attributePointsPerLevel = rules.attributePointsPerLevel ?? 8;
  validatePositiveSafeInteger(maxLevel, 'Maximum character level must be a positive safe integer.');
  validatePositiveSafeInteger(
    attributePointsPerLevel,
    'Attribute points per level must be a positive safe integer.',
  );
  if (!Number.isSafeInteger(character.level) || character.level < 1 || character.level > maxLevel) {
    throw new Error(`Character level must be between 1 and maximum level ${maxLevel}.`);
  }
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
  let levelsGained = 0;
  while (currentExperience >= rules.experiencePerLevel && level < maxLevel) {
    currentExperience -= rules.experiencePerLevel;
    level += 1;
    levelsGained += 1;
    events.push({
      id: `${eventPrefix}:level:${level}`,
      type: 'level.increased',
      occurredAt: 0,
      level,
    });
  }

  const existingPointValue = character.extensions.attributePoints ?? 0;
  if (
    typeof existingPointValue !== 'number' ||
    !Number.isSafeInteger(existingPointValue) ||
    existingPointValue < 0
  ) {
    throw new Error('Unspent attribute points must be a non-negative safe integer.');
  }
  const pointsGained = levelsGained * attributePointsPerLevel;
  const attributePoints = existingPointValue + pointsGained;
  if (!Number.isSafeInteger(attributePoints)) {
    throw new Error('Unspent attribute points exceed the safe integer range.');
  }
  if (pointsGained > 0) {
    events.push({
      id: `${eventPrefix}:attribute-points`,
      type: 'attribute.points_awarded',
      occurredAt: 0,
      amount: pointsGained,
    });
  }

  return {
    character: {
      ...character,
      level,
      experience: { current: currentExperience, total: lifetimeExperience },
      extensions: { ...character.extensions, attributePoints },
    },
    events,
  };
}

export function spendAttributePoint(character: Character, attributeId: string): Character {
  const separator = attributeId.indexOf(':');
  const group = separator >= 0 ? attributeId.slice(0, separator) : '';
  const key = separator >= 0 ? attributeId.slice(separator + 1) : '';
  const pointValue = character.extensions.attributePoints ?? 0;
  if (typeof pointValue !== 'number' || !Number.isSafeInteger(pointValue) || pointValue < 0) {
    throw new Error('Unspent attribute points must be a non-negative safe integer.');
  }
  const points = pointValue;
  if (points < 1) throw new Error('No unspent attribute points are available.');
  if (group === 'physical' && Object.hasOwn(character.attributes.physical, key)) {
    const current = character.attributes.physical[key];
    if (
      typeof current !== 'number' ||
      !Number.isFinite(current) ||
      !Number.isSafeInteger(current + 1)
    ) {
      throw new Error(`Attribute value is invalid for ${attributeId}.`);
    }
    return {
      ...character,
      attributes: {
        ...character.attributes,
        physical: { ...character.attributes.physical, [key]: current + 1 },
      },
      extensions: { ...character.extensions, attributePoints: points - 1 },
    };
  }
  if (group === 'energy' && (key === 'chi' || key === 'mana' || key === 'spirit')) {
    const accessError = getEnergyAttributeAccessError(character, attributeId, 'allocate');
    if (accessError) throw new Error(accessError);
    const current = character.attributes.energetic[key] ?? 0;
    if (!Number.isFinite(current) || !Number.isSafeInteger(current + 1)) {
      throw new Error(`Attribute value is invalid for ${attributeId}.`);
    }
    return {
      ...character,
      attributes: {
        ...character.attributes,
        energetic: { ...character.attributes.energetic, [key]: current + 1 },
      },
      extensions: { ...character.extensions, attributePoints: points - 1 },
    };
  }
  throw new Error(`Unknown attribute: ${attributeId}.`);
}

export function applyTrainingEffect(
  character: Character,
  trainingEffect: { attributeId: string; amount: number } | undefined,
  eventPrefix: string,
): CharacterUpdate {
  if (!trainingEffect) return { character, events: [] };
  if (!Number.isSafeInteger(trainingEffect.amount) || trainingEffect.amount <= 0) {
    throw new Error('Training amount must be a positive safe integer.');
  }
  const [group, key = ''] = trainingEffect.attributeId.split(':');
  const attributeId = trainingEffect.attributeId;
  if (group === 'physical' && Object.hasOwn(character.attributes.physical, key)) {
    const current = character.attributes.physical[key];
    if (typeof current !== 'number')
      throw new Error(`Attribute value is invalid for ${attributeId}.`);
    const total = current + trainingEffect.amount;
    if (!Number.isFinite(current) || !Number.isSafeInteger(total)) {
      throw new Error(`Attribute value is invalid for ${attributeId}.`);
    }
    return {
      character: {
        ...character,
        attributes: {
          ...character.attributes,
          physical: { ...character.attributes.physical, [key]: total },
        },
      },
      events: [
        {
          id: `${eventPrefix}:attribute:${attributeId}`,
          type: 'attribute.increased',
          occurredAt: 0,
          attributeId,
          amount: trainingEffect.amount,
          total,
        },
      ],
    };
  }
  if (group === 'energy' && (key === 'chi' || key === 'mana' || key === 'spirit')) {
    const accessError = getEnergyAttributeAccessError(character, attributeId, 'train');
    if (accessError) throw new Error(accessError);
    const current = character.attributes.energetic[key] ?? 0;
    const total = current + trainingEffect.amount;
    if (!Number.isFinite(current) || !Number.isSafeInteger(total)) {
      throw new Error(`Attribute value is invalid for ${attributeId}.`);
    }
    return {
      character: {
        ...character,
        attributes: {
          ...character.attributes,
          energetic: { ...character.attributes.energetic, [key]: total },
        },
      },
      events: [
        {
          id: `${eventPrefix}:attribute:${attributeId}`,
          type: 'attribute.increased',
          occurredAt: 0,
          attributeId,
          amount: trainingEffect.amount,
          total,
        },
      ],
    };
  }
  throw new Error(`Unknown training attribute: ${attributeId}.`);
}

export function awardSkillExperience(
  character: Character,
  skillId: string,
  amount: number,
  experiencePerLevel = 100,
  eventPrefix = 'skill',
): CharacterUpdate {
  if (!skillId.trim()) throw new Error('Skill id cannot be empty.');
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Skill experience must be a non-negative safe integer.');
  }
  validatePositiveSafeInteger(experiencePerLevel, 'Skill experience per level must be positive.');
  if (amount === 0) return { character, events: [] };

  const current = character.skills[skillId] ?? { level: 1, experience: 0, extensions: {} };
  let level = current.level;
  let experience = current.experience + amount;
  if (!Number.isSafeInteger(experience)) {
    throw new Error(`Skill experience exceeds the safe integer range for ${skillId}.`);
  }
  const events: DomainEvent[] = [];
  while (experience >= experiencePerLevel) {
    experience -= experiencePerLevel;
    level += 1;
    if (!Number.isSafeInteger(level)) {
      throw new Error(`Skill level exceeds the safe integer range for ${skillId}.`);
    }
    events.push({
      id: `${eventPrefix}:skill:${skillId}:level:${level}`,
      type: 'skill.level_increased',
      occurredAt: 0,
      skillId,
      level,
    });
  }
  return {
    character: {
      ...character,
      skills: {
        ...character.skills,
        [skillId]: { ...current, level, experience, extensions: { ...current.extensions } },
      },
    },
    events,
  };
}

export function grantCurrency(
  character: Character,
  currency: string,
  amount: number,
  eventPrefix = 'currency',
): CharacterUpdate {
  if (!currency.trim()) throw new Error('Currency id cannot be empty.');
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Currency amount must be a non-negative safe integer.');
  }
  if (amount === 0) return { character, events: [] };
  const extensions = { ...character.extensions };
  const existingWallet = extensions.wallet;
  const wallet =
    typeof existingWallet === 'object' && existingWallet !== null
      ? { ...(existingWallet as Record<string, number>) }
      : {};
  const balance = (wallet[currency] ?? 0) + amount;
  if (!Number.isSafeInteger(balance)) {
    throw new Error(`Currency balance exceeds the safe integer range for ${currency}.`);
  }
  wallet[currency] = balance;
  extensions.wallet = wallet;
  return {
    character: { ...character, extensions },
    events: [
      {
        id: `${eventPrefix}:currency:${currency}`,
        type: 'currency.earned',
        occurredAt: 0,
        currency,
        amount,
      },
    ],
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
