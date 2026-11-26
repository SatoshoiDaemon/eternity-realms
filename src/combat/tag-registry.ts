import { z } from 'zod';
import baseTagData from '../../content/core/enemy-tags.json';

const conditionOperator = z.enum([
  'eq',
  'neq',
  'eq_field',
  'includes',
  'includes_id',
  'not_includes',
  'includes_any',
  'not_includes_any',
  'not_includes_id',
  'truthy',
  'not_truthy',
  'lte',
  'gte',
  'gt',
  'lt',
]);

const conditionSchema = z.object({
  path: z.string().trim().min(1),
  op: conditionOperator,
  value: z.unknown().optional(),
});

const effectType = z.enum([
  'damage_multiplier',
  'elemental_relation',
  'target_gate',
  'status_immunity',
  'action_interval_multiplier',
  'regeneration',
  'hazard_awareness',
  'reveal_target',
  'policy_bias',
  'targeting_modifier',
  'environment_modifier',
  'displacement_resistance',
  'chain_damage',
  'on_hit_effect',
  'corrode_armor',
  'action_forbidden',
  'intercept_ally',
  'preferred_range',
  'counterattack',
  'vampirism',
  'flat_vampirism',
  'death_burst',
  'adaptive_resistance',
  'status_duration_multiplier',
]);

const tagEffectSchema = z
  .object({ type: effectType })
  .passthrough()
  .superRefine((effect, context) => {
    if (
      effect.type === 'status_duration_multiplier' &&
      (typeof effect.value !== 'number' || !Number.isFinite(effect.value) || effect.value <= 0)
    ) {
      context.addIssue({ code: 'custom', message: 'Status duration multiplier must be positive' });
    }
  });

const tagRuleSchema = z.object({
  id: z.string().trim().min(1),
  event: z.string().trim().min(1),
  conditions: z.array(conditionSchema),
  interactionId: z.string().trim().min(1),
  potency: z.number().finite().nonnegative(),
  priority: z.number().finite(),
  effect: tagEffectSchema,
});

const enemyTagSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+:[a-zA-Z0-9._/-]+$/),
  category: z.enum(['nature', 'anatomy', 'affinity', 'movement', 'behavior']),
  name: z.string().trim().min(1),
  description: z.string(),
  origin: z.string().trim().min(1),
  activationConditions: z.array(z.string()),
  eventsObserved: z.array(z.string()),
  modifiers: z.array(tagRuleSchema).min(1),
  interactions: z.array(
    z.object({ id: z.string().trim().min(1), counterplay: z.string().trim().min(1) }),
  ),
  requirements: z.array(z.string()),
  properties: z.array(z.string()),
});

export type TagCondition = z.infer<typeof conditionSchema>;
export type TagRule = z.infer<typeof tagRuleSchema>;
export type EnemyTagDefinition = z.infer<typeof enemyTagSchema>;
export type TagEffect = TagRule['effect'] & {
  tagId: string;
  ruleId: string;
  event: string;
  interactionId: string;
  potency: number;
  priority: number;
  origin: string;
};

export const BASE_ENEMY_TAGS: unknown[] = baseTagData;

export function loadTagRegistry(input: unknown[]): EnemyTagDefinition[] {
  const tags: EnemyTagDefinition[] = [];
  const ids = new Set<string>();
  for (const candidate of input) {
    const parsed = enemyTagSchema.safeParse(candidate);
    if (!parsed.success) {
      const id =
        typeof candidate === 'object' && candidate !== null && 'id' in candidate
          ? String(candidate.id)
          : '<unknown>';
      const hasNamespace = id.includes(':');
      throw new Error(
        hasNamespace
          ? `Invalid enemy tag rule or definition: ${id}`
          : `Enemy tag id must include a namespace: ${id}`,
      );
    }
    const tag = parsed.data;
    if (ids.has(tag.id)) {
      throw new Error(`Duplicate enemy tag id: ${tag.id}`);
    }
    ids.add(tag.id);
    tags.push(tag);
  }
  return tags.sort((left, right) => left.id.localeCompare(right.id));
}

const registry = loadTagRegistry(BASE_ENEMY_TAGS);
const definitionsById = new Map(registry.map((tag) => [tag.id, tag]));

function readPath(context: unknown, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function matchesCondition(condition: TagCondition, context: unknown): boolean {
  const actual = readPath(context, condition.path);
  switch (condition.op) {
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'eq_field':
      return actual === readPath(context, String(condition.value ?? ''));
    case 'includes':
      return Array.isArray(actual) && actual.includes(condition.value);
    case 'includes_id':
      return (
        Array.isArray(actual) &&
        actual.some(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'id' in entry &&
            (entry as { id: unknown }).id === condition.value,
        )
      );
    case 'not_includes':
      return !Array.isArray(actual) || !actual.includes(condition.value);
    case 'includes_any':
      return (
        Array.isArray(actual) &&
        Array.isArray(condition.value) &&
        condition.value.some((value) => actual.includes(value))
      );
    case 'not_includes_any':
      return (
        !Array.isArray(actual) ||
        !Array.isArray(condition.value) ||
        !condition.value.some((value) => actual.includes(value))
      );
    case 'not_includes_id':
      return (
        !Array.isArray(actual) ||
        !actual.some(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'id' in entry &&
            (entry as { id: unknown }).id === condition.value,
        )
      );
    case 'truthy':
      return Boolean(actual);
    case 'not_truthy':
      return !actual;
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual <= condition.value
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual >= condition.value
      );
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual > condition.value
      );
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual < condition.value
      );
  }
}

function isPreferred(candidate: TagEffect, current: TagEffect): boolean {
  if (candidate.potency !== current.potency) {
    return candidate.potency > current.potency;
  }
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  return `${candidate.tagId}/${candidate.ruleId}` < `${current.tagId}/${current.ruleId}`;
}

export function evaluateTagEffects(
  tagIds: string[],
  event: string,
  context: unknown,
  tagRegistry: EnemyTagDefinition[] = registry,
): TagEffect[] {
  const available =
    tagRegistry === registry ? definitionsById : new Map(tagRegistry.map((tag) => [tag.id, tag]));
  const selected = new Map<string, TagEffect>();
  for (const tagId of [...new Set(tagIds)].sort()) {
    const tag = available.get(tagId);
    if (!tag) {
      throw new Error(`Unknown enemy tag: ${tagId}`);
    }
    for (const rule of tag.modifiers) {
      if (
        rule.event !== event ||
        !rule.conditions.every((condition) => matchesCondition(condition, context))
      ) {
        continue;
      }
      const effect: TagEffect = {
        ...rule.effect,
        tagId,
        ruleId: rule.id,
        event,
        interactionId: rule.interactionId,
        potency: rule.potency,
        priority: rule.priority,
        origin: tag.origin,
      };
      const current = selected.get(rule.interactionId);
      if (!current || isPreferred(effect, current)) {
        selected.set(rule.interactionId, effect);
      }
    }
  }
  return [...selected.values()].sort(
    (left, right) =>
      left.priority - right.priority || left.interactionId.localeCompare(right.interactionId),
  );
}
