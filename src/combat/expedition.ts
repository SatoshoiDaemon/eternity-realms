import { advanceCombat, createCombatState } from './combat-engine';
import { rollLoot, type LootContext, type LootDrop, type LootTable } from './loot';
import type { EnemyTagDefinition } from './tag-registry';
import type { CombatActor, CombatEnvironment, CombatState } from './types';

export interface EnemyDefinition extends Omit<
  CombatActor,
  'id' | 'name' | 'speciesId' | 'tags' | 'side' | 'state' | 'nextEventAt'
> {
  id: string;
  name: string;
  tags: string[];
  lootTableId?: string;
  experience: number;
  variantId?: string;
  elite?: boolean;
  boss?: boolean;
}

export interface ExpeditionDefinition {
  id: string;
  activityKind: 'quest' | 'dungeon' | 'raid';
  spawnIntervalMs: number;
  deathRewardRetention: number;
  environment: CombatEnvironment;
  encounters: Array<{
    id: string;
    enemyId: string;
    weight: number;
    count?: number;
    variantId?: string;
  }>;
  nodeUnlocks?: string[];
}

export interface ExpeditionSimulationInput {
  sessionId: string;
  player: CombatActor;
  expedition: ExpeditionDefinition;
  enemies: EnemyDefinition[];
  lootTables: LootTable[];
  durationMs: number;
  seed: number;
  tagRegistry?: EnemyTagDefinition[];
}

export interface ExpeditionSimulationResult {
  kills: number;
  deaths: number;
  experience: number;
  drops: LootDrop[];
  unlockedNodeIds: string[];
  combats: CombatState[];
  nextPlayer: CombatActor;
  virtualDurationMs: number;
}

function validateInput(input: ExpeditionSimulationInput): void {
  if (!input.sessionId.trim() || !input.expedition.id.trim()) {
    throw new Error('Expedition and session identifiers cannot be empty.');
  }
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new Error('Expedition duration must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error('Expedition seed must be a non-negative safe integer.');
  }
  if (
    !Number.isSafeInteger(input.expedition.spawnIntervalMs) ||
    input.expedition.spawnIntervalMs <= 0
  ) {
    throw new Error('Expedition spawn interval must be a positive safe integer.');
  }
  if (
    !Number.isFinite(input.expedition.deathRewardRetention) ||
    input.expedition.deathRewardRetention < 0 ||
    input.expedition.deathRewardRetention > 1
  ) {
    throw new Error('Expedition death reward retention must be between zero and one.');
  }
  if (input.expedition.encounters.length === 0) {
    throw new Error('Expedition needs at least one encounter entry.');
  }
  const enemyIds = new Set(input.enemies.map((enemy) => enemy.id));
  const lootIds = new Set(input.lootTables.map((table) => table.id));
  for (const encounter of input.expedition.encounters) {
    if (
      !encounter.id.trim() ||
      !enemyIds.has(encounter.enemyId) ||
      !Number.isSafeInteger(encounter.weight) ||
      encounter.weight <= 0
    ) {
      throw new Error(`Invalid expedition encounter: ${encounter.id}.`);
    }
    if (
      encounter.count !== undefined &&
      (!Number.isSafeInteger(encounter.count) || encounter.count <= 0)
    ) {
      throw new Error(`Invalid encounter count: ${encounter.id}.`);
    }
  }
  for (const enemy of input.enemies) {
    if (enemy.lootTableId && !lootIds.has(enemy.lootTableId)) {
      throw new Error(`Enemy ${enemy.id} references missing loot table ${enemy.lootTableId}.`);
    }
  }
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function chooseEncounter(
  expedition: ExpeditionDefinition,
  random: () => number,
): ExpeditionDefinition['encounters'][number] {
  const totalWeight = expedition.encounters.reduce(
    (total, encounter) => total + encounter.weight,
    0,
  );
  const draw = random() * totalWeight;
  let weight = 0;
  for (const encounter of expedition.encounters) {
    weight += encounter.weight;
    if (draw < weight) {
      return encounter;
    }
  }
  return expedition.encounters.at(-1)!;
}

function toEnemyActor(
  definition: EnemyDefinition,
  encounterId: string,
  index: number,
  variantId?: string,
): CombatActor {
  return {
    ...definition,
    id: `${encounterId}:enemy:${index}`,
    name: variantId ? `${definition.name} · ${variantId}` : definition.name,
    speciesId: definition.id,
    tags: [...definition.tags],
    side: 'enemy',
    state: 'ready',
    nextEventAt: 0,
    position: { ...definition.position },
  };
}

export function fightToWinner(initial: CombatState): CombatState {
  let state = initial;
  while (!state.winner) {
    const nextEvent = state.actors
      .filter((actor) => actor.state === 'alive')
      .map((actor) => actor.nextEventAt)
      .sort((left, right) => left - right)[0];
    if (nextEvent === undefined || !Number.isSafeInteger(nextEvent) || nextEvent < state.nowMs) {
      throw new Error(`Combat ${state.id} has no valid next event.`);
    }
    state = advanceCombat(state, nextEvent);
  }
  return state;
}

function restoreAfterDeath(actor: CombatActor, template: CombatActor): CombatActor {
  return {
    ...actor,
    hp: { ...template.hp },
    tenacity: { ...template.tenacity },
    energy: { ...template.energy },
    effects: [],
    state: 'ready',
    nextEventAt: 0,
  };
}

export function simulateExpedition(input: ExpeditionSimulationInput): ExpeditionSimulationResult {
  validateInput(input);
  const enemies = new Map(input.enemies.map((enemy) => [enemy.id, enemy]));
  const lootTables = new Map(input.lootTables.map((table) => [table.id, table]));
  const random = randomSource(input.seed);
  const playerTemplate: CombatActor = {
    ...input.player,
    hp: { ...input.player.hp },
    tenacity: { ...input.player.tenacity },
    energy: { ...input.player.energy },
  };
  let player: CombatActor = { ...playerTemplate, side: 'party', state: 'ready', nextEventAt: 0 };
  let elapsed = 0;
  let kills = 0;
  let deaths = 0;
  let experience = 0;
  let killNumber = 0;
  const drops: LootDrop[] = [];
  const unlockedNodeIds = new Set(
    input.expedition.activityKind === 'dungeon' || input.expedition.activityKind === 'raid'
      ? (input.expedition.nodeUnlocks ?? [])
      : [],
  );
  const combats: CombatState[] = [];

  while (elapsed < input.durationMs) {
    const entry = chooseEncounter(input.expedition, random);
    const enemy = enemies.get(entry.enemyId)!;
    const count = entry.count ?? 1;
    const encounterId = `${input.sessionId}:combat:${combats.length + 1}`;
    const actors = [
      player,
      ...Array.from({ length: count }, (_, index) =>
        toEnemyActor(enemy, encounterId, index + 1, entry.variantId ?? enemy.variantId),
      ),
    ];
    const combat = fightToWinner(
      createCombatState(
        encounterId,
        actors,
        Math.floor(random() * 0x1_0000_0000),
        input.expedition.environment,
        input.tagRegistry,
      ),
    );
    combats.push(combat);
    const playerAfterFight = combat.actors.find((actor) => actor.id === player.id)!;
    if (playerAfterFight.state === 'dead') {
      deaths += 1;
      player = restoreAfterDeath(playerAfterFight, playerTemplate);
    } else {
      player = { ...playerAfterFight, state: 'ready', nextEventAt: 0, effects: [] };
    }

    const deadEnemies = combat.actors.filter(
      (actor) => actor.side === 'enemy' && actor.state === 'dead',
    );
    for (const dead of deadEnemies) {
      const definition = enemies.get(dead.speciesId)!;
      kills += 1;
      experience += definition.experience;
      if (!Number.isSafeInteger(experience)) {
        throw new Error('Expedition experience exceeds the safe integer range.');
      }
      if (!definition.lootTableId) {
        continue;
      }
      const table = lootTables.get(definition.lootTableId)!;
      const context: LootContext = {
        enemyId: definition.id,
        tags: definition.tags,
        activityKind: input.expedition.activityKind,
        deathCause: dead.lastDamageChannel,
        environment: input.expedition.environment as Record<string, string | undefined>,
      };
      const rolled = rollLoot(
        table,
        context,
        Math.floor(random() * 0x1_0000_0000),
        `${input.sessionId}:kill:${++killNumber}`,
      );
      drops.push(...rolled.drops);
      if (input.expedition.activityKind === 'dungeon' || input.expedition.activityKind === 'raid') {
        rolled.unlockedNodeIds.forEach((nodeId) => unlockedNodeIds.add(nodeId));
      }
    }
    const elapsedCombat = combat.nowMs;
    elapsed += Math.max(input.expedition.spawnIntervalMs, elapsedCombat);
    if (!Number.isSafeInteger(elapsed)) {
      throw new Error('Expedition virtual duration exceeds the safe integer range.');
    }
  }

  const retention = deaths > 0 ? input.expedition.deathRewardRetention : 1;
  const adjustedExperience = Math.floor(experience * retention);
  const adjustedDrops = drops
    .map((drop) => ({ ...drop, quantity: Math.floor(drop.quantity * retention) }))
    .filter((drop) => drop.quantity > 0);
  return {
    kills,
    deaths,
    experience: adjustedExperience,
    drops: adjustedDrops,
    unlockedNodeIds: [...unlockedNodeIds].sort(),
    combats,
    nextPlayer: player,
    virtualDurationMs: elapsed,
  };
}
