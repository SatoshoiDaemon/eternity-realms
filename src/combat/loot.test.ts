import { describe, expect, it } from 'vitest';
import { chooseWeighted, rollLoot, type LootTable } from './loot';

const context = {
  enemyId: 'core:golem',
  tags: ['base:construct', 'base:mineral'],
  activityKind: 'dungeon' as const,
  deathCause: 'crushing',
  environment: { type: 'cavern' },
};

describe('declarative loot rolls', () => {
  it('combines guaranteed, independent, exclusive, and conditional drops with stable ids', () => {
    const table: LootTable = {
      id: 'core:golem-loot',
      guaranteed: [{ itemId: 'iron-ore', quantity: 2 }],
      independent: [{ itemId: 'gold', quantity: 1, chance: 1 }],
      exclusive: [
        {
          id: 'ore-pool',
          rolls: 1,
          entries: [
            { itemId: 'mithril', quantity: 1, weight: 1 },
            { itemId: 'adamantite', quantity: 1, weight: 3 },
          ],
        },
      ],
      conditional: [
        {
          id: 'crushing-golem',
          when: [
            { kind: 'tag', value: 'base:construct' },
            { kind: 'death_cause', value: 'crushing' },
          ],
          drops: [{ itemId: 'core:node-impact', quantity: 1 }],
          unlockNodeIds: ['core:node-impact'],
        },
      ],
    };
    const first = rollLoot(table, context, 42, 'run-1:kill-1');
    expect(rollLoot(table, context, 42, 'run-1:kill-1')).toEqual(first);
    expect(first.drops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'iron-ore',
          quantity: 2,
          rewardId: 'run-1:kill-1:core:golem-loot:guaranteed:0',
        }),
        expect.objectContaining({ itemId: 'gold', quantity: 1 }),
        expect.objectContaining({ itemId: 'core:node-impact', quantity: 1 }),
      ]),
    );
    expect(
      first.drops.filter((drop) => ['mithril', 'adamantite'].includes(drop.itemId)),
    ).toHaveLength(1);
    expect(first.unlockedNodeIds).toEqual(['core:node-impact']);
    expect(new Set(first.drops.map((drop) => drop.rewardId)).size).toBe(first.drops.length);
  });

  it('respects failed conditions and independent probability boundaries', () => {
    const table: LootTable = {
      id: 'core:rare',
      independent: [{ itemId: 'rare', quantity: 1, chance: 0 }],
      conditional: [
        {
          id: 'wrong-target',
          when: [{ kind: 'enemy_id', value: 'core:dragon' }],
          drops: [{ itemId: 'dragon-scale', quantity: 1 }],
        },
      ],
    };
    expect(rollLoot(table, context, 7, 'kill-2')).toEqual({ drops: [], unlockedNodeIds: [] });
  });

  it('validates loot identifiers, quantities, probabilities, weights, and roll counts', () => {
    const base: LootTable = { id: 'core:valid' };
    expect(() =>
      rollLoot(
        { ...base, independent: [{ itemId: '', quantity: 1, chance: 0.5 }] },
        context,
        1,
        'kill',
      ),
    ).toThrow();
    expect(() =>
      rollLoot({ ...base, guaranteed: [{ itemId: 'ore', quantity: 0 }] }, context, 1, 'kill'),
    ).toThrow();
    expect(() =>
      rollLoot(
        { ...base, independent: [{ itemId: 'ore', quantity: 1, chance: 2 }] },
        context,
        1,
        'kill',
      ),
    ).toThrow();
    expect(() =>
      rollLoot(
        {
          ...base,
          exclusive: [
            { id: 'bad', rolls: 1, entries: [{ itemId: 'ore', quantity: 1, weight: 0 }] },
          ],
        },
        context,
        1,
        'kill',
      ),
    ).toThrow();
    expect(() =>
      rollLoot({ ...base, exclusive: [{ id: 'bad', rolls: -1, entries: [] }] }, context, 1, 'kill'),
    ).toThrow();
    expect(() => rollLoot(base, context, -1, 'kill')).toThrow();
    expect(() => rollLoot(base, context, 1, ' ')).toThrow(
      'Loot table and reward identifiers cannot be empty.',
    );
    expect(() => rollLoot({ id: ' ' }, context, 1, 'kill')).toThrow(
      'Loot table and reward identifiers cannot be empty.',
    );
    expect(() =>
      rollLoot(
        { ...base, exclusive: [{ id: ' ', rolls: 0, entries: [{ itemId: 'ore', quantity: 1 }] }] },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid exclusive loot pool');
    expect(() =>
      rollLoot(
        {
          ...base,
          exclusive: [{ id: 'pool', rolls: 0.5, entries: [{ itemId: 'ore', quantity: 1 }] }],
        },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid exclusive loot pool');
    expect(() =>
      rollLoot({ ...base, exclusive: [{ id: 'pool', rolls: 0, entries: [] }] }, context, 1, 'kill'),
    ).toThrow('Invalid exclusive loot pool');
    expect(() =>
      rollLoot({ ...base, conditional: [{ id: ' ', when: [], drops: [] }] }, context, 1, 'kill'),
    ).toThrow('Invalid conditional loot id');
    expect(() =>
      rollLoot(
        {
          ...base,
          conditional: [{ id: 'bad-drop', when: [], drops: [{ itemId: 'ore', quantity: 0 }] }],
        },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid loot entry');
  });

  it('matches every supported conditional context and merges permanent unlocks', () => {
    const table: LootTable = {
      id: 'core:conditions',
      unlockNodeIds: ['core:base'],
      conditional: [
        {
          id: 'tag',
          when: [{ kind: 'tag', value: 'base:construct' }],
          drops: [{ itemId: 'tag-drop', quantity: 1 }],
        },
        {
          id: 'enemy',
          when: [{ kind: 'enemy_id', value: 'core:golem' }],
          drops: [{ itemId: 'enemy-drop', quantity: 1 }],
        },
        {
          id: 'death',
          when: [{ kind: 'death_cause', value: 'crushing' }],
          drops: [{ itemId: 'death-drop', quantity: 1 }],
        },
        {
          id: 'activity',
          when: [{ kind: 'activity_kind', value: 'dungeon' }],
          drops: [{ itemId: 'activity-drop', quantity: 1 }],
        },
        {
          id: 'environment',
          when: [{ kind: 'environment', key: 'type', value: 'cavern' }],
          drops: [{ itemId: 'environment-drop', quantity: 1 }],
          unlockNodeIds: ['core:dungeon'],
        },
        {
          id: 'missing',
          when: [{ kind: 'environment', key: 'missing', value: 'yes' }],
          drops: [{ itemId: 'not-dropped', quantity: 1 }],
        },
      ],
    };
    const result = rollLoot(table, context, 3, 'run');
    expect(result.drops.map(({ itemId }) => itemId)).toEqual([
      'tag-drop',
      'enemy-drop',
      'death-drop',
      'activity-drop',
      'environment-drop',
    ]);
    expect(result.unlockedNodeIds).toEqual(['core:base', 'core:dungeon']);
  });

  it('keeps weighted selection total at its final entry for a boundary draw', () => {
    const entries = [
      { itemId: 'first', quantity: 1, weight: 1 },
      { itemId: 'last', quantity: 1, weight: 1 },
    ];
    expect(chooseWeighted(entries, () => 1)).toEqual(entries[1]);
    expect(
      rollLoot(
        { id: 'core:zero-seed', exclusive: [{ id: 'pool', rolls: 1, entries }] },
        context,
        0,
        'zero',
      ).drops,
    ).toHaveLength(1);
  });

  it('defaults omitted exclusive weights to one during selection', () => {
    const entries = [
      { itemId: 'first', quantity: 1 },
      { itemId: 'second', quantity: 1 },
    ];
    expect(chooseWeighted(entries, () => 0.75)).toEqual(entries[1]);
  });

  it('validates every entry in guaranteed, independent, exclusive, and conditional tables', () => {
    const base: LootTable = { id: 'core:bad-entries' };
    expect(() =>
      rollLoot({ ...base, guaranteed: [{ itemId: 'ore', quantity: 1.5 }] }, context, 1, 'kill'),
    ).toThrow('Invalid loot entry');
    expect(() =>
      rollLoot(
        { ...base, independent: [{ itemId: 'ore', quantity: 1, chance: Number.NaN }] },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid loot chance');
    expect(() =>
      rollLoot(
        { ...base, exclusive: [{ id: 'pool', rolls: 1, entries: [{ itemId: '', quantity: 1 }] }] },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid loot entry');
    expect(() =>
      rollLoot(
        {
          ...base,
          conditional: [{ id: 'ok', when: [], drops: [{ itemId: 'ore', quantity: 1.1 }] }],
        },
        context,
        1,
        'kill',
      ),
    ).toThrow('Invalid loot entry');
  });
});
