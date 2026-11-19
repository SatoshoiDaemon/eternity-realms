import { describe, expect, it } from 'vitest';
import { createCharacter } from '../domain/model';
import {
  duplicateConstruction,
  equipConstruction,
  moveConstructionPriority,
  saveConstruction,
  unequipConstruction,
  unlockNodes,
} from './library';
import type { NodeGraph } from './graph';

const base = createCharacter({ id: 'hero', name: 'Hero', raceId: 'human', classId: 'wanderer' });
const graph: NodeGraph = {
  schemaVersion: 1,
  id: 'spell:bolt',
  name: 'Bolt',
  kind: 'spell',
  rootId: 's',
  nodes: [{ instanceId: 's', definitionId: 'core:source', children: [] }],
  glyphIds: [],
};

describe('character node library', () => {
  it('unlocks nodes once and saves or replaces a versioned graph', () => {
    const unlocked = unlockNodes(base, ['core:damage', 'core:fire', 'core:damage']);
    expect(unlockNodes(unlocked, ['core:fire']).nodeLibrary?.unlockedNodeIds).toEqual([
      'core:damage',
      'core:fire',
    ]);
    const saved = saveConstruction(unlocked, graph, 12);
    expect(
      saveConstruction(saved, { ...graph, name: 'Fire Bolt' }, 13).nodeLibrary?.constructions[0],
    ).toMatchObject({ graph: { name: 'Fire Bolt' }, updatedAt: 13 });
  });

  it('duplicates with a stable requested id and equips the build in the shared ability list', () => {
    const saved = saveConstruction(base, graph, 1);
    const copied = duplicateConstruction(saved, graph.id, 'spell:bolt-copy', 2);
    expect(copied.nodeLibrary?.constructions[1]).toMatchObject({
      id: 'spell:bolt-copy',
      graph: { id: 'spell:bolt-copy' },
      equipped: false,
    });
    expect(equipConstruction(copied, 'spell:bolt-copy').abilities).toContain('spell:bolt-copy');
  });

  it('rejects malformed nodes, empty ids, conflicting ids, and unknown constructions', () => {
    expect(() => unlockNodes(base, [' '])).toThrow('Node id cannot be empty.');
    expect(() => saveConstruction(base, { ...graph, id: ' ' }, 1)).toThrow(
      'Construction id cannot be empty.',
    );
    expect(() => saveConstruction(base, graph, -1)).toThrow(
      'Construction timestamp must be a non-negative safe integer.',
    );
    expect(() =>
      duplicateConstruction(saveConstruction(base, graph, 1), graph.id, graph.id, 2),
    ).toThrow('Construction already exists: spell:bolt.');
    expect(() => equipConstruction(base, 'missing')).toThrow('Unknown construction: missing.');
    expect(() => duplicateConstruction(base, 'missing', 'spell:copy', 2)).toThrow(
      'Unknown construction: missing.',
    );
    expect(() => duplicateConstruction(saveConstruction(base, graph, 1), graph.id, ' ', 2)).toThrow(
      'Construction id cannot be empty.',
    );
    expect(() =>
      duplicateConstruction(saveConstruction(base, graph, 1), graph.id, 'spell:copy', -1),
    ).toThrow('Construction timestamp must be a non-negative safe integer.');
  });

  it('supports legacy characters, preserves equipped state on edits, and removes build actions cleanly', () => {
    const legacy = { ...base, nodeLibrary: undefined };
    expect(unlockNodes(legacy, ['core:source']).nodeLibrary?.unlockedNodeIds).toEqual([
      'core:source',
    ]);
    const saved = saveConstruction(base, graph, 1);
    const equipped = equipConstruction(saved, graph.id);
    expect(
      saveConstruction(equipped, { ...graph, name: 'Edited' }, 2).nodeLibrary?.constructions[0],
    ).toMatchObject({ equipped: true, graph: { name: 'Edited' } });
    expect(unequipConstruction(equipped, graph.id)).toMatchObject({
      abilities: [],
      nodeLibrary: { constructions: [{ equipped: false }] },
    });
    expect(() => unequipConstruction(base, 'missing')).toThrow('Unknown construction: missing.');
  });

  it('orders equipped builds for automatic combat and drops the order when a build is unequipped', () => {
    const secondGraph = { ...graph, id: 'spell:second', name: 'Second' };
    const equipped = [graph, secondGraph].reduce(
      (character, entry) => equipConstruction(saveConstruction(character, entry, 1), entry.id),
      base,
    );
    expect(equipped.nodeLibrary?.actionPriority).toEqual([graph.id, secondGraph.id]);
    expect(
      moveConstructionPriority(equipped, secondGraph.id, -1).nodeLibrary?.actionPriority,
    ).toEqual([secondGraph.id, graph.id]);
    expect(moveConstructionPriority(equipped, graph.id, -1).nodeLibrary?.actionPriority).toEqual([
      graph.id,
      secondGraph.id,
    ]);
    expect(moveConstructionPriority(equipped, graph.id, 1).nodeLibrary?.actionPriority).toEqual([
      secondGraph.id,
      graph.id,
    ]);
    expect(unequipConstruction(equipped, graph.id).nodeLibrary?.actionPriority).toEqual([
      secondGraph.id,
    ]);
    expect(() => moveConstructionPriority(equipped, 'missing', 1)).toThrow(
      'Construction is not equipped: missing.',
    );
  });
});
