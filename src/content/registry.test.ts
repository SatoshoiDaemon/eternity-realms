import { describe, expect, it } from 'vitest';
import { loadContentPacks, loadOfficialContent } from './registry';
import { testPack } from '../test/fixtures';

describe('declarative content registry', () => {
  it('loads official content through the same validation pipeline as external packs', () => {
    const official = loadOfficialContent();

    expect(official.races.get('human')?.name).toBe('Humano');
    expect(official.activities.get('mining')?.rewardId).toBe('mining-iron');
    expect(official.activities.get('foraging')?.rewardId).toBe('foraging-herbs');
    expect(official.rewards.get('mining-iron')?.items[0]?.itemId).toBe('iron-ore');
    expect(official.rewards.get('foraging-herbs')?.items[0]?.itemId).toBe('wild-herb');
    expect(official.items.has('iron-ore')).toBe(true);
    expect(official.skills.has('mining-skill')).toBe(true);
    expect(official.effects.has('focused-work')).toBe(true);
    expect(official.enemies.has('core:iron-sentinel')).toBe(true);
    expect(official.expeditions.get('core:lost-foundry')?.encounters.length).toBeGreaterThan(4);
    expect(official.expeditions.get('core:ashen-raid')?.activityKind).toBe('raid');
    expect(official.activities.get('ashen-raid')?.expeditionId).toBe('core:ashen-raid');
    expect(official.lootTables.has('core:construct-drops')).toBe(true);
    expect(official.activities.get('lost-foundry')?.expeditionId).toBe('core:lost-foundry');
    expect(official.enemyTags.size).toBe(52);
    expect(official.nodes.map((node) => node.id)).toContain('core:effect-damage');
    expect(official.glyphs).toHaveLength(4);
    expect(official.sigils).toHaveLength(3);
    expect(official.rules.experiencePerLevel).toBe(80);
  });

  it('loads combat content from mods and validates encounter, loot, activity, and tag references', () => {
    const modPack = {
      ...testPack,
      manifest: { id: 'test.combat', name: 'Combat Test', version: '1.0.0' },
      records: [
        ...testPack.records,
        {
          id: 'mod:charged',
          kind: 'enemy_tag',
          category: 'affinity',
          name: 'Charged',
          description: '',
          origin: 'test',
          activationConditions: [],
          eventsObserved: ['action.select'],
          modifiers: [
            {
              id: 'charge',
              event: 'action.select',
              conditions: [],
              interactionId: 'test:charge',
              potency: 1,
              priority: 1,
              effect: { type: 'policy_bias', value: { actionKinds: ['magic'], bonus: 1 } },
            },
          ],
          interactions: [],
          requirements: [],
          properties: [],
        },
        {
          id: 'mod:loot',
          kind: 'loot_table',
          name: 'Mod Loot',
          description: '',
          guaranteed: [{ itemId: 'iron-ore', quantity: 1 }],
        },
        {
          id: 'mod:enemy',
          kind: 'enemy',
          name: 'Mod Enemy',
          description: '',
          tags: ['mod:charged'],
          lootTableId: 'mod:loot',
          experience: 2,
          attributes: {
            vigor: 1,
            resistance: 1,
            speed: 10,
            dexterity: 1,
            precision: 1,
            strength: 1,
          },
          hp: { current: 5, maximum: 5 },
          tenacity: { current: 0, maximum: 0 },
          energy: {},
          equipment: [],
          actions: [],
          effects: [],
          policy: { id: 'mod:idle', rules: [] },
          actionPriority: [],
          mitigation: { physical: 0, magical: 0 },
          position: { x: 1, y: 0 },
        },
        {
          id: 'mod:expedition',
          kind: 'expedition',
          name: 'Mod Dungeon',
          description: '',
          activityKind: 'dungeon',
          spawnIntervalMs: 1000,
          deathRewardRetention: 0.25,
          environment: {},
          encounters: [{ id: 'entry', enemyId: 'mod:enemy', weight: 1 }],
        },
      ],
    };
    const loaded = loadContentPacks([modPack]);
    expect(loaded.enemyTags.has('mod:charged')).toBe(true);
    expect(loaded.enemies.get('mod:enemy')?.tags).toEqual(['mod:charged']);
    expect(loaded.expeditions.get('mod:expedition')?.encounters[0]?.enemyId).toBe('mod:enemy');
    expect(loaded.lootTables.has('mod:loot')).toBe(true);

    expect(() =>
      loadContentPacks([
        {
          ...modPack,
          records: modPack.records.map((record) =>
            record.id === 'mod:expedition'
              ? { ...record, encounters: [{ id: 'entry', enemyId: 'missing', weight: 1 }] }
              : record,
          ),
        },
      ]),
    ).toThrow('Expedition "mod:expedition" references missing enemy "missing".');
    expect(() =>
      loadContentPacks([
        {
          ...modPack,
          records: modPack.records.map((record) =>
            record.id === 'mod:enemy' ? { ...record, lootTableId: 'missing' } : record,
          ),
        },
      ]),
    ).toThrow('Enemy "mod:enemy" references missing loot table "missing".');
    expect(() =>
      loadContentPacks([
        {
          ...modPack,
          records: modPack.records.map((record) =>
            record.id === 'mod:enemy' ? { ...record, tags: ['mod:missing'] } : record,
          ),
        },
      ]),
    ).toThrow('Enemy "mod:enemy" references missing tag "mod:missing".');
    expect(() =>
      loadContentPacks([
        {
          ...modPack,
          records: modPack.records.map((record) =>
            record.id === 'mining' ? { ...record, expeditionId: 'missing' } : record,
          ),
        },
      ]),
    ).toThrow('Activity "mining" references missing expedition "missing".');
  });

  it('loads mod nodes, Glyphs, and Sigils through the same declarative registry', () => {
    const loaded = loadContentPacks([
      {
        ...testPack,
        manifest: { id: 'mod.nodes', name: 'Mod Nodes', version: '1.0.0' },
        nodes: [{ id: 'mod:source', name: 'Mod Source', category: 'source' }],
        glyphs: [
          { id: 'mod:glyph', name: 'Mod Glyph', operation: { kind: 'property', value: 'modded' } },
        ],
        sigils: [
          {
            id: 'mod:sigil',
            name: 'Mod Sigil',
            operation: { kind: 'property', value: 'modded-sigil' },
          },
        ],
      },
    ]);
    expect(loaded.nodes.find((node) => node.id === 'mod:source')?.category).toBe('source');
    expect(loaded.glyphs.some((glyph) => glyph.id === 'mod:glyph')).toBe(true);
    expect(loaded.sigils.some((sigil) => sigil.id === 'mod:sigil')).toBe(true);
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          manifest: { id: 'mod.invalid-node', name: 'Invalid Node', version: '1.0.0' },
          nodes: [{}],
        },
      ]),
    ).toThrow('Node id must include a namespace: <unknown>.');
  });

  it('allows a later content pack to override an id deliberately', () => {
    const override = {
      ...testPack,
      manifest: { id: 'test.override', name: 'Override', version: '1.0.0' },
      records: [
        {
          id: 'iron-ore',
          kind: 'item',
          name: 'Rich Iron Ore',
          description: 'Modded.',
          stackable: true,
        },
      ],
    };

    expect(loadContentPacks([testPack, override]).items.get('iron-ore')?.name).toBe(
      'Rich Iron Ore',
    );
  });

  it('rejects malformed packs, duplicate ids inside one pack, and unresolved references', () => {
    expect(() => loadContentPacks([{}])).toThrow();
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: [...testPack.records, testPack.records[0]],
        },
      ]),
    ).toThrow('Duplicate content id in pack: human');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.filter((record) => record.id !== 'mining-reward'),
        },
      ]),
    ).toThrow('Activity "mining" references missing reward "mining-reward".');
    expect(() => loadContentPacks([testPack, testPack])).toThrow(
      'Duplicate content pack id: test.core',
    );
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: [
            ...testPack.records,
            {
              id: 'missing-result-recipe',
              kind: 'recipe',
              name: 'Bad recipe',
              description: '',
              inputs: {},
              resultItemId: 'missing-result',
            },
          ],
        },
      ]),
    ).toThrow('Recipe "missing-result-recipe" references missing result item "missing-result".');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: [
            ...testPack.records,
            {
              id: 'missing-input-recipe',
              kind: 'recipe',
              name: 'Bad recipe',
              description: '',
              inputs: { 'missing-input': 1 },
              resultItemId: 'iron-ore',
            },
          ],
        },
      ]),
    ).toThrow('Recipe "missing-input-recipe" references missing input item "missing-input".');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.map((record) =>
            record.id === 'mining-reward' && record.kind === 'reward'
              ? { ...record, items: [{ itemId: 'missing-item', quantity: 1 }] }
              : record,
          ),
        },
      ]),
    ).toThrow('Reward "mining-reward" references missing item "missing-item".');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: testPack.records.map((record) =>
            record.id === 'mining-skill' && record.kind === 'skill'
              ? { ...record, activityIds: ['missing-activity'] }
              : record,
          ),
        },
      ]),
    ).toThrow('Skill "mining-skill" references missing activity "missing-activity".');
  });
});
