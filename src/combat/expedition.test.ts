import { describe, expect, it } from 'vitest';
import {
  chooseEncounter,
  fightToWinner,
  simulateExpedition,
  type EnemyDefinition,
  type ExpeditionDefinition,
} from './expedition';
import { createCombatState } from './combat-engine';
import type { CombatActor, CombatAction } from './types';
import type { LootTable } from './loot';

const strike: CombatAction = {
  id: 'base:strike',
  name: 'Strike',
  kind: 'attack',
  target: 'enemy',
  intervalMs: 1_000,
  accuracy: 1,
  damage: {
    amount: 100,
    channel: 'physical',
    subtype: 'crushing',
    properties: [],
    origin: { kind: 'ability', id: 'base:strike' },
  },
};

const player: CombatActor = {
  id: 'player',
  name: 'Hero',
  speciesId: 'player:hero',
  tags: [],
  side: 'party',
  attributes: { vigor: 10, resistance: 10, speed: 10, dexterity: 10, precision: 10, strength: 10 },
  hp: { current: 100, maximum: 100 },
  tenacity: { current: 0, maximum: 0 },
  energy: {},
  equipment: [],
  actions: [strike],
  effects: [],
  policy: { id: 'base:default', rules: [] },
  actionPriority: [strike.id],
  mitigation: { physical: 0, magical: 0 },
  position: { x: 0, y: 0 },
  nextEventAt: 0,
  state: 'ready',
};

const enemy: EnemyDefinition = {
  id: 'core:training-golem',
  name: 'Training Golem',
  tags: ['base:construct', 'base:mineral', 'base:armored'],
  attributes: { vigor: 1, resistance: 1, speed: 1, dexterity: 1, precision: 1, strength: 1 },
  hp: { current: 50, maximum: 50 },
  tenacity: { current: 0, maximum: 0 },
  energy: {},
  equipment: [],
  actions: [],
  effects: [],
  policy: { id: 'base:idle', rules: [] },
  actionPriority: [],
  mitigation: { physical: 0, magical: 0 },
  position: { x: 1, y: 0 },
  lootTableId: 'core:golem-loot',
  experience: 7,
};

const expedition: ExpeditionDefinition = {
  id: 'core:cavern',
  activityKind: 'dungeon',
  spawnIntervalMs: 60_000,
  deathRewardRetention: 0.25,
  environment: { type: 'cavern', condition: 'fertile' },
  encounters: [{ id: 'golems', enemyId: enemy.id, weight: 1 }],
};

const lootTables: LootTable[] = [
  { id: 'core:golem-loot', guaranteed: [{ itemId: 'iron-ore', quantity: 2 }] },
];

describe('expedition combat integration', () => {
  it('simulates spawn cadence through the combat engine and creates per-kill loot and XP', () => {
    const result = simulateExpedition({
      sessionId: 'session-1',
      player,
      expedition,
      enemies: [enemy],
      lootTables,
      durationMs: 120_000,
      seed: 15,
    });

    expect(result.kills).toBe(2);
    expect(result.deaths).toBe(0);
    expect(result.experience).toBe(14);
    expect(result.drops.map((drop) => [drop.itemId, drop.quantity])).toEqual([
      ['iron-ore', 2],
      ['iron-ore', 2],
    ]);
    expect(result.drops[0]?.rewardId).not.toBe(result.drops[1]?.rewardId);
    expect(result.combats).toHaveLength(2);
    expect(
      result.combats[0]?.log[0]?.tagInteractions.some((entry) => entry.tagId === 'base:construct'),
    ).toBe(true);
  });

  it('applies the configured death retention to XP and material quantities and restores the player', () => {
    const lethal: EnemyDefinition = {
      ...enemy,
      actions: [
        {
          ...strike,
          id: 'base:lethal',
          name: 'Lethal',
          damage: { ...strike.damage!, amount: 1_000 },
        },
      ],
      actionPriority: ['base:lethal'],
      experience: 10,
    };
    const nonFightingPlayer = {
      ...player,
      id: '0-player',
      actions: [strike],
      actionPriority: [strike.id],
    };
    const result = simulateExpedition({
      sessionId: 'session-death',
      player: nonFightingPlayer,
      expedition: {
        ...expedition,
        encounters: [{ id: 'lethal', enemyId: lethal.id, weight: 1, count: 2 }],
      },
      enemies: [lethal],
      lootTables,
      durationMs: 1,
      seed: 5,
    });

    expect(result.deaths).toBe(1);
    expect(result.experience).toBe(2);
    expect(result.drops).toHaveLength(0);
    expect(result.combats[0]?.actors.find((actor) => actor.id === '0-player')?.state).toBe('dead');
    expect(result.nextPlayer).toMatchObject({ hp: { current: 100, maximum: 100 }, state: 'ready' });
  });

  it('validates the expedition schedule, references, retention, and run identifiers', () => {
    const input = {
      sessionId: 'bad',
      player,
      expedition,
      enemies: [enemy],
      lootTables,
      durationMs: 10,
      seed: 1,
    };
    expect(() => simulateExpedition({ ...input, durationMs: 0 })).toThrow();
    expect(() => simulateExpedition({ ...input, seed: -1 })).toThrow();
    expect(() => simulateExpedition({ ...input, sessionId: ' ' })).toThrow();
    expect(() => simulateExpedition({ ...input, enemies: [] })).toThrow();
    expect(() =>
      simulateExpedition({ ...input, expedition: { ...expedition, spawnIntervalMs: 0 } }),
    ).toThrow();
    expect(() =>
      simulateExpedition({ ...input, expedition: { ...expedition, deathRewardRetention: 1.5 } }),
    ).toThrow();
    expect(() =>
      simulateExpedition({
        ...input,
        expedition: { ...expedition, encounters: [{ id: 'missing', enemyId: 'none', weight: 1 }] },
      }),
    ).toThrow();
    expect(() =>
      simulateExpedition({
        ...input,
        expedition: {
          ...expedition,
          encounters: [{ id: 'zero-count', enemyId: enemy.id, weight: 1, count: 0 }],
        },
      }),
    ).toThrow('Invalid encounter count');
    expect(() =>
      simulateExpedition({ ...input, expedition: { ...expedition, encounters: [] } }),
    ).toThrow('at least one encounter');
    expect(() => simulateExpedition({ ...input, lootTables: [] })).toThrow(
      'references missing loot table',
    );
  });

  it('supports deterministic encounter boundaries, variants, node unlocks, and enemies without loot', () => {
    expect(
      chooseEncounter(
        {
          ...expedition,
          encounters: [
            { id: 'first', enemyId: enemy.id, weight: 1 },
            { id: 'last', enemyId: enemy.id, weight: 1 },
          ],
        },
        () => 1,
      ).id,
    ).toBe('last');
    const noLoot = { ...enemy, lootTableId: undefined, variantId: 'Elite' };
    const dungeon = {
      ...expedition,
      nodeUnlocks: undefined,
      encounters: [{ id: 'variant', enemyId: noLoot.id, weight: 1, variantId: 'Ascended' }],
    };
    const result = simulateExpedition({
      sessionId: 'variant-run',
      player,
      expedition: dungeon,
      enemies: [noLoot],
      lootTables,
      durationMs: 1,
      seed: 0,
    });
    expect(result.kills).toBe(1);
    expect(result.drops).toEqual([]);
    expect(result.combats[0]?.actors.find((actor) => actor.side === 'enemy')?.name).toBe(
      'Training Golem · Ascended',
    );

    const quest = simulateExpedition({
      sessionId: 'quest-run',
      player,
      expedition: { ...expedition, activityKind: 'quest', nodeUnlocks: ['core:must-not-unlock'] },
      enemies: [enemy],
      lootTables: [{ ...lootTables[0]!, unlockNodeIds: ['core:loot-node'] }],
      durationMs: 1,
      seed: 1,
    });
    expect(quest.unlockedNodeIds).toEqual([]);
    const raid = simulateExpedition({
      sessionId: 'raid-run',
      player,
      expedition: {
        ...expedition,
        activityKind: 'raid',
        nodeUnlocks: ['core:raid-boss-node'],
      },
      enemies: [enemy],
      lootTables: [{ ...lootTables[0]!, unlockNodeIds: ['core:loot-node'] }],
      durationMs: 1,
      seed: 1,
    });
    expect(raid.unlockedNodeIds).toEqual(['core:loot-node', 'core:raid-boss-node']);
  });

  it('rejects combats without a valid next event', () => {
    const state = createCombatState(
      'bad-schedule',
      [
        player,
        {
          ...enemy,
          id: enemy.id,
          speciesId: enemy.id,
          side: 'enemy',
          state: 'ready',
          nextEventAt: 0,
        },
      ],
      2,
    );
    state.actors.forEach((actor) => {
      actor.nextEventAt = Number.NaN;
    });
    expect(() => fightToWinner(state)).toThrow('has no valid next event');
  });

  it('rejects accumulated experience outside safe integer bounds', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const longLived = { ...enemy, experience: max };
    expect(() =>
      simulateExpedition({
        sessionId: 'xp-overflow',
        player,
        expedition: {
          ...expedition,
          encounters: [{ id: 'pair', enemyId: enemy.id, weight: 1, count: 2 }],
        },
        enemies: [longLived],
        lootTables,
        durationMs: 1,
        seed: 2,
      }),
    ).toThrow('experience exceeds');
  });

  it('rejects accumulated virtual duration outside safe integer bounds', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(() =>
      simulateExpedition({
        sessionId: 'time-overflow',
        player,
        expedition: { ...expedition, spawnIntervalMs: max - 1 },
        enemies: [enemy],
        lootTables,
        durationMs: max,
        seed: 2,
      }),
    ).toThrow('virtual duration exceeds');
  });
});
