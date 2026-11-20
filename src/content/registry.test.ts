import { describe, expect, it } from 'vitest';
import { loadContentPacks, loadOfficialContent } from './registry';
import { testPack } from '../test/fixtures';

describe('declarative content registry', () => {
  it('loads official content through the same validation pipeline as external packs', () => {
    const official = loadOfficialContent();

    expect(official.races.size).toBe(29);
    expect(official.regions.size).toBe(9);
    expect(official.skills.size).toBeGreaterThanOrEqual(16);
    expect(official.races.get('human')?.name).toBe('Humano');
    expect(official.activities.get('mining')?.rewardId).toBe('mining-iron');
    expect(official.activities.get('foraging')?.rewardId).toBe('foraging-herbs');
    expect(official.rewards.get('mining-iron')?.items[0]?.itemId).toBe('iron-ore');
    expect(official.rewards.get('foraging-herbs')?.items[0]?.itemId).toBe('wild-herb');
    expect(official.items.has('iron-ore')).toBe(true);
    expect(official.skills.has('mining-skill')).toBe(true);
    expect(official.missions.get('first-steps')?.cadence).toBe('main');
    expect(official.missions.get('daily-routine')?.target).toBe(3);
    expect(official.effects.has('focused-work')).toBe(true);
    expect(official.enemies.has('core:iron-sentinel')).toBe(true);
    expect(official.expeditions.get('core:lost-foundry')?.encounters.length).toBeGreaterThan(4);
    expect(official.expeditions.get('core:ashen-raid')?.activityKind).toBe('raid');
    expect(official.activities.get('ashen-raid')?.expeditionId).toBe('core:ashen-raid');
    expect(official.lootTables.has('core:construct-drops')).toBe(true);
    expect(official.activities.get('lost-foundry')?.expeditionId).toBe('core:lost-foundry');
    expect(
      official.systems
        .get('system:alchemy')
        ?.entries.filter(
          (entry) => typeof entry.id === 'string' && entry.id.startsWith('implant-'),
        ),
    ).toHaveLength(20);
    expect(official.items.has('alchemical-implant-20')).toBe(true);
    expect(official.enemyTags.size).toBeGreaterThan(52);
    expect(official.nodes.map((node) => node.id)).toContain('core:effect-damage');
    expect(official.glyphs).toHaveLength(4);
    expect(official.sigils).toHaveLength(3);
    expect(official.rules.experiencePerLevel).toBe(80);
  });

  it('loads regions, shops, and energy systems from mod packs and validates their references', () => {
    const region = {
      id: 'mod:tidal-coast',
      kind: 'region',
      name: 'Costa das Marés',
      description: 'Uma costa de teste.',
      terrain: ['coast'],
      climate: ['temperate'],
      localities: ['Porto de Teste'],
      materials: ['iron-ore'],
      enemies: [],
      expeditionIds: [],
      activityIds: ['mining'],
      unlockRequirements: { level: 1 },
    };
    const shop = {
      id: 'mod:tidal-market',
      kind: 'shop',
      name: 'Mercado da Costa',
      description: 'Loja de teste.',
      cadence: 'permanent',
      entries: [{ itemId: 'iron-ore', currency: 'fragments', price: 2, stock: -1 }],
    };
    const energy = {
      id: 'mod:condensed-aura',
      kind: 'energy',
      name: 'Aura Condensada',
      description: 'Energia de teste.',
      origin: 'Kho',
      resources: ['chi', 'aura'],
      progression: [],
    };
    const loaded = loadContentPacks([
      {
        ...testPack,
        manifest: { id: 'test.phase-four', name: 'Phase Four Test', version: '1.0.0' },
        records: [...testPack.records, region, shop, energy],
      },
    ]);

    expect(loaded.regions.get('mod:tidal-coast')?.localities).toContain('Porto de Teste');
    expect(loaded.shops.get('mod:tidal-market')?.entries[0]?.itemId).toBe('iron-ore');
    expect(loaded.energies.get('mod:condensed-aura')?.origin).toBe('Kho');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          manifest: { id: 'test.bad-region', name: 'Bad Region', version: '1.0.0' },
          records: [...testPack.records, { ...region, activityIds: ['missing-activity'] }],
        },
      ]),
    ).toThrow('Region "mod:tidal-coast" references missing activity "missing-activity".');
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          manifest: { id: 'test.bad-shop', name: 'Bad Shop', version: '1.0.0' },
          records: [
            ...testPack.records,
            { ...shop, entries: [{ ...shop.entries[0], itemId: 'missing-item' }] },
          ],
        },
      ]),
    ).toThrow('Shop "mod:tidal-market" references missing item "missing-item".');
  });

  it('validates alchemical implant device references and surgery costs', () => {
    const system = {
      id: 'mod:alchemy',
      kind: 'system',
      name: 'Alchemy',
      description: 'System test.',
      systemType: 'alchemy',
      entries: [
        {
          id: 'implant-test',
          name: 'Implant test',
          charge: 1,
          deviceItemId: 'missing-device',
          installationCostFragments: 10_000,
        },
      ],
    };
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          manifest: { id: 'test.bad-implant', name: 'Bad Implant', version: '1.0.0' },
          records: [...testPack.records, system],
        },
      ]),
    ).toThrow('Alchemical implant "implant-test" references missing device "missing-device".');
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
    expect(() =>
      loadContentPacks([
        {
          ...testPack,
          records: [
            ...testPack.records,
            {
              id: 'bad-mission',
              kind: 'mission',
              name: 'Bad mission',
              description: '',
              cadence: 'daily',
              eventType: 'session.completed',
              target: 1,
              reward: { experience: 5, items: { missing: 1 } },
            },
          ],
        },
      ]),
    ).toThrow('Mission "bad-mission" references missing reward item "missing".');
  });

  it('rejects every unresolved region, activity, race, shop and implant reference', () => {
    const manifest = (id: string) => ({ id, name: 'Reference check', version: '1.0.0' });
    const baseActivity = testPack.records.find((record) => record.id === 'mining')!;
    const withMining = (replacement: Record<string, unknown>) =>
      testPack.records.map((record) =>
        record.id === 'mining' ? { ...baseActivity, ...replacement } : record,
      );
    const baseRegion = {
      id: 'mod:check-region',
      kind: 'region',
      name: 'Reference region',
      description: '',
      terrain: [],
      climate: [],
      localities: [],
      materials: [],
      enemies: [],
      expeditionIds: [],
      activityIds: [],
    };
    const baseShop = {
      id: 'mod:check-shop',
      kind: 'shop',
      name: 'Reference shop',
      description: '',
      cadence: 'permanent',
      entries: [{ itemId: 'iron-ore', currency: 'fragments', price: 1 }],
    };
    const baseRace = testPack.records.find((record) => record.id === 'human')!;
    const invalidPacks = [
      {
        id: 'bad-race-tag',
        records: testPack.records.map((record) =>
          record.id === 'human' ? { ...baseRace, combatTags: ['base:missing-race-tag'] } : record,
        ),
        message: 'Race "human" references missing combat tag "base:missing-race-tag".',
      },
      {
        id: 'bad-race-skill',
        records: testPack.records.map((record) =>
          record.id === 'human'
            ? { ...baseRace, activityBonuses: [{ skillId: 'missing-skill', yieldMultiplier: 2 }] }
            : record,
        ),
        message: 'Race "human" references missing skill "missing-skill".',
      },
      {
        id: 'bad-activity-skill',
        records: withMining({ skillId: 'missing-skill' }),
        message: 'Activity "mining" references missing skill "missing-skill".',
      },
      {
        id: 'bad-activity-region',
        records: withMining({ regionId: 'missing-region' }),
        message: 'Activity "mining" references missing region "missing-region".',
      },
      {
        id: 'bad-activity-output',
        records: withMining({ outputItemId: 'missing-item' }),
        message: 'Activity "mining" references missing output item "missing-item".',
      },
      {
        id: 'bad-region-material',
        records: [...testPack.records, { ...baseRegion, materials: ['missing-material'] }],
        message: 'Region "mod:check-region" references missing material "missing-material".',
      },
      {
        id: 'bad-region-enemy',
        records: [...testPack.records, { ...baseRegion, enemies: ['missing-enemy'] }],
        message: 'Region "mod:check-region" references missing enemy "missing-enemy".',
      },
      {
        id: 'bad-region-expedition',
        records: [...testPack.records, { ...baseRegion, expeditionIds: ['missing-expedition'] }],
        message: 'Region "mod:check-region" references missing expedition "missing-expedition".',
      },
      {
        id: 'bad-region-activity',
        records: [...testPack.records, { ...baseRegion, activityIds: ['missing-activity'] }],
        message: 'Region "mod:check-region" references missing activity "missing-activity".',
      },
      {
        id: 'bad-region-unlock',
        records: [
          ...testPack.records,
          { ...baseRegion, unlockRequirements: { regionIds: ['missing-region'] } },
        ],
        message: 'Region "mod:check-region" requires missing region "missing-region".',
      },
      {
        id: 'bad-shop-skill',
        records: [
          ...testPack.records,
          { ...baseShop, entries: [{ ...baseShop.entries[0], requiredSkill: 'missing-skill' }] },
        ],
        message: 'Shop "mod:check-shop" references missing skill "missing-skill".',
      },
      {
        id: 'bad-shop-region',
        records: [...testPack.records, { ...baseShop, regionId: 'missing-region' }],
        message: 'Shop "mod:check-shop" references missing region "missing-region".',
      },
      {
        id: 'bad-implant-cost',
        records: [
          ...testPack.records,
          {
            id: 'mod:bad-alchemy',
            kind: 'system',
            name: 'Alchemy',
            description: '',
            systemType: 'alchemy',
            entries: [
              {
                id: 'implant-test',
                name: 'Implant',
                charge: 1,
                deviceItemId: 'iron-ore',
                installationCostFragments: -1,
              },
            ],
          },
        ],
        message: 'Alchemical implant "implant-test" has an invalid surgery cost.',
      },
    ];
    for (const invalid of invalidPacks) {
      expect(() =>
        loadContentPacks([{ manifest: manifest(invalid.id), records: invalid.records }]),
      ).toThrow(invalid.message);
    }
  });
});
