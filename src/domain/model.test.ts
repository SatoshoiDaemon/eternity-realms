import { describe, expect, it } from 'vitest';
import { createCharacter, createInitialGameState } from './model';

describe('character model', () => {
  it('creates an extensible level-one character with empty equipment and inventory', () => {
    const character = createCharacter({
      id: 'c1',
      name: '  Aria  ',
      raceId: 'human',
      classId: 'wanderer',
    });

    expect(character.name).toBe('Aria');
    expect(character.level).toBe(1);
    expect(character.experience).toEqual({ current: 0, total: 0 });
    expect(character.attributes.physical).toEqual({
      vigor: 1,
      resistance: 1,
      speed: 1,
      dexterity: 1,
      precision: 1,
      strength: 1,
    });
    expect(character.energy).toEqual({ affinity: 'unawakened', reserves: {} });
    expect(character.equipment).toEqual({
      head: null,
      chest: null,
      legs: null,
      hands: null,
      feet: null,
      primary: null,
      secondary: null,
      accessories: [],
    });
    expect(character.inventory).toEqual({});
    expect(character.skills).toEqual({});
    expect(character.extensions).toEqual({});
    expect(character.activityState).toBe('idle');
  });

  it('rejects blank names and missing identity fields', () => {
    expect(() => createCharacter({ id: 'c1', name: '  ', raceId: 'human', classId: 'x' })).toThrow(
      'Character name cannot be empty.',
    );
    expect(() => createCharacter({ id: '', name: 'Aria', raceId: 'human', classId: 'x' })).toThrow(
      'Character id cannot be empty.',
    );
    expect(() => createCharacter({ id: 'c1', name: 'Aria', raceId: ' ', classId: 'x' })).toThrow(
      'Character race id cannot be empty.',
    );
    expect(() =>
      createCharacter({ id: 'c1', name: 'Aria', raceId: 'human', classId: ' ' }),
    ).toThrow('Character class id cannot be empty.');
  });

  it('copies extension data into the character save', () => {
    const extensions = { 'mod-pack': { trait: 'curious' } };
    const character = createCharacter({
      id: 'c1',
      name: 'Aria',
      raceId: 'human',
      classId: 'wanderer',
      extensions,
    });

    expect(character.extensions).toEqual(extensions);
    expect(character.extensions).not.toBe(extensions);
  });

  it('creates the empty game state used by the save repository', () => {
    expect(createInitialGameState()).toEqual({
      schemaVersion: 1,
      revision: 0,
      character: null,
      sessions: [],
      queue: [],
      events: [],
      processedEventIds: [],
      combatRecords: [],
    });
  });
});
