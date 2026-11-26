import type {
  EnergyDefinition,
  ItemDefinition,
  RaceDefinition,
  SkillDefinition,
  SystemDefinition,
} from '../content/schema';
import type { Character } from '../domain/types';
import { getInstalledImplantStatModifiers } from '../domain/implants';
import { selectedCombatAffinities } from '../domain/mana-affinities';
import { getManaSpiritDamageBonus } from '../domain/mana-progression';
import { getCombatSkillAction } from '../domain/combat-skill-effects';
import { isEnergyResourceAvailable } from '../domain/energy-rules';
import { getUnaffiliatedEffects } from '../domain/unaffiliated';
import type { CombatAction, CombatActor, CombatDamage } from './types';

export interface PlayerCombatDefaults {
  accuracy: number;
  intervalMs: number;
}

function equippedItems(
  character: Character,
  items: Map<string, ItemDefinition>,
): Array<{ id: string; definition: ItemDefinition }> {
  const ids = Object.values(character.equipment).flatMap((value) =>
    Array.isArray(value) ? value : typeof value === 'string' ? [value] : [],
  );
  return [...new Set(ids)].map((id) => {
    const definition = items.get(id);
    if (!definition) {
      throw new Error(`Unknown equipped item: ${id}.`);
    }
    return { id, definition };
  });
}

function statDamageBonus(character: Character, damage: CombatDamage): number {
  if (damage.channel !== 'physical') {
    return 0;
  }
  const stat =
    damage.subtype === 'crushing'
      ? character.attributes.physical.strength
      : damage.properties.includes('ranged')
        ? character.attributes.physical.precision
        : character.attributes.physical.dexterity;
  return Math.floor((stat * 7) / 2);
}

function weaponAction(
  weapon: { id: string; definition: ItemDefinition } | undefined,
  character: Character,
  defaults: PlayerCombatDefaults,
): CombatAction {
  if (!weapon?.definition.combat?.damage) {
    const amount = Math.floor((character.attributes.physical.strength * 7) / 2);
    return {
      id: 'base:unarmed-strike',
      name: 'Ataque desarmado',
      kind: 'attack',
      target: 'enemy',
      intervalMs: defaults.intervalMs,
      accuracy: defaults.accuracy,
      damage: {
        amount,
        channel: 'physical',
        subtype: 'crushing',
        properties: [],
        origin: { kind: 'ability', id: 'base:unarmed-strike' },
      },
    };
  }
  const configuredDamage = weapon.definition.combat.damage;
  const properties = [
    ...new Set([
      ...(configuredDamage.properties ?? []),
      ...(weapon.definition.properties ?? []),
      ...(weapon.definition.materialProfile?.weaponProperties ?? []),
    ]),
  ];
  return {
    id: weapon.id,
    name: weapon.definition.name,
    kind:
      configuredDamage.channel === 'magical'
        ? 'magic'
        : properties.includes('ranged')
          ? 'ranged'
          : 'attack',
    target: 'enemy',
    intervalMs: defaults.intervalMs,
    accuracy: defaults.accuracy,
    cost: weapon.definition.combat.cost && { ...weapon.definition.combat.cost },
    properties,
    damage: {
      ...configuredDamage,
      amount:
        configuredDamage.amount + statDamageBonus(character, { ...configuredDamage, properties }),
      properties,
      origin: { ...configuredDamage.origin },
      modifiers: configuredDamage.modifiers?.map((modifier) => ({
        ...modifier,
        origin: { ...modifier.origin },
      })),
    },
  };
}

function readEvasion(character: Character): CombatActor['evasion'] {
  const value = character.extensions.combatEvasion;
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const evasion = value as { chance?: unknown; guaranteed?: unknown };
  if (typeof evasion.chance !== 'number' || typeof evasion.guaranteed !== 'number') {
    return undefined;
  }
  return { chance: evasion.chance, guaranteed: evasion.guaranteed };
}

export function createCharacterCombatActor(
  character: Character,
  items: Map<string, ItemDefinition>,
  defaults: PlayerCombatDefaults,
  additionalActions: CombatAction[] = [],
  race?: RaceDefinition,
  systems?: Map<string, SystemDefinition>,
  energyDefinitions: EnergyDefinition[] = [],
  skillDefinitions: SkillDefinition[] = [],
): CombatActor {
  if (
    !Number.isFinite(defaults.accuracy) ||
    defaults.accuracy < 0 ||
    defaults.accuracy > 1 ||
    !Number.isSafeInteger(defaults.intervalMs) ||
    defaults.intervalMs <= 0
  ) {
    throw new Error('Combat defaults have invalid accuracy or interval.');
  }
  const basePhysical = character.attributes.physical;
  const unaffiliated = getUnaffiliatedEffects(
    character,
    energyDefinitions.find((definition) => definition.id === 'energy:unaffiliated'),
  );
  const implantModifiers = systems
    ? getInstalledImplantStatModifiers(character, systems)
    : {
        flat: {},
        multipliers: {},
        consumableMultiplier: 1,
        regenerationPercentPerTurn: 0,
        soulAnchorAvailable: false,
      };
  const physical = { ...basePhysical };
  for (const key of Object.keys(physical)) {
    const baseValue = physical[key] ?? 0;
    physical[key] = Math.floor(
      (baseValue + unaffiliated.physicalAttributeBonus + (implantModifiers.flat[key] ?? 0)) *
        (implantModifiers.multipliers[key] ?? 1),
    );
  }
  if (
    ![
      physical.vigor,
      physical.resistance,
      physical.speed,
      physical.dexterity,
      physical.precision,
      physical.strength,
    ].every(Number.isFinite)
  ) {
    throw new Error('Character has invalid physical attributes.');
  }
  if (physical.speed <= 0) {
    throw new Error('Character needs positive Speed for combat.');
  }
  const equipped = equippedItems(character, items);
  const primary =
    equipped.find(({ id }) => character.equipment.primary === id) ??
    equipped.find(({ id }) => character.equipment.secondary === id);
  const manaDefinition = energyDefinitions.find((definition) => definition.id === 'energy:mana');
  const actions = [
    weaponAction(
      primary,
      { ...character, attributes: { ...character.attributes, physical } },
      defaults,
    ),
    ...additionalActions,
    ...(race?.combatActions ?? []),
  ].map((action) => {
    const damageBonus = getManaSpiritDamageBonus(character, action.damage?.channel, manaDefinition);
    const withEnergyBonus =
      damageBonus > 0 && action.damage
        ? { ...action, damage: { ...action.damage, amount: action.damage.amount + damageBonus } }
        : { ...action };
    return getCombatSkillAction(character, withEnergyBonus, skillDefinitions);
  });
  const remainingMitigation = { physical: 1, magical: 1 };
  for (const { definition } of equipped) {
    for (const channel of ['physical', 'magical'] as const) {
      const value = definition.combat?.mitigation?.[channel] ?? 0;
      if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error(`Item ${definition.id} has invalid ${channel} mitigation.`);
      }
      remainingMitigation[channel] *= 1 - value;
    }
  }
  const equippedRecords = equipped.map(({ id, definition }) => ({
    id,
    properties: [
      ...new Set([
        ...(definition.properties ?? []),
        ...(definition.slot === 'primary' || definition.slot === 'secondary'
          ? (definition.materialProfile?.weaponProperties ?? [])
          : (definition.materialProfile?.armorProperties ?? [])),
      ]),
    ],
  }));
  const equipmentSpeed = equipped.reduce(
    (total, { definition }) => total + (definition.combat?.speed ?? 0),
    0,
  );
  const speed = physical.speed + equipmentSpeed;
  if (speed <= 0) {
    throw new Error('Character needs positive Speed for combat.');
  }
  const maxHp = physical.vigor * 5;
  const maxTenacity = physical.resistance * 10;
  if (![maxHp, maxTenacity, speed].every(Number.isSafeInteger) || maxHp <= 0 || maxTenacity < 0) {
    throw new Error('Character attributes produce invalid combat bars or Speed.');
  }
  const savedHp = character.extensions.combatHp;
  const currentHp = typeof savedHp === 'number' ? savedHp : maxHp;
  if (!Number.isSafeInteger(currentHp) || currentHp < 0 || currentHp > maxHp) {
    throw new Error('Character has invalid saved HP.');
  }
  const regenerationPerAction = Math.floor(maxHp * implantModifiers.regenerationPercentPerTurn);
  if (!Number.isSafeInteger(regenerationPerAction) || regenerationPerAction < 0) {
    throw new Error('Character implants produce invalid regeneration.');
  }
  const affinityElements = selectedCombatAffinities(
    character,
    energyDefinitions.flatMap((definition) => definition.affinities ?? []),
  );
  const energy = { ...character.energy.reserves };
  if (character.energy.affinity === 'unaffiliated') {
    energy.mana = 0;
    energy.aura = 0;
  } else if (character.energy.affinity === 'mana') {
    if (!Object.hasOwn(energy, 'mana'))
      energy.mana = (character.attributes.energetic.mana ?? 0) * 10;
    energy.aura = 0;
  } else if (character.energy.affinity === 'aura') {
    energy.mana = 0;
    if (!Object.hasOwn(energy, 'aura')) energy.aura = character.attributes.energetic.chi ?? 0;
  } else {
    if (!Object.hasOwn(energy, 'mana'))
      energy.mana = (character.attributes.energetic.mana ?? 0) * 10;
    if (!Object.hasOwn(energy, 'aura')) energy.aura = character.attributes.energetic.chi ?? 0;
  }
  for (const { definition } of equipped) {
    for (const [resource, amount] of Object.entries(definition.combat?.energyBonus ?? {})) {
      if (!isEnergyResourceAvailable(character.energy.affinity, resource)) continue;
      energy[resource] = (energy[resource] ?? 0) + amount;
    }
  }
  return {
    id: `player:${character.id}`,
    name: character.name,
    speciesId: character.raceId,
    tags: [
      ...new Set([...(race?.combatTags ?? []), ...(race?.combatTag ? [race.combatTag.id] : [])]),
    ],
    side: 'party',
    attributes: {
      ...physical,
      ...Object.fromEntries(
        Object.entries(character.attributes.energetic).map(([key, value]) => [key, value]),
      ),
      speed,
    },
    hp: { current: currentHp, maximum: maxHp },
    tenacity: { current: maxTenacity, maximum: maxTenacity },
    energy,
    equipment: equippedRecords,
    actions,
    effects: (race?.combatStartEffects ?? []).map((effect) => ({ ...effect })),
    policy: { id: 'base:player-priorities', rules: [] },
    actionPriority: actions.map((action) => action.id),
    mitigation: {
      physical: 1 - remainingMitigation.physical,
      magical: 1 - remainingMitigation.magical,
    },
    damageReduction: unaffiliated.damageReduction,
    evasion: readEvasion(character),
    guarantees: { hits: 0, semiHits: 0, evasions: 0 },
    position: { x: 0, y: 0 },
    ...(affinityElements.length ? { affinityElement: affinityElements[0], affinityElements } : {}),
    regenerationPerAction,
    soulAnchorAvailable: implantModifiers.soulAnchorAvailable,
    state: 'ready',
    nextEventAt: 0,
  };
}
