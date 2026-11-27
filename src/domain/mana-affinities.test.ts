import { describe, expect, it } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createCharacter } from './model';
import {
  selectEnergyPath,
  selectManaAffinities,
  sealManaAffinities,
  selectedCombatAffinities,
} from './mana-affinities';

const content = loadOfficialContent();
const mana = content.energies.get('energy:mana')!;
const character = () =>
  createCharacter({ id: 'affinity-hero', name: 'Hero', raceId: 'human', classId: 'wanderer' });

describe('mana affinity progression', () => {
  it('exposes the seven documented basic affinities, combinations and awakened evolutions', () => {
    expect(mana.affinities?.map(({ id }) => id)).toEqual([
      'fire',
      'earth',
      'shadow',
      'poison',
      'light',
      'air',
      'water',
    ]);
    expect(mana.combinations).toHaveLength(18);
    expect(
      mana.combinations
        ?.filter((entry) => entry.sourceStatus === 'conflicting')
        .map((entry) => entry.id),
    ).toEqual(['earth-water-plants', 'water-earth-ice', 'light-fire-ray']);
    expect(mana.evolutions?.map(({ result }) => result)).toEqual([
      'Plasma',
      'Zero Absoluto',
      'Matéria',
      'Vetor',
      'Energia',
      'Gravidade',
      'Julgamento',
    ]);
  });

  it('maps each documented Mana affinity to an executable elemental node', () => {
    for (const affinity of mana.affinities ?? []) {
      expect(content.nodes.find((node) => node.id === affinity.nodeId)).toMatchObject({
        id: affinity.nodeId,
        category: 'type',
        damageType: { channel: 'magical', element: affinity.element },
      });
    }
  });

  it('persists a selected energy path without replacing legacy reserves', () => {
    const source = { ...character(), energy: { affinity: 'unawakened', reserves: { mana: 9 } } };
    expect(selectEnergyPath(source, 'mana').energy).toEqual({
      affinity: 'mana',
      reserves: { mana: 9 },
    });
  });

  it('initializes the canonical Incomplete stage when Sem Afinidade is selected', () => {
    const selected = selectEnergyPath(character(), 'unaffiliated');
    expect(selected.energy).toEqual({
      affinity: 'unaffiliated',
      unaffiliatedStage: 'incomplete',
      reserves: {},
    });
  });

  it('keeps an awakened energy path permanent', () => {
    const manaCharacter = selectEnergyPath(character(), 'mana');
    expect(selectEnergyPath(manaCharacter, 'mana')).toBe(manaCharacter);
    expect(() => selectEnergyPath(manaCharacter, 'aura')).toThrow(
      'An awakened energy path cannot be changed.',
    );
  });

  it('selects up to four documented affinities and unlocks their executable type nodes', () => {
    const selected = selectManaAffinities(
      { ...character(), energy: { affinity: 'mana', reserves: {} } },
      ['fire', 'water', 'earth', 'poison'],
      mana.affinities ?? [],
    );

    expect(selected.energy.affinities).toEqual(['fire', 'water', 'earth', 'poison']);
    expect(selected.nodeLibrary?.unlockedNodeIds).toEqual([
      'core:type-earth',
      'core:type-fire',
      'core:type-poison',
      'core:type-water',
    ]);
  });

  it('keeps node unlocks when an affinity is deselected and allows an empty unawakened profile', () => {
    const selected = selectManaAffinities(
      { ...character(), energy: { affinity: 'mana', reserves: {} } },
      ['fire', 'air'],
      mana.affinities ?? [],
    );
    const deselected = selectManaAffinities(selected, ['air'], mana.affinities ?? []);
    const unselected = selectManaAffinities(deselected, [], mana.affinities ?? []);

    expect(deselected.energy.affinities).toEqual(['air']);
    expect(deselected.nodeLibrary?.unlockedNodeIds).toEqual(['core:type-air', 'core:type-fire']);
    expect(unselected.energy.affinities).toEqual([]);
  });

  it('supports modded affinities that do not grant a node and resolves saved legacy affinities', () => {
    const modAffinity = {
      id: 'mod:echo',
      name: 'Eco',
      element: 'echo',
      sourceStatus: 'adapted' as const,
    };
    const selected = selectManaAffinities(
      { ...character(), energy: { affinity: 'mana', reserves: {} } },
      ['mod:echo'],
      [modAffinity],
    );
    expect(selected.nodeLibrary?.unlockedNodeIds).toEqual([]);
    expect(
      selectedCombatAffinities(
        { ...character(), energy: { affinity: 'fire', reserves: {} } },
        mana.affinities ?? [],
      ),
    ).toEqual(['fire']);
    expect(
      selectedCombatAffinities(
        { ...character(), energy: { affinity: 'aura', reserves: {} } },
        mana.affinities ?? [],
      ),
    ).toEqual([]);
    expect(selectedCombatAffinities(selected, [modAffinity])).toEqual(['echo']);
  });

  it('seals an initial affinity selection and prevents later changes', () => {
    const selected = selectManaAffinities(
      { ...character(), energy: { affinity: 'mana', reserves: {} } },
      ['fire'],
      mana.affinities ?? [],
    );
    const sealed = sealManaAffinities(selected);
    expect(sealed.extensions.manaAffinitiesLocked).toBe(true);
    expect(() => selectManaAffinities(sealed, ['water'], mana.affinities ?? [])).toThrow(
      'Mana affinities are already sealed.',
    );
    expect(() => sealManaAffinities(character())).toThrow(
      'Mana affinities can only be sealed when the character follows Mana.',
    );
    expect(() =>
      sealManaAffinities({ ...character(), energy: { affinity: 'mana', reserves: {} } }),
    ).toThrow('Select at least one Mana affinity before sealing.');
  });

  it('rejects over-selection, unknown affinities, duplicates and profiles outside Mana', () => {
    const manaCharacter = { ...character(), energy: { affinity: 'mana', reserves: {} } };
    expect(() =>
      selectManaAffinities(
        manaCharacter,
        ['fire', 'earth', 'shadow', 'poison', 'light'],
        mana.affinities ?? [],
      ),
    ).toThrow('A character can select at most four Mana affinities.');
    expect(() => selectManaAffinities(manaCharacter, ['void'], mana.affinities ?? [])).toThrow(
      'Unknown Mana affinity: void.',
    );
    expect(() =>
      selectManaAffinities(manaCharacter, ['fire', 'fire'], mana.affinities ?? []),
    ).toThrow('Mana affinities must be unique.');
    expect(() => selectManaAffinities(character(), ['fire'], mana.affinities ?? [])).toThrow(
      'Mana affinities can only be selected when the character follows Mana.',
    );
  });
});
