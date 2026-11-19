import { describe, expect, it } from 'vitest';
import {
  compileConstruction,
  loadGlyphs,
  loadNodeRegistry,
  loadSigils,
  validateConstruction,
  type NodeDefinition,
  type NodeGraph,
} from './graph';

const definitions: NodeDefinition[] = [
  { id: 'core:source', name: 'Source', category: 'source' },
  {
    id: 'core:fire',
    name: 'Fire',
    category: 'type',
    damageType: { channel: 'magical', element: 'fire' },
  },
  {
    id: 'core:bolt',
    name: 'Bolt',
    category: 'form',
    action: { kind: 'magic', target: 'enemy', intervalMs: 1000, accuracy: 1 },
  },
  {
    id: 'core:damage',
    name: 'Damage',
    category: 'effect',
    operation: { kind: 'damage', amount: 12, subtype: 'other' },
    parameters: { amount: { default: 12 } },
  },
  {
    id: 'core:burn',
    name: 'Burn',
    category: 'effect',
    operation: { kind: 'status', id: 'core:burning', category: 'dot', potency: 2, counter: 3 },
  },
  {
    id: 'core:amplify',
    name: 'Amplify',
    category: 'modifier',
    operation: {
      kind: 'damage_modifier',
      id: 'core:amplify',
      operation: 'multiply',
      value: 2,
      potency: 1,
    },
  },
  {
    id: 'core:spiritual',
    name: 'Spiritual',
    category: 'modifier',
    operation: { kind: 'property', value: 'spiritual' },
  },
  {
    id: 'core:long-cast',
    name: 'Long Cast',
    category: 'sacrifice',
    operation: { kind: 'interval', operation: 'add', value: 200 },
  },
  { id: 'core:heal', name: 'Heal', category: 'effect', operation: { kind: 'heal', amount: 10 } },
];

const graph = (children: string[] = ['damage']): NodeGraph => ({
  schemaVersion: 1,
  id: 'build:fire-bolt',
  name: 'Fire Bolt',
  kind: 'spell',
  rootId: 'source',
  nodes: [
    { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
    { instanceId: 'type', definitionId: 'core:fire', children: ['form'] },
    { instanceId: 'form', definitionId: 'core:bolt', children },
    {
      instanceId: 'damage',
      definitionId: 'core:damage',
      parameters: { amount: 20 },
      children: ['amplify'],
    },
    { instanceId: 'amplify', definitionId: 'core:amplify', children: ['spiritual'] },
    { instanceId: 'spiritual', definitionId: 'core:spiritual', children: ['sacrifice'] },
    { instanceId: 'sacrifice', definitionId: 'core:long-cast', children: [] },
  ],
  glyphIds: [],
});

describe('universal construction graph compiler', () => {
  it('compiles damage, modifiers, properties, sacrifices, and status effects to combat actions', () => {
    const current = graph(['damage', 'burn']);
    current.nodes.splice(4, 0, { instanceId: 'burn', definitionId: 'core:burn', children: [] });
    const compiled = compileConstruction(current, definitions);
    expect(compiled.action).toMatchObject({
      id: 'build:fire-bolt',
      kind: 'magic',
      name: 'Fire Bolt',
      target: 'enemy',
      intervalMs: 1200,
      damage: {
        amount: 20,
        channel: 'magical',
        element: 'fire',
        properties: ['spiritual'],
        modifiers: [{ id: 'core:amplify', operation: 'multiply', value: 2, potency: 1 }],
      },
      effects: [{ id: 'core:burning', potency: 2, counter: 3 }],
    });
    expect(compiled.calculationTrace.map((entry) => entry.nodeId)).toEqual([
      'damage',
      'amplify',
      'spiritual',
      'sacrifice',
      'burn',
    ]);
  });

  it('compiles healing effects through the same action contract', () => {
    const healing: NodeGraph = {
      ...graph(['type', 'form', 'heal']),
      nodes: [
        { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:fire', children: ['form'] },
        { instanceId: 'form', definitionId: 'core:bolt', children: ['heal'] },
        { instanceId: 'heal', definitionId: 'core:heal', children: [] },
      ],
    };
    expect(compileConstruction(healing, definitions).action).toMatchObject({
      kind: 'heal',
      healing: 10,
      target: 'enemy',
    });
  });

  it('compiles summon effects into the shared combat action contract', () => {
    const summonSpec = {
      id: 'core:graph-wisp',
      name: 'Graph Wisp',
      speciesId: 'core:graph-wisp',
      tags: ['base:ethereal'],
      attributes: { vigor: 1, resistance: 0, speed: 12, dexterity: 5, precision: 8, strength: 2 },
      hp: { current: 10, maximum: 10 },
      tenacity: { current: 0, maximum: 0 },
      energy: {},
      damage: {
        amount: 4,
        channel: 'magical' as const,
        element: 'arcane',
        properties: ['spiritual'],
        origin: { kind: 'node' as const, id: 'core:graph-wisp' },
      },
      intervalMs: 600,
      accuracy: 0.9,
      mitigation: { physical: 0, magical: 0 },
      positionOffset: { x: 0, y: 1 },
    };
    const summonOperation = {
      kind: 'summon',
      summon: summonSpec,
    } as unknown as NodeDefinition['operation'];
    const summonDefinitions = [
      ...definitions,
      {
        id: 'core:summon-form',
        name: 'Invocação',
        category: 'form' as const,
        action: {
          kind: 'summon' as const,
          target: 'self' as const,
          intervalMs: 1_000,
          accuracy: 1,
        },
      },
      {
        id: 'core:summon-effect',
        name: 'Espírito auxiliar',
        category: 'effect' as const,
        operation: summonOperation,
      },
    ];
    const summonGraph: NodeGraph = {
      schemaVersion: 1,
      id: 'build:graph-summon',
      name: 'Graph Summon',
      kind: 'summon',
      rootId: 'source',
      glyphIds: [],
      nodes: [
        { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:fire', children: ['form'] },
        { instanceId: 'form', definitionId: 'core:summon-form', children: ['effect'] },
        { instanceId: 'effect', definitionId: 'core:summon-effect', children: [] },
      ],
    };

    expect(compileConstruction(summonGraph, summonDefinitions).action).toMatchObject({
      id: 'build:graph-summon',
      kind: 'summon',
      target: 'self',
      summon: summonSpec,
    });

    const damageThenSummon: NodeGraph = {
      ...summonGraph,
      nodes: summonGraph.nodes
        .map((node) =>
          node.instanceId === 'form' ? { ...node, children: ['damage-first', 'effect'] } : node,
        )
        .concat({ instanceId: 'damage-first', definitionId: 'core:damage', children: [] }),
    };
    expect(() => compileConstruction(damageThenSummon, summonDefinitions)).toThrow(
      'A construction can compile one primary damage, healing, or summon Effect.',
    );

    const summonThenDamage: NodeGraph = {
      ...summonGraph,
      nodes: summonGraph.nodes
        .map((node) =>
          node.instanceId === 'form' ? { ...node, children: ['effect', 'damage-last'] } : node,
        )
        .concat({ instanceId: 'damage-last', definitionId: 'core:damage', children: [] }),
    };
    expect(() => compileConstruction(summonThenDamage, summonDefinitions)).toThrow(
      'A construction can compile one primary damage, healing, or summon Effect.',
    );

    const duplicateSummon: NodeGraph = {
      ...summonGraph,
      nodes: summonGraph.nodes
        .map((node) =>
          node.instanceId === 'form' ? { ...node, children: ['effect', 'second-summon'] } : node,
        )
        .concat({ instanceId: 'second-summon', definitionId: 'core:summon-effect', children: [] }),
    };
    expect(() => compileConstruction(duplicateSummon, summonDefinitions)).toThrow(
      'A construction can compile one primary damage, healing, or summon Effect.',
    );
  });

  it('reports all structural, registry, parameter, and connection errors', () => {
    const valid = graph();
    expect(validateConstruction(valid, definitions)).toEqual([]);
    expect(() =>
      compileConstruction({ ...valid, schemaVersion: 2 as unknown as 1 }, definitions),
    ).toThrow('Unsupported node graph version: 2.');
    expect(() => compileConstruction({ ...valid, rootId: 'missing' }, definitions)).toThrow(
      'Missing root node: missing.',
    );
    expect(() =>
      compileConstruction({ ...valid, nodes: [...valid.nodes, valid.nodes[0]!] }, definitions),
    ).toThrow('Duplicate node instance id: source.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'damage' ? { ...node, definitionId: 'core:missing' } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Unknown node definition: core:missing.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'source' ? { ...node, children: ['missing'] } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Missing connected node: missing.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'spiritual' ? { ...node, children: ['type'] } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Node graph contains a cycle at type.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: [
            ...valid.nodes,
            { instanceId: 'orphan', definitionId: 'core:burn', children: [] },
          ],
        },
        definitions,
      ),
    ).toThrow('Unreachable node: orphan.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'source' ? { ...node, children: ['type', 'damage'] } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Invalid node connection: source -> damage.');
    const emptyEffectGraph: NodeGraph = {
      ...valid,
      nodes: [
        { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:fire', children: ['form'] },
        { instanceId: 'form', definitionId: 'core:bolt', children: [] },
      ],
    };
    expect(() => compileConstruction(emptyEffectGraph, definitions)).toThrow(
      'Construction needs at least one Effect node.',
    );
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'damage' ? { ...node, parameters: { unknown: 1 } } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Undeclared node parameter: unknown.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'damage' ? { ...node, parameters: { amount: Number.NaN } } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Invalid node parameter: amount.');
    expect(() =>
      compileConstruction({ ...valid, glyphIds: ['missing:glyph'] }, definitions),
    ).toThrow('Unknown glyph: missing:glyph.');
  });

  it('loads stable registries and rejects malformed definitions and duplicate ids', () => {
    expect(loadNodeRegistry(definitions).map((node) => node.id)).toEqual(
      [...definitions.map((node) => node.id)].sort(),
    );
    expect(() => loadNodeRegistry([{ ...definitions[0]!, id: 'source' }])).toThrow(
      'Node id must include a namespace: source.',
    );
    expect(() => loadNodeRegistry([{ ...definitions[0]!, name: ' ' }])).toThrow(
      'Invalid node definition: core:source.',
    );
    expect(() => loadNodeRegistry([{}])).toThrow('Node id must include a namespace: <unknown>.');
    expect(() => loadNodeRegistry([definitions[0], definitions[0]])).toThrow(
      'Duplicate node definition id: core:source.',
    );
  });

  it('ports Glyph and equipment Sigil operations into the same executable action contract', () => {
    const glyphs = [
      {
        id: 'core:glyph-focus',
        name: 'Focus',
        operation: { kind: 'property' as const, value: 'spiritual' },
      },
    ];
    const sigils = loadSigils([
      {
        id: 'core:sigil-force',
        name: 'Force',
        operation: {
          kind: 'damage_modifier',
          id: 'core:sigil-force',
          operation: 'multiply',
          value: 2,
          potency: 1,
        },
      },
    ]);
    const current = graph();
    current.glyphIds = ['core:glyph-focus'];
    current.sigilIds = ['core:sigil-force'];
    const compiled = compileConstruction(current, definitions, glyphs, sigils);
    expect(compiled.action.damage?.properties).toContain('spiritual');
    expect(compiled.action.damage?.modifiers).toContainEqual(
      expect.objectContaining({ id: 'core:sigil-force', value: 2 }),
    );
    expect(() =>
      compileConstruction({ ...current, sigilIds: ['missing'] }, definitions, glyphs, sigils),
    ).toThrow('Unknown sigil: missing.');
    expect(() =>
      loadSigils([{ id: 'core:bad', name: 'Bad', operation: { kind: 'invalid' } }]),
    ).toThrow('Invalid sigil definition.');
  });

  it('compiles shared graph branches once and supports multiplicative timing sacrifices and node glyphs', () => {
    const current = graph(['damage', 'burn']);
    current.nodes.splice(4, 0, {
      instanceId: 'burn',
      definitionId: 'core:burn',
      children: ['amplify'],
    });
    const multiply: NodeDefinition = {
      id: 'core:multiply-time',
      name: 'Multiply time',
      category: 'sacrifice',
      operation: { kind: 'interval', operation: 'multiply', value: 2 },
    };
    current.nodes.find((node) => node.instanceId === 'form')!.children.push('slow-time');
    current.nodes.push({ instanceId: 'slow-time', definitionId: multiply.id, children: [] });
    current.nodes.find((node) => node.instanceId === 'damage')!.glyphIds = ['core:glyph-focus'];
    const glyphs = [
      {
        id: 'core:glyph-focus',
        name: 'Focus',
        operation: { kind: 'property' as const, value: 'focused' },
      },
    ];
    const compiled = compileConstruction(current, [...definitions, multiply], glyphs);
    expect(compiled.action.intervalMs).toBe(2400);
    expect(compiled.action.damage?.properties).toContain('focused');
    expect(compiled.action.effects).toContainEqual(expect.objectContaining({ id: 'core:burning' }));

    const impactType: NodeDefinition = {
      id: 'core:impact',
      name: 'Impact',
      category: 'type',
      damageType: { channel: 'physical', subtype: 'crushing' },
    };
    const defaultSubtypeDefinitions = [
      ...definitions.map((definition) =>
        definition.id === 'core:damage'
          ? { ...definition, operation: { ...definition.operation!, subtype: undefined } }
          : definition,
      ),
      impactType,
    ];
    const impact = graph();
    impact.nodes.find((node) => node.instanceId === 'type')!.definitionId = impactType.id;
    expect(compileConstruction(impact, defaultSubtypeDefinitions).action.damage?.subtype).toBe(
      'crushing',
    );
  });

  it('compiles movement effects into the combat action used by the shared engine', () => {
    const movementDefinition: NodeDefinition = {
      id: 'core:push',
      name: 'Push',
      category: 'effect',
      operation: { kind: 'movement', movement: { kind: 'push', distance: 2 } },
    };
    const current = graph(['damage', 'push']);
    current.nodes.push({ instanceId: 'push', definitionId: 'core:push', children: [] });
    expect(
      compileConstruction(current, [...definitions, movementDefinition]).action.movement,
    ).toEqual({ kind: 'push', distance: 2 });
  });

  it('rejects invalid category contracts, graph identity, source counts, and unsupported construction kinds', () => {
    expect(() =>
      loadNodeRegistry([{ id: 'core:type-without-data', name: 'Type', category: 'type' }]),
    ).toThrow('must define damageType exactly');
    expect(() =>
      loadNodeRegistry([
        {
          id: 'core:source-with-data',
          name: 'Source',
          category: 'source',
          damageType: { channel: 'physical' },
        },
      ]),
    ).toThrow('must define damageType exactly');
    expect(() =>
      loadNodeRegistry([{ id: 'core:form-without-action', name: 'Form', category: 'form' }]),
    ).toThrow('must define action exactly');
    expect(() =>
      loadNodeRegistry([
        {
          id: 'core:source-with-action',
          name: 'Source',
          category: 'source',
          action: { kind: 'attack', target: 'enemy', intervalMs: 1, accuracy: 1 },
        },
      ]),
    ).toThrow('must define action exactly');
    expect(() =>
      loadNodeRegistry([
        {
          id: 'core:source-with-operation',
          name: 'Source',
          category: 'source',
          operation: { kind: 'property', value: 'x' },
        },
      ]),
    ).toThrow('cannot execute an operation');
    expect(() =>
      loadGlyphs([{ id: 'core:glyph', name: 'Glyph', operation: { kind: 'invalid' } }]),
    ).toThrow('Invalid glyph definition.');
    const glyph = {
      id: 'core:glyph',
      name: 'Glyph',
      operation: { kind: 'property' as const, value: 'spiritual' },
    };
    expect(() => loadGlyphs([glyph, glyph])).toThrow('Duplicate glyph definition id');
    const sigil = {
      id: 'core:sigil',
      name: 'Sigil',
      operation: { kind: 'property' as const, value: 'spiritual' },
    };
    expect(() => loadSigils([sigil, sigil])).toThrow('Duplicate sigil definition id');
    const valid = graph();
    expect(() =>
      compileConstruction({ ...valid, kind: 'unknown' as NodeGraph['kind'] }, definitions),
    ).toThrow('Unsupported construction kind: unknown.');
    expect(() => compileConstruction({ ...valid, id: ' ' }, definitions)).toThrow(
      'Node graph id and name cannot be empty.',
    );
    expect(() => compileConstruction({ ...valid, name: ' ' }, definitions)).toThrow(
      'Node graph id and name cannot be empty.',
    );
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'source' ? { ...node, instanceId: ' ' } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Node instance id cannot be empty.');
    expect(() =>
      compileConstruction(
        { ...valid, nodes: valid.nodes.filter((node) => node.instanceId !== 'source') },
        definitions,
      ),
    ).toThrow('Missing root node: source.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: [
            ...valid.nodes,
            { instanceId: 'extra-source', definitionId: 'core:source', children: [] },
          ],
        },
        definitions,
      ),
    ).toThrow('Construction root must be its only Source node.');
  });

  it('requires one type and form and validates declared parameter types and referenced glyphs or sigils', () => {
    const valid = graph();
    const withoutType = {
      ...valid,
      nodes: valid.nodes.filter((node) => node.instanceId !== 'type'),
    };
    expect(() => compileConstruction(withoutType, definitions)).toThrow(
      'Missing connected node: type.',
    );
    const withoutForm: NodeGraph = {
      ...valid,
      nodes: [
        { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:fire', children: ['damage'] },
        { instanceId: 'damage', definitionId: 'core:damage', children: [] },
      ],
    };
    expect(() => compileConstruction(withoutForm, definitions)).toThrow(
      'Construction needs exactly one Type node and one Form node.',
    );
    const extraType = {
      ...valid,
      nodes: [
        ...valid.nodes,
        { instanceId: 'extra-type', definitionId: 'core:fire', children: [] },
      ],
    };
    expect(() => compileConstruction(extraType, definitions)).toThrow(
      'Unreachable node: extra-type.',
    );
    const badParameter = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.instanceId === 'damage' ? { ...node, parameters: { amount: 'many' } } : node,
      ),
    };
    expect(() => compileConstruction(badParameter, definitions)).toThrow(
      'Invalid node parameter: amount.',
    );
    const wrongType = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.instanceId === 'damage' ? { ...node, parameters: { amount: 'many' } } : node,
      ),
    };
    const stringParameterDefs = definitions.map((definition) =>
      definition.id === 'core:damage'
        ? { ...definition, parameters: { amount: { default: 'twelve' } } }
        : definition,
    );
    expect(() => compileConstruction(wrongType, stringParameterDefs)).toThrow(
      'Node parameter amount must be a finite number.',
    );
    expect(() =>
      compileConstruction({ ...valid, sigilIds: ['missing:sigil'] }, definitions),
    ).toThrow('Unknown sigil: missing:sigil.');
    expect(() =>
      compileConstruction(
        {
          ...valid,
          nodes: valid.nodes.map((node) =>
            node.instanceId === 'damage' ? { ...node, glyphIds: ['missing:glyph'] } : node,
          ),
        },
        definitions,
      ),
    ).toThrow('Unknown glyph: missing:glyph.');
  });

  it('compiles status removal and support-only operations and rejects conflicting primary effects', () => {
    const removal: NodeDefinition = {
      id: 'core:remove',
      name: 'Remove',
      category: 'effect',
      operation: { kind: 'remove_status', ids: ['core:burning'] },
    };
    const support: NodeDefinition = {
      id: 'core:support',
      name: 'Support',
      category: 'effect',
      operation: { kind: 'property', value: 'supportive' },
    };
    const removalGraph: NodeGraph = {
      ...graph(['type', 'form', 'remove']),
      nodes: [
        { instanceId: 'source', definitionId: 'core:source', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:fire', children: ['form'] },
        { instanceId: 'form', definitionId: 'core:bolt', children: ['remove'] },
        { instanceId: 'remove', definitionId: 'core:remove', children: [] },
      ],
    };
    expect(
      compileConstruction(removalGraph, [...definitions, removal]).action.removeEffects,
    ).toEqual(['core:burning']);
    const supportGraph = {
      ...removalGraph,
      nodes: removalGraph.nodes.map((node) =>
        node.instanceId === 'remove' ? { ...node, definitionId: 'core:support' } : node,
      ),
    };
    expect(compileConstruction(supportGraph, [...definitions, support]).action).toMatchObject({
      kind: 'support',
      properties: ['supportive'],
    });
    const conflicting: NodeGraph = {
      ...graph(['damage', 'heal']),
      nodes: [
        ...graph(['damage', 'heal']).nodes,
        { instanceId: 'heal', definitionId: 'core:heal', children: [] },
      ],
    };
    expect(() => compileConstruction(conflicting, definitions)).toThrow(
      'A construction can compile one primary damage or healing Effect.',
    );
    const repeatedDamage: NodeGraph = {
      ...graph(['damage', 'damage-2']),
      nodes: [
        ...graph(['damage', 'damage-2']).nodes,
        { instanceId: 'damage-2', definitionId: 'core:damage', children: [] },
      ],
    };
    expect(() => compileConstruction(repeatedDamage, definitions)).toThrow(
      'A construction can compile one damage Effect node.',
    );
  });
});
