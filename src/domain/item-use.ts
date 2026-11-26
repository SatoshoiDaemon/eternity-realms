import type { ContentCatalog } from '../content/registry';
import type { DomainEvent, GameState } from './types';
import { getInstalledImplantStatModifiers } from './implants';
import { getSkillEffectBonus } from './skill-effects';
import { isEnergyResourceAvailable } from './energy-rules';

function validateNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Item use time must be a valid non-negative epoch timestamp.');
  }
}

function resourceMaximum(character: NonNullable<GameState['character']>, resource: string): number {
  if (!isEnergyResourceAvailable(character.energy.affinity, resource)) return 0;
  if (resource === 'mana') return (character.attributes.energetic.mana ?? 0) * 10;
  if (resource === 'aura') return character.attributes.energetic.chi ?? 0;
  const value = character.extensions.resourceMaxima;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const maximum = (value as Record<string, unknown>)[resource];
    if (typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum >= 0) {
      return maximum;
    }
  }
  return 0;
}

export function consumeItem(
  state: GameState,
  content: ContentCatalog,
  itemId: string,
  useId: string,
  now: number,
): GameState {
  validateNow(now);
  if (!useId.trim()) throw new Error('Item use id cannot be empty.');
  const eventId = `${useId}:item.consumed`;
  if (
    state.processedEventIds.includes(eventId) ||
    state.events.some((event) => event.id === eventId)
  ) {
    return state;
  }
  if (!state.character) throw new Error('A character is required to use items.');
  const item = content.items.get(itemId);
  if (!item) throw new Error(`Unknown item: ${itemId}.`);
  if (!item.consumable) throw new Error(`Item cannot be consumed: ${itemId}.`);
  const quantity = state.character.inventory[itemId] ?? 0;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`Item is not in inventory: ${itemId}.`);
  }

  let character = state.character;
  const secondaryEvents: DomainEvent[] = [];
  const implantMultiplier = getInstalledImplantStatModifiers(
    character,
    content.systems,
  ).consumableMultiplier;
  const alchemyBonus = getSkillEffectBonus(
    character,
    content.skills.get('alchemy-skill'),
    'consumable_effect_bonus_percent',
  );
  const positiveEffectMultiplier = implantMultiplier * (1 + alchemyBonus);
  if (item.consumable.effect === 'heal') {
    const maximum = character.attributes.physical.vigor * 5;
    const currentValue = character.extensions.combatHp;
    const current = typeof currentValue === 'number' ? currentValue : maximum;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum <= 0 ||
      !Number.isSafeInteger(current) ||
      current < 0 ||
      current > maximum
    ) {
      throw new Error('Character HP state is invalid.');
    }
    if (current >= maximum) throw new Error('Character has no missing HP.');
    const restored = Math.min(
      Math.floor(item.consumable.amount * positiveEffectMultiplier),
      maximum - current,
    );
    const total = current + restored;
    character = {
      ...character,
      extensions: { ...character.extensions, combatHp: total },
    };
    secondaryEvents.push({
      id: `${useId}:resource.restored:hp`,
      type: 'resource.restored',
      occurredAt: now,
      resource: 'hp',
      amount: restored,
    });
  } else {
    const maximum = resourceMaximum(character, item.consumable.resource);
    const current = character.energy.reserves[item.consumable.resource] ?? 0;
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error(`Character has no ${item.consumable.resource} capacity.`);
    }
    if (!Number.isSafeInteger(current) || current < 0 || current > maximum) {
      throw new Error(`Character ${item.consumable.resource} state is invalid.`);
    }
    if (current >= maximum)
      throw new Error(`Character has no missing ${item.consumable.resource}.`);
    const restored = Math.min(
      Math.floor(item.consumable.amount * positiveEffectMultiplier),
      maximum - current,
    );
    const total = current + restored;
    character = {
      ...character,
      energy: {
        ...character.energy,
        reserves: { ...character.energy.reserves, [item.consumable.resource]: total },
      },
    };
    secondaryEvents.push({
      id: `${useId}:resource.restored:${item.consumable.resource}`,
      type: 'resource.restored',
      occurredAt: now,
      resource: item.consumable.resource,
      amount: restored,
    });
  }

  character = {
    ...character,
    inventory: { ...character.inventory, [itemId]: quantity - 1 },
  };
  const events: DomainEvent[] = [
    { id: eventId, type: 'item.consumed', occurredAt: now, itemId, quantity: 1 },
    ...secondaryEvents,
  ];
  const processed = new Set(state.processedEventIds);
  const accepted = events.filter((event) => {
    if (processed.has(event.id)) return false;
    processed.add(event.id);
    return true;
  });
  return {
    ...state,
    character,
    events: [...state.events, ...accepted],
    processedEventIds: [...state.processedEventIds, ...accepted.map((event) => event.id)],
  };
}
