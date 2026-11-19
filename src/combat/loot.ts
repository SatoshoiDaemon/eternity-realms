export interface LootEntry {
  itemId: string;
  quantity: number;
  chance?: number;
  weight?: number;
}

export type LootCondition =
  | { kind: 'tag'; value: string }
  | { kind: 'enemy_id'; value: string }
  | { kind: 'death_cause'; value: string }
  | { kind: 'activity_kind'; value: 'quest' | 'dungeon' | 'raid' }
  | { kind: 'environment'; key: string; value: string };

export interface LootTable {
  id: string;
  guaranteed?: LootEntry[];
  independent?: LootEntry[];
  exclusive?: Array<{ id: string; rolls: number; entries: LootEntry[] }>;
  conditional?: Array<{
    id: string;
    when: LootCondition[];
    drops: LootEntry[];
    unlockNodeIds?: string[];
  }>;
  unlockNodeIds?: string[];
}

export interface LootContext {
  enemyId: string;
  tags: string[];
  activityKind: 'quest' | 'dungeon' | 'raid';
  deathCause?: string;
  environment: Record<string, string | undefined>;
}

export interface LootDrop {
  rewardId: string;
  itemId: string;
  quantity: number;
  sourceTableId: string;
}

export interface LootResult {
  drops: LootDrop[];
  unlockedNodeIds: string[];
}

function validateEntry(entry: LootEntry, path: string, independent: boolean): void {
  if (!entry.itemId.trim() || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) {
    throw new Error(`Invalid loot entry at ${path}.`);
  }
  if (
    independent &&
    (typeof entry.chance !== 'number' ||
      !Number.isFinite(entry.chance) ||
      entry.chance < 0 ||
      entry.chance > 1)
  ) {
    throw new Error(`Invalid loot chance at ${path}.`);
  }
  if (
    !independent &&
    entry.weight !== undefined &&
    (!Number.isSafeInteger(entry.weight) || entry.weight <= 0)
  ) {
    throw new Error(`Invalid loot weight at ${path}.`);
  }
}

function matchesCondition(condition: LootCondition, context: LootContext): boolean {
  switch (condition.kind) {
    case 'tag':
      return context.tags.includes(condition.value);
    case 'enemy_id':
      return context.enemyId === condition.value;
    case 'death_cause':
      return context.deathCause === condition.value;
    case 'activity_kind':
      return context.activityKind === condition.value;
    case 'environment':
      return context.environment[condition.key] === condition.value;
  }
}

function randomSource(seed: number): () => number {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('Loot seed must be a non-negative safe integer.');
  }
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function chooseWeighted(entries: LootEntry[], random: () => number): LootEntry {
  const total = entries.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
  const draw = random() * total;
  let accumulated = 0;
  for (const entry of entries) {
    accumulated += entry.weight ?? 1;
    if (draw < accumulated) {
      return entry;
    }
  }
  return entries.at(-1)!;
}

export function rollLoot(
  table: LootTable,
  context: LootContext,
  seed: number,
  rewardIdPrefix: string,
): LootResult {
  if (!table.id.trim() || !rewardIdPrefix.trim()) {
    throw new Error('Loot table and reward identifiers cannot be empty.');
  }
  const random = randomSource(seed);
  const drops: LootDrop[] = [];
  const unlockedNodeIds = new Set(table.unlockNodeIds ?? []);
  const addDrop = (entry: LootEntry, rewardId: string, sourceTableId = table.id) => {
    drops.push({ rewardId, itemId: entry.itemId, quantity: entry.quantity, sourceTableId });
  };

  (table.guaranteed ?? []).forEach((entry, index) => {
    validateEntry(entry, `guaranteed[${index}]`, false);
    addDrop(entry, `${rewardIdPrefix}:${table.id}:guaranteed:${index}`);
  });
  (table.independent ?? []).forEach((entry, index) => {
    validateEntry(entry, `independent[${index}]`, true);
    if (random() < entry.chance!) {
      addDrop(entry, `${rewardIdPrefix}:${table.id}:independent:${index}`);
    }
  });
  (table.exclusive ?? []).forEach((pool, poolIndex) => {
    if (
      !pool.id.trim() ||
      !Number.isSafeInteger(pool.rolls) ||
      pool.rolls < 0 ||
      pool.entries.length === 0
    ) {
      throw new Error(`Invalid exclusive loot pool at exclusive[${poolIndex}].`);
    }
    pool.entries.forEach((entry, entryIndex) =>
      validateEntry(entry, `exclusive[${poolIndex}].entries[${entryIndex}]`, false),
    );
    for (let roll = 0; roll < pool.rolls; roll += 1) {
      const entry = chooseWeighted(pool.entries, random);
      addDrop(entry, `${rewardIdPrefix}:${table.id}:exclusive:${pool.id}:${roll}`);
    }
  });
  (table.conditional ?? []).forEach((conditional, index) => {
    if (!conditional.id.trim()) {
      throw new Error(`Invalid conditional loot id at conditional[${index}].`);
    }
    if (!conditional.when.every((condition) => matchesCondition(condition, context))) {
      return;
    }
    conditional.drops.forEach((entry, entryIndex) => {
      validateEntry(entry, `conditional[${index}].drops[${entryIndex}]`, false);
      addDrop(entry, `${rewardIdPrefix}:${table.id}:conditional:${conditional.id}:${entryIndex}`);
    });
    conditional.unlockNodeIds?.forEach((nodeId) => unlockedNodeIds.add(nodeId));
  });
  return { drops, unlockedNodeIds: [...unlockedNodeIds].sort() };
}
