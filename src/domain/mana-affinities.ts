import type { EnergyDefinition } from '../content/schema';
import type { Character } from './types';
import { unlockNodes } from '../nodes/library';

export type EnergyPath = 'mana' | 'aura' | 'unaffiliated';
export type ManaAffinityDefinition = NonNullable<EnergyDefinition['affinities']>[number];

export const MANA_AFFINITY_SELECTION_LIMIT = 4;

export function selectEnergyPath(character: Character, path: EnergyPath): Character {
  if (character.energy.affinity === path) return character;
  if (character.energy.affinity !== 'unawakened' && character.energy.affinity !== path) {
    throw new Error('An awakened energy path cannot be changed.');
  }
  return {
    ...character,
    energy: {
      ...character.energy,
      affinity: path,
      ...(path === 'unaffiliated' ? { unaffiliatedStage: 'incomplete' as const } : {}),
    },
  };
}

export function selectManaAffinities(
  character: Character,
  affinityIds: string[],
  definitions: ManaAffinityDefinition[],
): Character {
  if (character.energy.affinity !== 'mana') {
    throw new Error('Mana affinities can only be selected when the character follows Mana.');
  }
  if (character.extensions.manaAffinitiesLocked === true) {
    throw new Error('Mana affinities are already sealed.');
  }
  if (affinityIds.length > MANA_AFFINITY_SELECTION_LIMIT) {
    throw new Error('A character can select at most four Mana affinities.');
  }
  if (new Set(affinityIds).size !== affinityIds.length) {
    throw new Error('Mana affinities must be unique.');
  }

  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const selected = affinityIds.map((id) => {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error(`Unknown Mana affinity: ${id}.`);
    return definition;
  });
  const updated: Character = {
    ...character,
    energy: { ...character.energy, affinities: [...affinityIds] },
  };
  return unlockNodes(
    updated,
    selected.flatMap((definition) => (definition.nodeId ? [definition.nodeId] : [])),
  );
}

export function sealManaAffinities(character: Character): Character {
  if (character.energy.affinity !== 'mana') {
    throw new Error('Mana affinities can only be sealed when the character follows Mana.');
  }
  if (!(character.energy.affinities?.length ?? 0)) {
    throw new Error('Select at least one Mana affinity before sealing.');
  }
  return {
    ...character,
    extensions: { ...character.extensions, manaAffinitiesLocked: true },
  };
}

export function selectedCombatAffinities(
  character: Character,
  definitions: ManaAffinityDefinition[],
): string[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition.element]));
  if (character.energy.affinity !== 'mana') {
    const legacyElement = byId.get(character.energy.affinity);
    return legacyElement ? [legacyElement] : [];
  }
  return (character.energy.affinities ?? [])
    .map((id) => byId.get(id))
    .filter((element): element is string => Boolean(element));
}
