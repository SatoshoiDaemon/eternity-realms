import { z } from 'zod';
import type {
  AppliedCombatEffect,
  CombatAction,
  CombatDamage,
  DamageModifier,
  CombatSummonSpec,
} from '../combat/types';
import { CombatSummonSpecSchema } from '../combat/schema';

export type NodeCategory = 'source' | 'type' | 'form' | 'effect' | 'modifier' | 'sacrifice';
export type ConstructionKind =
  | 'spell'
  | 'ability'
  | 'technique'
  | 'weapon'
  | 'armor'
  | 'rune'
  | 'consumable'
  | 'summon'
  | 'other';

export type NodeOperation =
  | {
      kind: 'damage';
      amount: number;
      subtype?: 'cutting' | 'piercing' | 'crushing' | 'other';
      properties?: string[];
    }
  | { kind: 'heal'; amount: number }
  | {
      kind: 'status';
      id: string;
      category: string;
      potency: number;
      counter: number;
      damageMultiplier?: number;
    }
  | { kind: 'remove_status'; ids: string[] }
  | {
      kind: 'damage_modifier';
      id: string;
      operation: 'add' | 'multiply';
      value: number;
      potency: number;
      interactionId?: string;
    }
  | { kind: 'property'; value: string }
  | { kind: 'summon'; summon: CombatSummonSpec }
  | {
      kind: 'movement';
      movement: {
        kind: 'advance' | 'retreat' | 'push' | 'pull' | 'burrow' | 'emerge';
        distance: number;
      };
    }
  | { kind: 'interval'; operation: 'add' | 'multiply'; value: number };

export interface NodeDefinition {
  id: string;
  name: string;
  category: NodeCategory;
  description?: string;
  damageType?: {
    channel: 'physical' | 'magical' | 'true';
    element?: string;
    subtype?: 'cutting' | 'piercing' | 'crushing' | 'other';
  };
  action?: {
    kind:
      | 'attack'
      | 'magic'
      | 'ranged'
      | 'area'
      | 'heal'
      | 'guard'
      | 'move'
      | 'summon'
      | 'support'
      | 'intercept'
      | 'combo';
    target: 'enemy' | 'ally' | 'self' | 'lowest_enemy_hp' | 'lowest_ally_hp';
    intervalMs: number;
    accuracy: number;
    properties?: string[];
  };
  operation?: NodeOperation;
  parameters?: Record<string, { default: number | string | boolean }>;
}

export interface GlyphDefinition {
  id: string;
  name: string;
  operation: NodeOperation;
}

export interface SigilDefinition {
  id: string;
  name: string;
  operation: NodeOperation;
}

export interface GraphNode {
  instanceId: string;
  definitionId: string;
  children: string[];
  parameters?: Record<string, number | string | boolean>;
  glyphIds?: string[];
}

export interface NodeGraph {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: ConstructionKind;
  rootId: string;
  nodes: GraphNode[];
  glyphIds: string[];
  sigilIds?: string[];
}

export interface CompiledConstruction {
  action: CombatAction;
  calculationTrace: Array<{ nodeId: string; operation: string; value?: number | string }>;
}

const stableId = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9._-]+:[a-zA-Z0-9._/-]+$/);
const categorySchema = z.enum(['source', 'type', 'form', 'effect', 'modifier', 'sacrifice']);
const operationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('damage'),
    amount: z.number().finite().nonnegative(),
    subtype: z.enum(['cutting', 'piercing', 'crushing', 'other']).optional(),
    properties: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal('heal'), amount: z.number().finite().nonnegative() }),
  z.object({
    kind: z.literal('status'),
    id: stableId,
    category: z.string().trim().min(1),
    potency: z.number().finite().nonnegative(),
    counter: z.number().finite().nonnegative(),
    damageMultiplier: z.number().finite().optional(),
  }),
  z.object({ kind: z.literal('remove_status'), ids: z.array(stableId).min(1) }),
  z.object({
    kind: z.literal('damage_modifier'),
    id: stableId,
    operation: z.enum(['add', 'multiply']),
    value: z.number().finite(),
    potency: z.number().finite().nonnegative(),
    interactionId: stableId.optional(),
  }),
  z.object({ kind: z.literal('property'), value: z.string().trim().min(1) }),
  z.object({ kind: z.literal('summon'), summon: CombatSummonSpecSchema }),
  z.object({
    kind: z.literal('movement'),
    movement: z.object({
      kind: z.enum(['advance', 'retreat', 'push', 'pull', 'burrow', 'emerge']),
      distance: z.number().finite().nonnegative(),
    }),
  }),
  z.object({
    kind: z.literal('interval'),
    operation: z.enum(['add', 'multiply']),
    value: z.number().finite(),
  }),
]);
const nodeDefinitionSchema = z
  .object({
    id: stableId,
    name: z.string().trim().min(1),
    category: categorySchema,
    description: z.string().optional(),
    damageType: z
      .object({
        channel: z.enum(['physical', 'magical', 'true']),
        element: z.string().optional(),
        subtype: z.enum(['cutting', 'piercing', 'crushing', 'other']).optional(),
      })
      .optional(),
    action: z
      .object({
        kind: z.enum([
          'attack',
          'magic',
          'ranged',
          'area',
          'heal',
          'guard',
          'move',
          'summon',
          'support',
          'intercept',
          'combo',
        ]),
        target: z.enum(['enemy', 'ally', 'self', 'lowest_enemy_hp', 'lowest_ally_hp']),
        intervalMs: z.number().int().positive().safe(),
        accuracy: z.number().finite().min(0).max(1),
        properties: z.array(z.string()).optional(),
      })
      .optional(),
    operation: operationSchema.optional(),
    parameters: z
      .record(
        z.string(),
        z.object({ default: z.union([z.number().finite(), z.string(), z.boolean()]) }),
      )
      .optional(),
  })
  .passthrough();
const glyphSchema = z.object({
  id: stableId,
  name: z.string().trim().min(1),
  operation: operationSchema,
});
const sigilSchema = z.object({
  id: stableId,
  name: z.string().trim().min(1),
  operation: operationSchema,
});
const constructionKindSchema = z.enum([
  'spell',
  'ability',
  'technique',
  'weapon',
  'armor',
  'rune',
  'consumable',
  'summon',
  'other',
]);

export function loadNodeRegistry(input: unknown[]): NodeDefinition[] {
  const ids = new Set<string>();
  const definitions: NodeDefinition[] = [];
  for (const value of input) {
    const parsed = nodeDefinitionSchema.safeParse(value);
    const rawId =
      typeof value === 'object' && value !== null && 'id' in value ? String(value.id) : '<unknown>';
    if (!rawId.includes(':')) {
      throw new Error(`Node id must include a namespace: ${rawId}.`);
    }
    if (!parsed.success) {
      throw new Error(`Invalid node definition: ${rawId}.`);
    }
    if (ids.has(parsed.data.id)) {
      throw new Error(`Duplicate node definition id: ${parsed.data.id}.`);
    }
    ids.add(parsed.data.id);
    if ((parsed.data.category === 'type') !== Boolean(parsed.data.damageType)) {
      throw new Error(
        `Node ${parsed.data.id} must define damageType exactly when its category is type.`,
      );
    }
    if ((parsed.data.category === 'form') !== Boolean(parsed.data.action)) {
      throw new Error(
        `Node ${parsed.data.id} must define action exactly when its category is form.`,
      );
    }
    if (
      parsed.data.operation &&
      !['effect', 'modifier', 'sacrifice'].includes(parsed.data.category)
    ) {
      throw new Error(
        `Node ${parsed.data.id} cannot execute an operation in category ${parsed.data.category}.`,
      );
    }
    definitions.push(parsed.data);
  }
  return definitions.sort((left, right) => left.id.localeCompare(right.id));
}

export function loadGlyphs(input: unknown[]): GlyphDefinition[] {
  const glyphs: GlyphDefinition[] = [];
  const ids = new Set<string>();
  for (const candidate of input) {
    const parsed = glyphSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error('Invalid glyph definition.');
    }
    if (ids.has(parsed.data.id)) {
      throw new Error(`Duplicate glyph definition id: ${parsed.data.id}.`);
    }
    ids.add(parsed.data.id);
    glyphs.push(parsed.data);
  }
  return glyphs.sort((left, right) => left.id.localeCompare(right.id));
}

export function loadSigils(input: unknown[]): SigilDefinition[] {
  const sigils: SigilDefinition[] = [];
  const ids = new Set<string>();
  for (const candidate of input) {
    const parsed = sigilSchema.safeParse(candidate);
    if (!parsed.success) throw new Error('Invalid sigil definition.');
    if (ids.has(parsed.data.id))
      throw new Error(`Duplicate sigil definition id: ${parsed.data.id}.`);
    ids.add(parsed.data.id);
    sigils.push(parsed.data);
  }
  return sigils.sort((left, right) => left.id.localeCompare(right.id));
}

function allowedConnection(parent: NodeCategory, child: NodeCategory): boolean {
  if (child === 'sacrifice') {
    return parent !== 'source';
  }
  if (child === 'modifier') {
    return parent === 'effect' || parent === 'modifier';
  }
  return (
    (parent === 'source' && child === 'type') ||
    (parent === 'type' && child === 'form') ||
    (parent === 'form' && child === 'effect')
  );
}

function graphError(
  graph: NodeGraph,
  definitions: NodeDefinition[],
  glyphs: GlyphDefinition[],
  sigils: SigilDefinition[],
): string | undefined {
  if (graph.schemaVersion !== 1) {
    return `Unsupported node graph version: ${String(graph.schemaVersion)}.`;
  }
  if (!constructionKindSchema.safeParse(graph.kind).success) {
    return `Unsupported construction kind: ${String(graph.kind)}.`;
  }
  if (!graph.id.trim() || !graph.name.trim()) {
    return 'Node graph id and name cannot be empty.';
  }
  const registry = new Map(
    loadNodeRegistry(definitions).map((definition) => [definition.id, definition]),
  );
  const instances = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (!node.instanceId.trim()) {
      return 'Node instance id cannot be empty.';
    }
    if (instances.has(node.instanceId)) {
      return `Duplicate node instance id: ${node.instanceId}.`;
    }
    instances.set(node.instanceId, node);
  }
  const byInstance = new Map<string, NodeDefinition>();
  for (const node of graph.nodes) {
    const definition = registry.get(node.definitionId);
    if (!definition) {
      return `Unknown node definition: ${node.definitionId}.`;
    }
    byInstance.set(node.instanceId, definition);
  }
  const root = instances.get(graph.rootId);
  if (!root) {
    return `Missing root node: ${graph.rootId}.`;
  }
  if (
    byInstance.get(graph.rootId)?.category !== 'source' ||
    graph.nodes.filter((node) => byInstance.get(node.instanceId)?.category === 'source').length !==
      1
  ) {
    return 'Construction root must be its only Source node.';
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const walk = (instanceId: string): string | undefined => {
    if (visiting.has(instanceId)) {
      return `Node graph contains a cycle at ${instanceId}.`;
    }
    if (visited.has(instanceId)) {
      return undefined;
    }
    const node = instances.get(instanceId)!;
    visiting.add(instanceId);
    visited.add(instanceId);
    ordered.push(instanceId);
    for (const childId of node.children) {
      const child = instances.get(childId);
      if (!child) {
        return `Missing connected node: ${childId}.`;
      }
      const error = walk(childId);
      if (error) {
        return error;
      }
    }
    visiting.delete(instanceId);
    return undefined;
  };
  const cycleOrMissing = walk(graph.rootId);
  if (cycleOrMissing) {
    return cycleOrMissing;
  }
  const unreachable = graph.nodes.find((node) => !visited.has(node.instanceId));
  if (unreachable) {
    return `Unreachable node: ${unreachable.instanceId}.`;
  }
  const primaryEffects = graph.nodes.filter(
    (node) => byInstance.get(node.instanceId)?.category === 'effect',
  );
  if (primaryEffects.length === 0) {
    return 'Construction needs at least one Effect node.';
  }
  const types = graph.nodes.filter((node) => byInstance.get(node.instanceId)?.category === 'type');
  const forms = graph.nodes.filter((node) => byInstance.get(node.instanceId)?.category === 'form');
  if (types.length !== 1 || forms.length !== 1) {
    return 'Construction needs exactly one Type node and one Form node.';
  }
  for (const node of graph.nodes) {
    const def = byInstance.get(node.instanceId)!;
    for (const parameter of Object.keys(node.parameters ?? {})) {
      if (!def.parameters || !(parameter in def.parameters)) {
        return `Undeclared node parameter: ${parameter}.`;
      }
      const value = node.parameters?.[parameter];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return `Invalid node parameter: ${parameter}.`;
      }
      if (typeof value !== typeof def.parameters[parameter]?.default) {
        return `Invalid node parameter: ${parameter}.`;
      }
    }
  }
  const glyphRegistry = loadGlyphs(glyphs);
  const knownGlyphs = new Set(glyphRegistry.map((glyph) => glyph.id));
  const requestedGlyphs = [
    ...graph.glyphIds,
    ...graph.nodes.flatMap((node) => node.glyphIds ?? []),
  ];
  const missingGlyph = requestedGlyphs.find((id) => !knownGlyphs.has(id));
  if (missingGlyph) {
    return `Unknown glyph: ${missingGlyph}.`;
  }
  const knownSigils = new Set(loadSigils(sigils).map((sigil) => sigil.id));
  const missingSigil = (graph.sigilIds ?? []).find((id) => !knownSigils.has(id));
  if (missingSigil) return `Unknown sigil: ${missingSigil}.`;
  for (const node of graph.nodes) {
    const parent = byInstance.get(node.instanceId)!;
    for (const childId of node.children) {
      const child = byInstance.get(childId)!;
      if (!allowedConnection(parent.category, child.category)) {
        return `Invalid node connection: ${node.instanceId} -> ${childId}.`;
      }
    }
  }
  return undefined;
}

export function validateConstruction(
  graph: NodeGraph,
  definitions: NodeDefinition[],
  glyphs: GlyphDefinition[] = [],
  sigils: SigilDefinition[] = [],
): string[] {
  const error = graphError(graph, definitions, glyphs, sigils);
  return error ? [error] : [];
}

function parameterValue(
  node: GraphNode,
  definition: NodeDefinition,
  name: string,
  fallback: number,
): number {
  const value = node.parameters?.[name] ?? definition.parameters?.[name]?.default ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Node parameter ${name} must be a finite number.`);
  }
  return value;
}

function flattenGraph(
  graph: NodeGraph,
  definitions: NodeDefinition[],
): Array<{ node: GraphNode; definition: NodeDefinition }> {
  const byId = new Map(graph.nodes.map((node) => [node.instanceId, node]));
  const byDefinition = new Map(definitions.map((definition) => [definition.id, definition]));
  const ordered: Array<{ node: GraphNode; definition: NodeDefinition }> = [];
  const visited = new Set<string>();
  const walk = (instanceId: string) => {
    if (visited.has(instanceId)) {
      return;
    }
    visited.add(instanceId);
    const node = byId.get(instanceId)!;
    const definition = byDefinition.get(node.definitionId)!;
    ordered.push({ node, definition });
    node.children.forEach(walk);
  };
  walk(graph.rootId);
  return ordered;
}

function applyOperation(
  operation: NodeOperation,
  node: GraphNode,
  definition: NodeDefinition,
  damageType: NonNullable<NodeDefinition['damageType']>,
  state: {
    damage?: CombatDamage;
    healing?: number;
    effects: AppliedCombatEffect[];
    removeEffects: string[];
    properties: string[];
    modifiers: DamageModifier[];
    interval: number;
    movement?: CombatAction['movement'];
    summon?: CombatSummonSpec;
    trace: CompiledConstruction['calculationTrace'];
  },
): void {
  switch (operation.kind) {
    case 'damage': {
      if (state.damage) {
        throw new Error('A construction can compile one damage Effect node.');
      }
      if (state.healing !== undefined || state.summon) {
        throw new Error(
          'A construction can compile one primary damage, healing, or summon Effect.',
        );
      }
      const amount = parameterValue(node, definition, 'amount', operation.amount);
      state.damage = {
        amount,
        channel: damageType.channel,
        subtype: operation.subtype ?? damageType.subtype,
        element: damageType.element,
        properties: [...(operation.properties ?? [])],
        origin: { kind: 'node', id: definition.id },
        modifiers: state.modifiers,
      };
      state.trace.push({ nodeId: node.instanceId, operation: 'damage', value: amount });
      break;
    }
    case 'heal': {
      if (state.healing !== undefined || state.damage || state.summon) {
        throw new Error('A construction can compile one primary damage or healing Effect.');
      }
      state.healing = parameterValue(node, definition, 'amount', operation.amount);
      state.trace.push({ nodeId: node.instanceId, operation: 'heal', value: state.healing });
      break;
    }
    case 'status': {
      state.effects.push({
        id: operation.id,
        category: operation.category,
        potency: parameterValue(node, definition, 'potency', operation.potency),
        counter: parameterValue(node, definition, 'counter', operation.counter),
        damageMultiplier: operation.damageMultiplier,
        source: { kind: 'node', id: definition.id },
      });
      state.trace.push({ nodeId: node.instanceId, operation: 'status', value: operation.id });
      break;
    }
    case 'remove_status':
      state.removeEffects.push(...operation.ids);
      state.trace.push({
        nodeId: node.instanceId,
        operation: 'remove_status',
        value: operation.ids.join(','),
      });
      break;
    case 'damage_modifier':
      state.modifiers.push({
        id: operation.id,
        interactionId: operation.interactionId,
        operation: operation.operation,
        value: operation.value,
        potency: operation.potency,
        origin: { kind: 'node', id: definition.id },
      });
      state.trace.push({
        nodeId: node.instanceId,
        operation: 'damage_modifier',
        value: operation.value,
      });
      break;
    case 'summon':
      if (state.summon || state.damage || state.healing !== undefined) {
        throw new Error(
          'A construction can compile one primary damage, healing, or summon Effect.',
        );
      }
      state.summon = structuredClone(operation.summon);
      state.trace.push({
        nodeId: node.instanceId,
        operation: 'summon',
        value: operation.summon.id,
      });
      break;
    case 'property':
      state.properties.push(operation.value);
      state.trace.push({ nodeId: node.instanceId, operation: 'property', value: operation.value });
      break;
    case 'movement':
      state.movement = { ...operation.movement };
      state.trace.push({
        nodeId: node.instanceId,
        operation: 'movement',
        value: operation.movement.distance,
      });
      break;
    case 'interval':
      state.interval =
        operation.operation === 'add'
          ? state.interval + operation.value
          : state.interval * operation.value;
      state.trace.push({ nodeId: node.instanceId, operation: 'interval', value: operation.value });
      break;
  }
}

export function compileConstruction(
  graph: NodeGraph,
  definitions: NodeDefinition[],
  glyphs: GlyphDefinition[] = [],
  sigils: SigilDefinition[] = [],
): CompiledConstruction {
  const error = graphError(graph, definitions, glyphs, sigils);
  if (error) {
    throw new Error(error);
  }
  const ordered = flattenGraph(graph, definitions);
  const type = ordered.find(({ definition }) => definition.category === 'type')!.definition;
  const form = ordered.find(({ definition }) => definition.category === 'form')!.definition;
  const actionConfig = form.action!;
  const state = {
    damage: undefined as CombatDamage | undefined,
    healing: undefined as number | undefined,
    effects: [] as AppliedCombatEffect[],
    removeEffects: [] as string[],
    properties: [...(actionConfig.properties ?? [])],
    modifiers: [] as DamageModifier[],
    interval: actionConfig.intervalMs,
    movement: undefined as CombatAction['movement'],
    summon: undefined as CombatSummonSpec | undefined,
    trace: [] as CompiledConstruction['calculationTrace'],
  };
  const glyphRegistry = loadGlyphs(glyphs);
  const glyphById = new Map(glyphRegistry.map((glyph) => [glyph.id, glyph]));
  const attachedGlyphIds = new Map<string, string[]>();
  for (const id of graph.glyphIds) {
    const current = attachedGlyphIds.get(graph.rootId) ?? [];
    attachedGlyphIds.set(graph.rootId, [...current, id]);
  }
  for (const { node } of ordered) {
    attachedGlyphIds.set(node.instanceId, [
      ...(node.glyphIds ?? []),
      ...(attachedGlyphIds.get(node.instanceId) ?? []),
    ]);
  }
  for (const { node, definition } of ordered) {
    if (definition.operation) {
      applyOperation(definition.operation, node, definition, type.damageType!, state);
    }
    for (const glyphId of attachedGlyphIds.get(node.instanceId)!) {
      const glyph = glyphById.get(glyphId)!;
      applyOperation(glyph.operation, node, definition, type.damageType!, state);
      state.trace.push({ nodeId: node.instanceId, operation: `glyph:${glyph.id}` });
    }
  }
  const sigilRegistry = new Map(loadSigils(sigils).map((sigil) => [sigil.id, sigil]));
  for (const id of graph.sigilIds ?? []) {
    const sigil = sigilRegistry.get(id)!;
    const node: GraphNode = { instanceId: `sigil:${id}`, definitionId: id, children: [] };
    const definition: NodeDefinition = {
      id,
      name: sigil.name,
      category: 'modifier',
      operation: sigil.operation,
    };
    applyOperation(sigil.operation, node, definition, type.damageType!, state);
    state.trace.push({ nodeId: node.instanceId, operation: `sigil:${id}` });
  }
  if (state.damage) {
    state.damage.modifiers = state.modifiers;
    state.damage.properties = [...new Set([...state.damage.properties, ...state.properties])];
  }
  const action: CombatAction = {
    id: graph.id,
    name: graph.name,
    kind: state.summon
      ? 'summon'
      : state.healing !== undefined
        ? 'heal'
        : state.damage
          ? actionConfig.kind
          : 'support',
    target: actionConfig.target,
    intervalMs: Math.max(1, Math.floor(state.interval)),
    accuracy: actionConfig.accuracy,
    properties: [...new Set(state.properties)],
    damage: state.damage,
    summon: state.summon,
    healing: state.healing,
    effects: state.effects,
    removeEffects: state.removeEffects,
    movement: state.movement,
  };
  return { action, calculationTrace: state.trace };
}
