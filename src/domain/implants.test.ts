import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createTestState } from '../test/fixtures';
import type { SystemDefinition } from '../content/schema';
import {
  getAlchemicalLoad,
  getAllImplantDefinitions,
  getBrokenImplantIds,
  getDedalusSyndrome,
  getImplantCapacity,
  getImplantEntry,
  getInstalledImplants,
  getInstalledImplantStatModifiers,
  installImplant,
  removeBrokenImplant,
  resolveImplantCapacity,
} from './implants';

const content = loadOfficialContent();
const now = Date.UTC(2026, 10, 20);

function withAlchemyEntries(entries: Record<string, unknown>[], systemType = 'alchemy') {
  const system = content.systems.get('system:alchemy')!;
  const replacement = { ...system, systemType, entries } as SystemDefinition;
  return { ...content, systems: new Map(content.systems).set('system:alchemy', replacement) };
}

describe('alchemical implants', () => {
  it('loads all twenty official devices and keeps unspecified mechanics explicit', () => {
    const implants = getAllImplantDefinitions(content);
    expect(implants).toHaveLength(20);
    expect(implants.find((implant) => implant.id === 'implant-20')).toMatchObject({
      breaksAfterUse: true,
      resurrections: 1,
      implementationState: 'partial-runtime',
    });
    expect(implants.find((implant) => implant.id === 'implant-18')?.pendingEffects).toContain(
      'taxa de conversão, capacidade de armazenamento e coleta não foram especificadas pela fonte e permanecem pendentes.',
    );
  });

  it('installs an owned device, charges the canonical surgery fee, and persists capacity and load', () => {
    const state = createTestState();
    const character = {
      ...state.character!,
      inventory: { ...state.character!.inventory, 'alchemical-implant-01': 1 },
      extensions: {
        ...state.character!.extensions,
        wallet: { fragments: 20_000 },
        alchemicalCapacity: 5,
      },
    };
    const next = installImplant(
      { ...state, character },
      content,
      'implant-01',
      'implant-operation-1',
      now,
    );

    expect(next.character?.inventory['alchemical-implant-01']).toBe(0);
    expect(next.character?.extensions.wallet).toEqual({ fragments: 10_000 });
    expect(next.character?.extensions.installedImplants).toEqual(['implant-01']);
    expect(next.character?.extensions.alchemicalLoad).toBe(1);
    expect(next.events.at(-1)).toMatchObject({
      id: 'implant-operation-1:implant.installed',
      type: 'implant.installed',
      implantId: 'implant-01',
      load: 1,
      capacity: 5,
      syndrome: 'none',
    });
  });

  it('is idempotent and cannot install the same implant twice', () => {
    const state = createTestState();
    const prepared = {
      ...state,
      character: {
        ...state.character!,
        inventory: { ...state.character!.inventory, 'alchemical-implant-01': 1 },
        extensions: {
          ...state.character!.extensions,
          wallet: { fragments: 20_000 },
          alchemicalCapacity: 5,
        },
      },
    };
    const installed = installImplant(prepared, content, 'implant-01', 'operation-1', now);
    expect(installImplant(installed, content, 'implant-01', 'operation-1', now)).toBe(installed);
    expect(() => installImplant(installed, content, 'implant-01', 'operation-2', now)).toThrow(
      'Implant is already installed: implant-01.',
    );
  });

  it('derives Dédalo severity from load beyond capacity and protects installation atomically', () => {
    const state = createTestState();
    const character = {
      ...state.character!,
      inventory: {
        ...state.character!.inventory,
        'alchemical-implant-01': 1,
        'alchemical-implant-02': 1,
        'alchemical-implant-03': 1,
      },
      extensions: {
        ...state.character!.extensions,
        wallet: { fragments: 40_000 },
        alchemicalCapacity: 5,
        installedImplants: ['implant-04', 'implant-05', 'implant-06', 'implant-07', 'implant-08'],
      },
    };
    const initial = { ...state, character };
    const one = installImplant(initial, content, 'implant-01', 'operation-1', now);
    const two = installImplant(one, content, 'implant-02', 'operation-2', now);
    const three = installImplant(two, content, 'implant-03', 'operation-3', now);

    expect(three.character?.extensions.alchemicalLoad).toBe(8);
    expect(three.events.at(-1)).toMatchObject({ load: 8, capacity: 5, syndrome: 'collapse' });
    expect(initial.character?.inventory['alchemical-implant-01']).toBe(1);
    expect(() =>
      installImplant(
        {
          ...initial,
          character: {
            ...character,
            extensions: { ...character.extensions, wallet: { fragments: 9_999 } },
          },
        },
        content,
        'implant-01',
        'poor-operation',
        now,
      ),
    ).toThrow('Insufficient fragments for implant surgery.');
  });

  it('uses a stable weighted 5/7/9 capacity roll for characters without a saved capacity', () => {
    const results = ['a', 'b', 'c', 'd', 'e', 'f'].map(resolveImplantCapacity);
    expect(results).toEqual([5, 7, 7, 7, 9, 5]);
    expect(resolveImplantCapacity('c')).toBe(7);
  });

  it('applies defined implant bonuses to combat attributes and positive consumables', () => {
    const character = {
      ...createTestState().character!,
      extensions: {
        installedImplants: ['implant-01', 'implant-02', 'implant-05', 'implant-09', 'implant-13'],
      },
    };
    expect(getInstalledImplantStatModifiers(character, content.systems)).toEqual({
      flat: { strength: 100, speed: 100, resistance: 100 },
      multipliers: { resistance: 1.5 },
      consumableMultiplier: 1.5,
      regenerationPercentPerTurn: 0,
      soulAnchorAvailable: false,
    });
  });

  it('removes a broken implant from the body and releases its alchemical charge', () => {
    const character = {
      ...createTestState().character!,
      extensions: {
        installedImplants: ['implant-20'],
        brokenImplants: ['implant-20'],
        alchemicalLoad: 1,
      },
    };
    const removed = removeBrokenImplant(character, content, 'implant-20');
    expect(removed.extensions).toMatchObject({
      installedImplants: [],
      brokenImplants: [],
      alchemicalLoad: 0,
    });
    expect(() => removeBrokenImplant(character, content, 'implant-01')).toThrow(
      'Implant is not installed: implant-01.',
    );
    expect(() =>
      removeBrokenImplant(
        { ...character, extensions: { installedImplants: ['implant-20'] } },
        content,
        'implant-20',
      ),
    ).toThrow('Implant is not broken: implant-20.');
  });

  it('rejects unknown implants, missing devices, invalid operation IDs, and invalid times', () => {
    const state = createTestState();
    expect(() => installImplant(state, content, 'missing', 'op', now)).toThrow(
      'Unknown alchemical implant: missing.',
    );
    expect(() => installImplant(state, content, 'implant-01', 'op', now)).toThrow(
      'Implant device is not in inventory: alchemical-implant-01.',
    );
    expect(() => installImplant(state, content, 'implant-01', '  ', now)).toThrow(
      'Implant operation id cannot be empty.',
    );
    expect(() => installImplant(state, content, 'implant-01', 'op', -1)).toThrow(
      'Implant installation time must be a valid non-negative epoch timestamp.',
    );
  });

  it('validates implant catalogs, legacy save fields, capacity and Dédalo thresholds', () => {
    const character = createTestState().character!;
    expect(getImplantEntry(content, 'missing')).toBeUndefined();
    expect(getInstalledImplants(character, content)).toEqual([]);
    expect(getBrokenImplantIds(character)).toEqual([]);
    expect(getAlchemicalLoad(character, content)).toBe(0);
    expect(() => resolveImplantCapacity('  ')).toThrow('Character id cannot be empty.');
    expect(() =>
      getImplantCapacity({ ...character, extensions: { alchemicalCapacity: 6 } }),
    ).toThrow('Character alchemical capacity is invalid.');
    expect(() =>
      getInstalledImplants(
        { ...character, extensions: { installedImplants: 'implant-01' } },
        content,
      ),
    ).toThrow('Character installed implant list is invalid.');
    expect(() =>
      getInstalledImplants(
        { ...character, extensions: { installedImplants: ['unknown'] } },
        content,
      ),
    ).toThrow('Character has an unknown installed implant: unknown.');
    expect(() =>
      getBrokenImplantIds({ ...character, extensions: { brokenImplants: [1] } }),
    ).toThrow('Character broken implant list is invalid.');
    expect(() => getDedalusSyndrome(-1, 5)).toThrow('Alchemical load or capacity is invalid.');
    expect(() => getDedalusSyndrome(0, 6)).toThrow('Alchemical load or capacity is invalid.');
    expect(getDedalusSyndrome(5, 5)).toBe('none');
    expect(getDedalusSyndrome(6, 5)).toBe('instability');
    expect(getDedalusSyndrome(7, 5)).toBe('psychosis');
    expect(getDedalusSyndrome(8, 5)).toBe('collapse');
    const system = content.systems.get('system:alchemy')!;
    const wrongSystem = { ...system, systemType: 'other' } as SystemDefinition;
    expect(() =>
      getAllImplantDefinitions({ ...content, systems: new Map([['system:alchemy', wrongSystem]]) }),
    ).toThrow('Alchemical implant catalog is unavailable.');
  });

  it('rejects malformed implant definitions, surgery state and journal-only idempotency', () => {
    const original = content.systems
      .get('system:alchemy')!
      .entries.find((entry) => entry.id === 'implant-01')!;
    const malformed: Record<string, unknown>[] = [
      { ...original, name: 1 },
      { ...original, charge: 'one' },
      { ...original, charge: Number.MAX_SAFE_INTEGER + 1 },
      { ...original, charge: 0 },
      { ...original, deviceItemId: 1 },
      { ...original, installationCostFragments: '10000' },
      { ...original, installationCostFragments: Number.MAX_SAFE_INTEGER + 1 },
      { ...original, implementedEffects: 'bad' },
      { ...original, implementedEffects: [1] },
      { ...original, pendingEffects: 'bad' },
      { ...original, pendingEffects: [1] },
    ];
    for (const entry of malformed) {
      expect(() => getAllImplantDefinitions(withAlchemyEntries([entry]))).toThrow(
        'Alchemical implant definition is invalid: implant-01.',
      );
    }
    const state = createTestState();
    const prepared = {
      ...state,
      character: {
        ...state.character!,
        inventory: { 'alchemical-implant-01': 1 },
        extensions: { wallet: { fragments: 20_000 }, alchemicalCapacity: 5 },
      },
    };
    expect(() =>
      installImplant({ ...prepared, character: null }, content, 'implant-01', 'missing-char', now),
    ).toThrow('A character is required to install implants.');
    expect(() =>
      installImplant(
        prepared,
        withAlchemyEntries([{ ...original, installationCostFragments: 9_999 }]),
        'implant-01',
        'bad-fee',
        now,
      ),
    ).toThrow('Implant installation fee must be 10000 fragments.');
    const journal = {
      ...prepared,
      processedEventIds: [],
      events: [
        {
          id: 'journal:implant.installed',
          type: 'implant.installed',
          occurredAt: now,
          implantId: 'implant-01',
          load: 1,
          capacity: 5,
          syndrome: 'none',
        },
      ],
    } as never;
    expect(installImplant(journal, content, 'implant-01', 'journal', now)).toBe(journal);
    const badWallet = {
      ...prepared,
      character: {
        ...prepared.character!,
        extensions: { wallet: { fragments: -1 }, alchemicalCapacity: 5 },
      },
    };
    expect(() => installImplant(badWallet, content, 'implant-01', 'bad-wallet', now)).toThrow(
      'Wallet balance is invalid for fragments.',
    );
    const noWallet = {
      ...prepared,
      character: { ...prepared.character!, extensions: { alchemicalCapacity: 5, wallet: null } },
    };
    expect(() => installImplant(noWallet, content, 'implant-01', 'no-wallet', now)).toThrow(
      'Insufficient fragments for implant surgery.',
    );
    const noFragments = {
      ...prepared,
      character: { ...prepared.character!, extensions: { alchemicalCapacity: 5, wallet: {} } },
    };
    expect(() => installImplant(noFragments, content, 'implant-01', 'no-fragments', now)).toThrow(
      'Insufficient fragments for implant surgery.',
    );
  });

  it('validates broken-implant removal and modifier data', () => {
    const character = createTestState().character!;
    expect(() => removeBrokenImplant(character, content, 'missing')).toThrow(
      'Unknown alchemical implant: missing.',
    );
    const installed = {
      ...character,
      extensions: {
        installedImplants: ['implant-20', 'implant-01'],
        brokenImplants: ['implant-20'],
      },
    };
    expect(removeBrokenImplant(installed, content, 'implant-20').extensions.alchemicalLoad).toBe(1);
    expect(() =>
      removeBrokenImplant(
        { ...installed, extensions: { ...installed.extensions, brokenImplants: [1] } },
        content,
        'implant-20',
      ),
    ).toThrow('Character broken implant list is invalid.');
    expect(() =>
      getInstalledImplantStatModifiers(
        { ...character, extensions: { installedImplants: [1] } },
        content.systems,
      ),
    ).toThrow('Character installed implant list is invalid.');
    expect(() =>
      getInstalledImplantStatModifiers(
        { ...character, extensions: { installedImplants: ['unknown'] } },
        content.systems,
      ),
    ).toThrow('Character has an unknown installed implant: unknown.');
    const original = content.systems
      .get('system:alchemy')!
      .entries.find((entry) => entry.id === 'implant-01')!;
    for (const modifier of [
      { attributeModifiers: { strength: 'high' } },
      { attributeMultipliers: { strength: 0 } },
      { consumablePositiveEffectMultiplier: 0 },
      { regenerationPercentPerTurn: -1 },
    ]) {
      const custom = withAlchemyEntries([{ ...original, ...modifier }]);
      expect(() =>
        getInstalledImplantStatModifiers(
          { ...character, extensions: { installedImplants: ['implant-01'] } },
          custom.systems,
        ),
      ).toThrow('Implant implant-01 has an invalid');
    }
    expect(getInstalledImplantStatModifiers(character, new Map()).soulAnchorAvailable).toBe(false);
  });
});
