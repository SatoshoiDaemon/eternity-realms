import type { Character, NodeLibrary, SavedConstruction } from '../domain/types';
import type { NodeGraph } from './graph';

export function createNodeLibrary(): NodeLibrary {
  return { schemaVersion: 1, unlockedNodeIds: [], constructions: [], actionPriority: [] };
}

function libraryOf(character: Character): NodeLibrary {
  return character.nodeLibrary ?? createNodeLibrary();
}

export function constructionPriority(character: Character): string[] {
  const library = libraryOf(character);
  const equippedIds = new Set(
    library.constructions.filter((entry) => entry.equipped).map((entry) => entry.id),
  );
  const stored = (library.actionPriority ?? []).filter((id) => equippedIds.has(id));
  return [...new Set([...stored, ...[...equippedIds].sort()])];
}

export function moveConstructionPriority(
  character: Character,
  constructionId: string,
  direction: -1 | 1,
): Character {
  const order = constructionPriority(character);
  const currentIndex = order.indexOf(constructionId);
  if (currentIndex < 0) {
    throw new Error(`Construction is not equipped: ${constructionId}.`);
  }
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= order.length) {
    return character;
  }
  [order[currentIndex], order[nextIndex]] = [order[nextIndex]!, order[currentIndex]!];
  return { ...character, nodeLibrary: { ...libraryOf(character), actionPriority: order } };
}

export function unlockNodes(character: Character, nodeIds: string[]): Character {
  const normalized = nodeIds.map((id) => id.trim());
  if (normalized.some((id) => !id)) {
    throw new Error('Node id cannot be empty.');
  }
  const library = libraryOf(character);
  return {
    ...character,
    nodeLibrary: {
      ...library,
      unlockedNodeIds: [...new Set([...library.unlockedNodeIds, ...normalized])].sort(),
    },
  };
}

export function saveConstruction(
  character: Character,
  graph: NodeGraph,
  updatedAt: number,
): Character {
  if (!graph.id.trim()) {
    throw new Error('Construction id cannot be empty.');
  }
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new Error('Construction timestamp must be a non-negative safe integer.');
  }
  const library = libraryOf(character);
  const saved: SavedConstruction = {
    id: graph.id,
    graph: structuredClone(graph),
    equipped: library.constructions.find((entry) => entry.id === graph.id)?.equipped ?? false,
    updatedAt,
  };
  const constructions = [
    ...library.constructions.filter((entry) => entry.id !== graph.id),
    saved,
  ].sort((left, right) => left.id.localeCompare(right.id));
  return { ...character, nodeLibrary: { ...library, constructions } };
}

export function duplicateConstruction(
  character: Character,
  sourceId: string,
  newId: string,
  updatedAt: number,
): Character {
  const source = libraryOf(character).constructions.find((entry) => entry.id === sourceId);
  if (!source) {
    throw new Error(`Unknown construction: ${sourceId}.`);
  }
  if (!newId.trim()) {
    throw new Error('Construction id cannot be empty.');
  }
  if (libraryOf(character).constructions.some((entry) => entry.id === newId)) {
    throw new Error(`Construction already exists: ${newId}.`);
  }
  return saveConstruction(
    character,
    { ...structuredClone(source.graph), id: newId, name: `${source.graph.name} (cópia)` },
    updatedAt,
  );
}

export function equipConstruction(character: Character, constructionId: string): Character {
  const library = libraryOf(character);
  if (!library.constructions.some((entry) => entry.id === constructionId)) {
    throw new Error(`Unknown construction: ${constructionId}.`);
  }
  return {
    ...character,
    abilities: [...new Set([...character.abilities, constructionId])],
    nodeLibrary: {
      ...library,
      actionPriority: [...constructionPriority(character), constructionId].filter(
        (id, index, values) => values.indexOf(id) === index,
      ),
      constructions: library.constructions.map((entry) =>
        entry.id === constructionId ? { ...entry, equipped: true } : entry,
      ),
    },
  };
}

export function unequipConstruction(character: Character, constructionId: string): Character {
  const library = libraryOf(character);
  if (!library.constructions.some((entry) => entry.id === constructionId)) {
    throw new Error(`Unknown construction: ${constructionId}.`);
  }
  return {
    ...character,
    abilities: character.abilities.filter((id) => id !== constructionId),
    nodeLibrary: {
      ...library,
      actionPriority: constructionPriority(character).filter((id) => id !== constructionId),
      constructions: library.constructions.map((entry) =>
        entry.id === constructionId ? { ...entry, equipped: false } : entry,
      ),
    },
  };
}
