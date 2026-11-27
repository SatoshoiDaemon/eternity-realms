import type { ContentCatalog } from '../content/registry';
import type { SystemDefinition } from '../content/schema';
import type { Character, DomainEvent, GameState } from './types';

const INSTALLATION_FEE = 10_000;
const VALID_CAPACITIES = [5, 7, 9] as const;
type ImplantCapacity = (typeof VALID_CAPACITIES)[number];
export type DedalusSyndrome = 'none' | 'instability' | 'psychosis' | 'collapse';

export interface ImplantEntry extends Record<string, unknown> {
  id: string;
  name: string;
  charge: number;
  deviceItemId: string;
  installationCostFragments: number;
  implementationState: string;
  implementedEffects: string[];
  pendingEffects: string[];
}

function implantEntries(systems: Map<string, SystemDefinition>): Map<string, ImplantEntry> {
  const system = systems.get('system:alchemy');
  if (!system) return new Map();
  if (system.systemType !== 'alchemy') {
    throw new Error('Alchemical implant catalog is unavailable.');
  }
  const entries = new Map<string, ImplantEntry>();
  for (const entry of system.entries) {
    if (typeof entry.id !== 'string' || !entry.id.startsWith('implant-')) continue;
    if (
      typeof entry.name !== 'string' ||
      typeof entry.charge !== 'number' ||
      !Number.isSafeInteger(entry.charge) ||
      entry.charge <= 0 ||
      typeof entry.deviceItemId !== 'string' ||
      typeof entry.installationCostFragments !== 'number' ||
      !Number.isSafeInteger(entry.installationCostFragments) ||
      !Array.isArray(entry.implementedEffects) ||
      !entry.implementedEffects.every((value) => typeof value === 'string') ||
      !Array.isArray(entry.pendingEffects) ||
      !entry.pendingEffects.every((value) => typeof value === 'string')
    ) {
      throw new Error(`Alchemical implant definition is invalid: ${entry.id}.`);
    }
    entries.set(entry.id, entry as ImplantEntry);
  }
  return entries;
}

export function getImplantEntry(
  content: ContentCatalog,
  implantId: string,
): ImplantEntry | undefined {
  return implantEntries(content.systems).get(implantId);
}

export function getAllImplantDefinitions(content: ContentCatalog): ImplantEntry[] {
  return [...implantEntries(content.systems).values()];
}

export function getInstalledImplants(
  character: Character,
  content: ContentCatalog,
): ImplantEntry[] {
  const value = character.extensions.installedImplants;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new Error('Character installed implant list is invalid.');
  }
  const definitions = implantEntries(content.systems);
  return value.map((id) => {
    const entry = definitions.get(id);
    if (!entry) throw new Error(`Character has an unknown installed implant: ${id}.`);
    return entry;
  });
}

function capacityRoll(characterId: string): ImplantCapacity {
  let sum = 0;
  for (const character of characterId) sum = (sum + character.charCodeAt(0)) % 6;
  if (sum < 2) return 5;
  if (sum < 5) return 7;
  return 9;
}

export function resolveImplantCapacity(characterId: string): ImplantCapacity {
  if (!characterId.trim()) throw new Error('Character id cannot be empty.');
  return capacityRoll(characterId);
}

export function getImplantCapacity(character: Character): ImplantCapacity {
  const saved = character.extensions.alchemicalCapacity;
  if (saved === undefined) return resolveImplantCapacity(character.id);
  if (!VALID_CAPACITIES.includes(saved as ImplantCapacity)) {
    throw new Error('Character alchemical capacity is invalid.');
  }
  return saved as ImplantCapacity;
}

export function getAlchemicalLoad(character: Character, content: ContentCatalog): number {
  return getInstalledImplants(character, content).reduce((sum, implant) => sum + implant.charge, 0);
}

export function getBrokenImplantIds(character: Character): string[] {
  const value = character.extensions.brokenImplants;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new Error('Character broken implant list is invalid.');
  }
  return [...value];
}

export function getDedalusSyndrome(load: number, capacity: number): DedalusSyndrome {
  if (
    !Number.isSafeInteger(load) ||
    load < 0 ||
    !VALID_CAPACITIES.includes(capacity as ImplantCapacity)
  ) {
    throw new Error('Alchemical load or capacity is invalid.');
  }
  const excess = load - capacity;
  if (excess <= 0) return 'none';
  if (excess === 1) return 'instability';
  if (excess === 2) return 'psychosis';
  return 'collapse';
}

function readWallet(character: Character): Record<string, number> {
  const value = character.extensions.wallet;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const wallet = value as Record<string, number>;
  for (const [currency, balance] of Object.entries(wallet)) {
    if (!currency.trim() || !Number.isSafeInteger(balance) || balance < 0) {
      throw new Error(`Wallet balance is invalid for ${currency}.`);
    }
  }
  return { ...wallet };
}

function appendEvents(state: GameState, events: DomainEvent[]): GameState {
  return {
    ...state,
    events: [...state.events, ...events],
    processedEventIds: [...state.processedEventIds, ...events.map((event) => event.id)],
  };
}

function validateNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Implant installation time must be a valid non-negative epoch timestamp.');
  }
}

export function installImplant(
  state: GameState,
  content: ContentCatalog,
  implantId: string,
  operationId: string,
  now: number,
): GameState {
  validateNow(now);
  if (!operationId.trim()) throw new Error('Implant operation id cannot be empty.');
  const eventId = `${operationId}:implant.installed`;
  if (
    state.processedEventIds.includes(eventId) ||
    state.events.some((event) => event.id === eventId)
  ) {
    return state;
  }
  if (!state.character) throw new Error('A character is required to install implants.');
  const definitions = implantEntries(content.systems);
  const implant = definitions.get(implantId);
  if (!implant) throw new Error(`Unknown alchemical implant: ${implantId}.`);
  const installed = getInstalledImplants(state.character, content);
  if (installed.some((entry) => entry.id === implantId)) {
    throw new Error(`Implant is already installed: ${implantId}.`);
  }
  const quantity = state.character.inventory[implant.deviceItemId] ?? 0;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`Implant device is not in inventory: ${implant.deviceItemId}.`);
  }
  if (implant.installationCostFragments !== INSTALLATION_FEE) {
    throw new Error(`Implant installation fee must be ${INSTALLATION_FEE} fragments.`);
  }
  const wallet = readWallet(state.character);
  const balance = wallet.fragments ?? 0;
  if (balance < implant.installationCostFragments) {
    throw new Error('Insufficient fragments for implant surgery.');
  }

  const capacity = getImplantCapacity(state.character);
  const installedIds = [
    ...((state.character.extensions.installedImplants as string[] | undefined) ?? []),
    implantId,
  ];
  const nextCharacter: Character = {
    ...state.character,
    inventory: { ...state.character.inventory, [implant.deviceItemId]: quantity - 1 },
    extensions: {
      ...state.character.extensions,
      wallet: { ...wallet, fragments: balance - implant.installationCostFragments },
      installedImplants: installedIds,
      alchemicalCapacity: capacity,
      alchemicalLoad: installed.reduce((sum, entry) => sum + entry.charge, 0) + implant.charge,
    },
  };
  const nextState = { ...state, character: nextCharacter };
  return appendEvents(nextState, [
    {
      id: eventId,
      type: 'implant.installed',
      occurredAt: now,
      implantId,
      load: nextCharacter.extensions.alchemicalLoad as number,
      capacity,
      syndrome: getDedalusSyndrome(nextCharacter.extensions.alchemicalLoad as number, capacity),
    },
  ]);
}

export function removeBrokenImplant(
  character: Character,
  content: ContentCatalog,
  implantId: string,
): Character {
  const implant = implantEntries(content.systems).get(implantId);
  if (!implant) throw new Error(`Unknown alchemical implant: ${implantId}.`);
  const installed = getInstalledImplants(character, content);
  if (!installed.some((entry) => entry.id === implantId)) {
    throw new Error(`Implant is not installed: ${implantId}.`);
  }
  const value = character.extensions.brokenImplants;
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
  ) {
    throw new Error('Character broken implant list is invalid.');
  }
  const broken = new Set((value as string[] | undefined) ?? []);
  if (!broken.has(implantId)) throw new Error(`Implant is not broken: ${implantId}.`);
  broken.delete(implantId);
  const installedIds = (character.extensions.installedImplants as string[]).filter(
    (id) => id !== implantId,
  );
  const remainingLoad = installed
    .filter((entry) => entry.id !== implantId)
    .reduce((sum, entry) => sum + entry.charge, 0);
  return {
    ...character,
    extensions: {
      ...character.extensions,
      installedImplants: installedIds,
      brokenImplants: [...broken],
      alchemicalLoad: remainingLoad,
    },
  };
}

export function getInstalledImplantStatModifiers(
  character: Character,
  systems: Map<string, SystemDefinition>,
): {
  flat: Record<string, number>;
  multipliers: Record<string, number>;
  consumableMultiplier: number;
  regenerationPercentPerTurn: number;
  soulAnchorAvailable: boolean;
} {
  const result = {
    flat: {} as Record<string, number>,
    multipliers: {} as Record<string, number>,
    consumableMultiplier: 1,
    regenerationPercentPerTurn: 0,
    soulAnchorAvailable: false,
  };
  const definitions = implantEntries(systems);
  const value = character.extensions.installedImplants;
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
  ) {
    throw new Error('Character installed implant list is invalid.');
  }
  const broken = new Set(getBrokenImplantIds(character));
  for (const implantId of (value as string[] | undefined) ?? []) {
    const implant = definitions.get(implantId);
    if (!implant) throw new Error(`Character has an unknown installed implant: ${implantId}.`);
    const flat = implant.attributeModifiers;
    if (typeof flat === 'object' && flat !== null && !Array.isArray(flat)) {
      for (const [attribute, value] of Object.entries(flat)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`Implant ${implant.id} has an invalid attribute modifier.`);
        }
        result.flat[attribute] = (result.flat[attribute] ?? 0) + value;
      }
    }
    const multipliers = implant.attributeMultipliers;
    if (typeof multipliers === 'object' && multipliers !== null && !Array.isArray(multipliers)) {
      for (const [attribute, value] of Object.entries(multipliers)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          throw new Error(`Implant ${implant.id} has an invalid attribute multiplier.`);
        }
        result.multipliers[attribute] = (result.multipliers[attribute] ?? 1) * value;
      }
    }
    if (implant.consumablePositiveEffectMultiplier !== undefined) {
      const value = implant.consumablePositiveEffectMultiplier;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Implant ${implant.id} has an invalid consumable multiplier.`);
      }
      result.consumableMultiplier *= value;
    }
    if (implant.regenerationPercentPerTurn !== undefined) {
      const value = implant.regenerationPercentPerTurn;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Implant ${implant.id} has an invalid regeneration value.`);
      }
      result.regenerationPercentPerTurn += value;
    }
    if (implant.id === 'implant-20' && implant.resurrections === 1 && !broken.has(implant.id)) {
      result.soulAnchorAvailable = true;
    }
  }
  return result;
}
