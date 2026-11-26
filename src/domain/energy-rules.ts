import type { Character } from './types';

export type EnergyAttributeOperation = 'allocate' | 'train';

const manaResources = new Set(['mana', 'spirit']);
const auraResources = new Set(['aura', 'chi', 'ego', 'superego']);

export function getEnergyAttributeAccessError(
  character: Character,
  attributeId: string,
  operation: EnergyAttributeOperation,
): string | undefined {
  if (!attributeId.startsWith('energy:')) return undefined;

  const attribute = attributeId.slice('energy:'.length);
  if (character.energy.affinity === 'unaffiliated') {
    return operation === 'allocate'
      ? 'Sem Afinidade characters cannot allocate energy attributes.'
      : 'Sem Afinidade characters cannot train energy attributes.';
  }
  if (operation === 'allocate' && attribute === 'chi') {
    return 'Chi is cultivated through Aura training and cannot be allocated directly.';
  }
  if (character.energy.affinity === 'aura' && attribute !== 'chi') {
    return operation === 'allocate'
      ? 'Aura characters cannot allocate Mana or Spirit attributes.'
      : 'Aura characters cannot train Mana or Spirit attributes.';
  }
  if (character.energy.affinity === 'mana' && attribute === 'chi') {
    return 'Mana characters cannot train Chi through Aura cultivation.';
  }
  return undefined;
}

export function isEnergyResourceAvailable(affinity: string, resource: string): boolean {
  if (affinity === 'unaffiliated') {
    return !manaResources.has(resource) && !auraResources.has(resource);
  }
  if (affinity === 'mana') return !auraResources.has(resource);
  if (affinity === 'aura') return !manaResources.has(resource);
  return true;
}
