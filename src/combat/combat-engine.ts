import { evaluateTagEffects, type EnemyTagDefinition, type TagEffect } from './tag-registry';
import { CombatSummonSpecSchema } from './schema';
import type {
  AppliedCombatEffect,
  CombatAction,
  CombatActor,
  CombatDamage,
  CombatEnvironment,
  CombatLogEntry,
  CombatPolicyCondition,
  CombatState,
  DamageModifier,
} from './types';

const REFERENCE_SPEED = 10;
const DEFAULT_INTERVAL_MS = 1_000;
const ZERO_SEED_STATE = 0x6d2b79f5;
type DamagingCombatAction = CombatAction & { damage: CombatDamage };
const ORIGIN_ORDER: Record<DamageModifier['origin']['kind'], number> = {
  item: 0,
  ability: 1,
  weapon: 1,
  node: 1,
  class: 2,
  race: 3,
  effect: 4,
  mod: 5,
};

function cloneActor(actor: CombatActor): CombatActor {
  return {
    ...actor,
    tags: [...actor.tags],
    attributes: { ...actor.attributes },
    hp: { ...actor.hp },
    tenacity: { ...actor.tenacity },
    energy: { ...actor.energy },
    equipment: actor.equipment.map((item) => ({
      ...item,
      properties: item.properties && [...item.properties],
    })),
    actions: actor.actions.map((action) => ({
      ...action,
      properties: action.properties && [...action.properties],
      damage: action.damage && {
        ...action.damage,
        properties: [...action.damage.properties],
        modifiers: action.damage.modifiers?.map((modifier) => ({
          ...modifier,
          origin: { ...modifier.origin },
        })),
        origin: { ...action.damage.origin },
      },
      summon: action.summon && structuredClone(action.summon),
      effects: action.effects?.map((effect) => ({
        ...effect,
        source: effect.source && { ...effect.source },
      })),
      removeEffects: action.removeEffects && [...action.removeEffects],
      movement: action.movement && { ...action.movement },
      cost: action.cost && { ...action.cost },
    })),
    effects: actor.effects.map((effect) => ({
      ...effect,
      source: effect.source && { ...effect.source },
      tickDamage: effect.tickDamage && {
        ...effect.tickDamage,
        properties: effect.tickDamage.properties && [...effect.tickDamage.properties],
      },
    })),
    policy: {
      ...actor.policy,
      rules: actor.policy.rules.map((rule) => ({
        ...rule,
        conditions: rule.conditions?.map((condition) => ({ ...condition })),
      })),
    },
    actionPriority: [...actor.actionPriority],
    mitigation: { ...actor.mitigation },
    evasion: actor.evasion && { ...actor.evasion },
    guarantees: actor.guarantees && { ...actor.guarantees },
    position: { ...actor.position },
    affinityElements: actor.affinityElements && [...actor.affinityElements],
  };
}

function validateActor(actor: CombatActor): void {
  if (!actor.id.trim() || !actor.name.trim() || !actor.speciesId.trim()) {
    throw new Error('Combat actor identity fields cannot be empty.');
  }
  if (
    !Number.isSafeInteger(actor.hp.current) ||
    !Number.isSafeInteger(actor.hp.maximum) ||
    actor.hp.maximum <= 0
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid HP.`);
  }
  if (
    !Number.isSafeInteger(actor.tenacity.current) ||
    !Number.isSafeInteger(actor.tenacity.maximum) ||
    actor.tenacity.maximum < 0
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid Tenacity.`);
  }
  if (
    actor.regenerationPerAction !== undefined &&
    (!Number.isSafeInteger(actor.regenerationPerAction) || actor.regenerationPerAction < 0)
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid regeneration.`);
  }
  if (
    (actor.soulAnchorAvailable !== undefined && typeof actor.soulAnchorAvailable !== 'boolean') ||
    (actor.soulAnchorUsed !== undefined && typeof actor.soulAnchorUsed !== 'boolean')
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid soul anchor state.`);
  }
  if (!Number.isSafeInteger(actor.attributes.speed) || actor.attributes.speed <= 0) {
    throw new Error(`Combat actor ${actor.id} needs positive Speed.`);
  }
  if (
    actor.mitigation.physical < 0 ||
    actor.mitigation.physical >= 1 ||
    actor.mitigation.magical < 0 ||
    actor.mitigation.magical >= 1
  ) {
    throw new Error(
      `Combat actor ${actor.id} mitigation must be between zero and one, exclusive of one.`,
    );
  }
  if (
    actor.damageReduction !== undefined &&
    (!Number.isFinite(actor.damageReduction) ||
      actor.damageReduction < 0 ||
      actor.damageReduction >= 1)
  ) {
    throw new Error(`Combat actor ${actor.id} damage reduction must be between zero and one.`);
  }
  if (
    actor.evasion &&
    (actor.evasion.chance < 0 || actor.evasion.chance > 1 || actor.evasion.guaranteed < 0)
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid evasion.`);
  }
  if (
    actor.actions.some(
      (action) =>
        !action.id.trim() ||
        action.intervalMs <= 0 ||
        !Number.isSafeInteger(action.intervalMs) ||
        action.accuracy < 0 ||
        action.accuracy > 1,
    )
  ) {
    throw new Error(`Combat actor ${actor.id} has an invalid action.`);
  }
  if (
    actor.actions.some((action) =>
      action.kind === 'summon'
        ? !CombatSummonSpecSchema.safeParse(action.summon).success
        : action.summon !== undefined,
    )
  ) {
    throw new Error(`Combat actor ${actor.id} has an invalid summon action.`);
  }
  if (
    actor.actions.some(
      (action) =>
        action.damage && (!Number.isSafeInteger(action.damage.amount) || action.damage.amount < 0),
    )
  ) {
    throw new Error(`Combat actor ${actor.id} has invalid attack damage.`);
  }
  if (
    actor.actions.some(
      (action) =>
        action.movement &&
        (!Number.isFinite(action.movement.distance) || action.movement.distance < 0),
    )
  ) {
    throw new Error(`Combat actor ${actor.id} has an invalid movement action.`);
  }
}

function validateSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('Combat seed must be a non-negative safe integer.');
  }
}

export function createCombatState(
  id: string,
  actors: CombatActor[],
  seed: number,
  environment: CombatEnvironment = {},
  tagRegistry?: EnemyTagDefinition[],
): CombatState {
  if (!id.trim()) {
    throw new Error('Combat id cannot be empty.');
  }
  validateSeed(seed);
  if (actors.length < 2) {
    throw new Error('Combat requires at least two actors.');
  }
  if (new Set(actors.map((actor) => actor.id)).size !== actors.length) {
    throw new Error('Combat actor ids must be unique.');
  }
  if (new Set(actors.map((actor) => actor.side)).size < 2) {
    throw new Error('Combat requires at least two opposing sides.');
  }
  actors.forEach(validateActor);
  const rngState = seed >>> 0 || ZERO_SEED_STATE;
  const clonedActors = actors.map(cloneActor).map((actor) => ({
    ...actor,
    effects: actor.effects.map((effect) => {
      const persistent =
        tagRegistry?.length &&
        evaluateTagEffects(actor.tags, 'status.incoming', { status: effect }, tagRegistry).some(
          (rule) => rule.type === 'status_persistence' && rule.value === effect.id,
        );
      return {
        ...effect,
        counter: persistent ? 0 : effect.counter,
        expiresAt: persistent
          ? undefined
          : (effect.expiresAt ?? (effect.counter > 0 ? effect.counter * 1_000 : undefined)),
        nextTickAt:
          effect.tickDamage && effect.tickIntervalMs
            ? (effect.nextTickAt ?? effect.tickIntervalMs)
            : effect.nextTickAt,
      };
    }),
  }));
  return {
    id,
    seed,
    rngState,
    nowMs: 0,
    actors: clonedActors.map((actor) => ({
      ...actor,
      state: actor.hp.current <= 0 && actor.tenacity.current <= 0 ? 'dead' : 'alive',
    })),
    tagRegistry: tagRegistry && structuredClone(tagRegistry),
    log: [],
    nextEventNumber: 1,
    environment: {
      ...environment,
      elementOpposites: environment.elementOpposites && { ...environment.elementOpposites },
    },
    winner:
      new Set(
        actors
          .filter((actor) => actor.hp.current > 0 || actor.tenacity.current > 0)
          .map((actor) => actor.side),
      ).size === 1
        ? actors.find((actor) => actor.hp.current > 0 || actor.tenacity.current > 0)?.side
        : undefined,
  };
}

function pathValue(context: unknown, path: string): unknown {
  let current = context;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function comparePolicyCondition(condition: CombatPolicyCondition, context: unknown): boolean {
  const actual = pathValue(context, condition.path);
  switch (condition.operator) {
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual < condition.value
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual <= condition.value
      );
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual > condition.value
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual >= condition.value
      );
  }
}

function actorView(actor: CombatActor, actors: CombatActor[]): Record<string, unknown> {
  return {
    ...actor,
    hpRatio: actor.hp.current / actor.hp.maximum,
    nearbyBleedingOpponent: actors.some(
      (candidate) =>
        candidate.side !== actor.side &&
        candidate.state === 'alive' &&
        Math.abs(candidate.position.x - actor.position.x) +
          Math.abs(candidate.position.y - actor.position.y) <=
          1 &&
        candidate.effects.some((effect) => effect.id === 'core:bleeding'),
    ),
    aliveAllies: actors.filter(
      (candidate) => candidate.side === actor.side && candidate.state === 'alive',
    ).length,
    summonCount: actors.filter(
      (candidate) => candidate.summonedBy === actor.id && candidate.state === 'alive',
    ).length,
    actionsTaken: actor.actionsTaken ?? 0,
    revealed: actor.revealed ?? false,
    movementState: actor.movementState,
  };
}

function targetFor(
  action: CombatAction,
  actor: CombatActor,
  actors: CombatActor[],
  tagRegistry?: EnemyTagDefinition[],
): CombatActor | undefined {
  if (action.target === 'self') {
    return actor;
  }
  const allies = action.target === 'ally' || action.target === 'lowest_ally_hp';
  const eligible = actors
    .filter(
      (candidate) =>
        candidate.state === 'alive' &&
        (allies ? candidate.side === actor.side : candidate.side !== actor.side) &&
        (allies || canTrackFleeingTarget(actor, candidate, actors, action, tagRegistry)) &&
        (action.target !== 'ally' || candidate.id !== actor.id),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const prioritizedTargets = new Set(
    eligible
      .filter(
        (candidate) =>
          !allies &&
          evaluateTagEffects(
            candidate.tags,
            'targeting.check',
            {
              actor: actorView(actor, actors),
              attacker: actorView(actor, actors),
              target: actorView(candidate, actors),
              action,
            },
            tagRegistry,
          ).some(
            (effect) => effect.type === 'targeting_modifier' && effect.value === 'forced_target',
          ),
      )
      .map((candidate) => candidate.id),
  );
  eligible.sort((left, right) => {
    const priority =
      Number(prioritizedTargets.has(right.id)) - Number(prioritizedTargets.has(left.id));
    if (priority !== 0) return priority;
    if (action.target === 'lowest_enemy_hp' || action.target === 'lowest_ally_hp') {
      const hpDifference = left.hp.current / left.hp.maximum - right.hp.current / right.hp.maximum;
      if (hpDifference !== 0) return hpDifference;
    }
    return left.id.localeCompare(right.id);
  });
  const selected = eligible[0];
  if (!selected || allies) return selected;
  const interceptor = actors
    .filter(
      (candidate) =>
        candidate.state === 'alive' &&
        candidate.side === selected.side &&
        candidate.id !== selected.id,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .find((candidate) =>
      evaluateTagEffects(
        candidate.tags,
        'targeting.check',
        {
          attack: {
            channel: action.damage?.channel ?? 'physical',
            properties: actionProperties(action),
          },
          attacker: actorView(actor, actors),
          target: selected,
          ally: candidate,
          action,
        },
        tagRegistry,
      ).some((effect) => effect.type === 'intercept_ally' && effect.value === true),
    );
  return interceptor ?? selected;
}

function canTrackFleeingTarget(
  actor: CombatActor,
  target: CombatActor,
  actors: CombatActor[],
  action: CombatAction,
  tagRegistry?: EnemyTagDefinition[],
): boolean {
  if (target.movementState !== 'fleeing') return true;
  return evaluateTagEffects(
    actor.tags,
    'targeting.check',
    {
      actor: actorView(actor, actors),
      target: actorView(target, actors),
      action,
      environment: {},
    },
    tagRegistry,
  ).some(
    (effect) =>
      effect.type === 'targeting_modifier' &&
      typeof effect.value === 'object' &&
      effect.value !== null &&
      (effect.value as { trackFleeing?: unknown }).trackFleeing === true,
  );
}

function isAreaAction(action: CombatAction): boolean {
  return action.kind === 'area' || actionProperties(action).includes('area');
}

function areaTargets(
  action: CombatAction,
  actor: CombatActor,
  actors: CombatActor[],
  tagRegistry?: EnemyTagDefinition[],
): CombatActor[] {
  if (action.target === 'self') return [actor];
  const allies = action.target === 'ally' || action.target === 'lowest_ally_hp';
  return actors
    .filter(
      (candidate) =>
        candidate.state === 'alive' &&
        (allies
          ? candidate.side === actor.side && candidate.id !== actor.id
          : candidate.side !== actor.side),
    )
    .filter(
      (candidate) => allies || canTrackFleeingTarget(actor, candidate, actors, action, tagRegistry),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function conditionContext(
  actor: CombatActor,
  target: CombatActor | undefined,
  actors: CombatActor[],
  action: CombatAction,
) {
  return {
    actor: actorView(actor, actors),
    target: target && { ...actorView(target, actors), affinityElement: target.affinityElement },
    action,
    environment: {},
  };
}

function getTagBonus(tagEffects: TagEffect[], action: CombatAction): number {
  return tagEffects.reduce((total, effect) => {
    if (
      effect.type !== 'policy_bias' ||
      typeof effect.value !== 'object' ||
      effect.value === null
    ) {
      return total;
    }
    const value = effect.value as { actionKinds?: unknown; bonus?: unknown };
    return Array.isArray(value.actionKinds) &&
      value.actionKinds.includes(action.kind) &&
      typeof value.bonus === 'number'
      ? total + value.bonus
      : total;
  }, 0);
}

function actionScore(
  actor: CombatActor,
  action: CombatAction,
  target: CombatActor,
  actors: CombatActor[],
  tagEffects: TagEffect[],
  tagRegistry?: EnemyTagDefinition[],
): number {
  const explicit = actor.policy.rules.filter(
    (rule) =>
      rule.actionId === action.id &&
      (rule.conditions ?? []).every((condition) =>
        comparePolicyCondition(condition, conditionContext(actor, target, actors, action)),
      ),
  );
  const policyScore = explicit.length ? Math.max(...explicit.map((rule) => rule.priority)) : 0;
  const preferredIndex = actor.actionPriority.indexOf(action.id);
  const declaredScore =
    preferredIndex < 0 ? -actor.actions.length : actor.actions.length - preferredIndex;
  const preferredRange = evaluateTagEffects(
    actor.tags,
    'targeting.check',
    conditionContext(actor, target, actors, action),
    tagRegistry,
  ).find((effect) => effect.type === 'preferred_range' && typeof effect.value === 'number');
  const distance =
    Math.abs(actor.position.x - target.position.x) + Math.abs(actor.position.y - target.position.y);
  let rangeScore = 0;
  if (preferredRange && typeof preferredRange.value === 'number' && action.movement) {
    const desired = preferredRange.value;
    if (action.movement.kind === 'retreat' && distance < desired) rangeScore = desired - distance;
    if (action.movement.kind === 'advance' && distance > desired) rangeScore = distance - desired;
  }
  return policyScore + declaredScore + getTagBonus(tagEffects, action) + rangeScore;
}

function affordable(actor: CombatActor, action: CombatAction): boolean {
  return !action.cost || (actor.energy[action.cost.resource] ?? 0) >= action.cost.amount;
}

function chooseAction(
  actor: CombatActor,
  actors: CombatActor[],
  tagRegistry?: EnemyTagDefinition[],
): { action: CombatAction; target: CombatActor } | undefined {
  const candidates = actor.actions.flatMap((action) => {
    const target = targetFor(action, actor, actors, tagRegistry);
    if (!target || !affordable(actor, action)) {
      return [];
    }
    const effects = evaluateTagEffects(
      actor.tags,
      'action.select',
      conditionContext(actor, target, actors, action),
      tagRegistry,
    );
    if (
      effects.some(
        (effect) =>
          effect.type === 'action_forbidden' &&
          (Array.isArray(effect.value)
            ? effect.value.includes(action.kind)
            : effect.value === action.kind),
      )
    ) {
      return [];
    }
    return [
      { action, target, score: actionScore(actor, action, target, actors, effects, tagRegistry) },
    ];
  });
  candidates.sort(
    (left, right) => right.score - left.score || left.action.id.localeCompare(right.action.id),
  );
  const selected = candidates[0];
  return selected ? { action: selected.action, target: selected.target } : undefined;
}

function nextRandom(state: CombatState): number {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 0x1_0000_0000;
}

function interactionLogs(effects: TagEffect[]): CombatLogEntry['tagInteractions'] {
  return effects.map((effect) => ({
    tagId: effect.tagId,
    ruleId: effect.ruleId,
    interactionId: effect.interactionId,
    reason: `${effect.type} (${String(effect.value)})`,
  }));
}

function combineTagMultipliers(
  effects: TagEffect[],
  damage: CombatDamage,
  defender: CombatActor,
  environment: CombatEnvironment,
): Array<{ effect: TagEffect; multiplier: number }> {
  const results: Array<{ effect: TagEffect; multiplier: number }> = [];
  for (const effect of effects) {
    if (effect.type === 'damage_multiplier' && typeof effect.value === 'number') {
      results.push({ effect, multiplier: effect.value });
    } else if (effect.type === 'adaptive_resistance' && typeof effect.value === 'number') {
      if (defender.lastDamageChannel === damage.channel)
        results.push({ effect, multiplier: effect.value });
    } else if (effect.type === 'elemental_relation') {
      const value = effect as TagEffect & {
        sameElement?: number;
        oppositeElement?: number;
        affinityPath?: string;
        oppositesPath?: string;
      };
      const affinity = value.affinityPath
        ? pathValue({ defender }, value.affinityPath)
        : defender.affinityElement;
      const affinities =
        value.affinityPath === 'defender.affinityElement' && defender.affinityElements
          ? defender.affinityElements
          : Array.isArray(affinity)
            ? affinity.filter((entry): entry is string => typeof entry === 'string')
            : typeof affinity === 'string'
              ? [affinity]
              : [];
      const opposites = value.oppositesPath
        ? pathValue({ environment }, value.oppositesPath)
        : environment.elementOpposites;
      if (
        damage.element !== undefined &&
        affinities.includes(damage.element) &&
        typeof value.sameElement === 'number'
      ) {
        results.push({ effect, multiplier: value.sameElement });
      } else if (
        typeof opposites === 'object' &&
        opposites !== null &&
        affinities.some(
          (entry) =>
            Array.isArray((opposites as Record<string, unknown>)[entry]) &&
            ((opposites as Record<string, unknown>)[entry] as unknown[]).includes(damage.element),
        ) &&
        typeof value.oppositeElement === 'number'
      ) {
        results.push({ effect, multiplier: value.oppositeElement });
      }
    }
  }
  return results;
}

function resolvedModifiers(modifiers: DamageModifier[]): DamageModifier[] {
  const byIdentity = new Map<string, DamageModifier>();
  for (const modifier of [...modifiers].sort(
    (left, right) =>
      ORIGIN_ORDER[left.origin.kind] - ORIGIN_ORDER[right.origin.kind] ||
      left.id.localeCompare(right.id),
  )) {
    const key =
      modifier.interactionId ?? `${modifier.origin.kind}:${modifier.origin.id}:${modifier.id}`;
    const existing = byIdentity.get(key);
    if (!existing || modifier.potency > existing.potency) {
      byIdentity.set(key, modifier);
    }
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      ORIGIN_ORDER[left.origin.kind] - ORIGIN_ORDER[right.origin.kind] ||
      left.id.localeCompare(right.id),
  );
}

function rollAttack(
  state: CombatState,
  attacker: CombatActor,
  defender: CombatActor,
  action: DamagingCombatAction,
): { hit: boolean; evaded: boolean } {
  const properties = [...new Set([...(action.properties ?? []), ...action.damage.properties])];
  const inevitable = properties.includes('inevitable');
  const guarantees = attacker.guarantees ?? { hits: 0, semiHits: 0, evasions: 0 };
  if (inevitable) {
    return { hit: true, evaded: false };
  }
  if (guarantees.hits > 0) {
    attacker.guarantees = { ...guarantees, hits: guarantees.hits - 1 };
    return { hit: true, evaded: false };
  }
  if (nextRandom(state) >= action.accuracy) {
    return { hit: false, evaded: false };
  }
  const defenderGuarantees = defender.guarantees ?? { hits: 0, semiHits: 0, evasions: 0 };
  if (defenderGuarantees.evasions > 0) {
    defender.guarantees = { ...defenderGuarantees, evasions: defenderGuarantees.evasions - 1 };
    return { hit: true, evaded: true };
  }
  if (guarantees.semiHits > 0) {
    attacker.guarantees = { ...guarantees, semiHits: guarantees.semiHits - 1 };
    return { hit: true, evaded: false };
  }
  const evasionChance = defender.evasion?.chance ?? 0;
  return { hit: true, evaded: evasionChance > 0 && nextRandom(state) < evasionChance };
}

function applyStatus(
  target: CombatActor,
  effect: AppliedCombatEffect,
  nowMs: number,
  sourceActor: CombatActor,
  tagRegistry?: EnemyTagDefinition[],
): boolean {
  const statusContext = { status: effect, defender: target, target, attacker: sourceActor };
  const incomingEffects = evaluateTagEffects(
    target.tags,
    'status.incoming',
    statusContext,
    tagRegistry,
  );
  const appliedEffects = evaluateTagEffects(
    sourceActor.tags,
    'status.applied',
    statusContext,
    tagRegistry,
  );
  const statusRules = [...incomingEffects, ...appliedEffects];
  const durationMultiplier = statusRules.reduce(
    (multiplier, rule) =>
      rule.type === 'status_duration_multiplier' && typeof rule.value === 'number'
        ? multiplier * rule.value
        : multiplier,
    1,
  );
  const potencyMultiplier = statusRules.reduce(
    (multiplier, rule) =>
      rule.type === 'status_potency_multiplier' && typeof rule.value === 'number'
        ? multiplier * rule.value
        : multiplier,
    1,
  );
  const persistent = incomingEffects.some(
    (rule) => rule.type === 'status_persistence' && rule.value === effect.id,
  );
  const originalDurationMs =
    effect.expiresAt === undefined ? effect.counter * 1_000 : effect.expiresAt - nowMs;
  const adjustedDurationMs = originalDurationMs * durationMultiplier;
  const incoming = {
    ...effect,
    potency: effect.potency * potencyMultiplier,
    counter: persistent ? 0 : adjustedDurationMs / 1_000,
    sourceActorId: effect.sourceActorId ?? sourceActor.id,
    nextTickAt:
      effect.tickDamage && effect.tickIntervalMs
        ? (effect.nextTickAt ?? nowMs + effect.tickIntervalMs)
        : undefined,
    expiresAt: persistent ? undefined : nowMs + adjustedDurationMs,
  };
  const currentIndex = target.effects.findIndex((candidate) => candidate.id === incoming.id);
  if (currentIndex < 0) {
    target.effects.push(incoming);
    return true;
  }
  const current = target.effects[currentIndex]!;
  if (
    incoming.potency > current.potency ||
    (incoming.potency === current.potency &&
      ((incoming.expiresAt === undefined && current.expiresAt !== undefined) ||
        incoming.counter > current.counter))
  ) {
    target.effects[currentIndex] = incoming;
    return true;
  }
  return false;
}

function statusIsImmune(
  target: CombatActor,
  effect: AppliedCombatEffect,
  tagRegistry?: EnemyTagDefinition[],
): boolean {
  const rules = evaluateTagEffects(
    target.tags,
    'status.incoming',
    { status: effect, defender: target },
    tagRegistry,
  );
  return rules.some(
    (rule) =>
      rule.type === 'status_immunity' &&
      (rule.value === effect.id ||
        rule.value === effect.category ||
        (rule.value === 'energy' && effect.source?.kind === 'effect')),
  );
}

function damageToBars(
  target: CombatActor,
  damage: number,
): { hpLoss: number; tenacityLoss: number; killed: boolean; resurrected: boolean } {
  let hpLoss = damage;
  let tenacityLoss = 0;
  if (target.tenacity.current > 0) {
    hpLoss = Math.floor(damage / 2);
    tenacityLoss = Math.floor(damage / 2);
  }
  const hpBefore = target.hp.current;
  const tenacityBefore = target.tenacity.current;
  target.hp.current = Math.max(0, target.hp.current - hpLoss);
  target.tenacity.current = Math.max(0, target.tenacity.current - tenacityLoss);
  let killed = target.hp.current <= 0 && target.tenacity.current <= 0;
  let resurrected = false;
  if (killed) {
    if (target.soulAnchorAvailable) {
      target.hp.current = 1;
      target.tenacity.current = 0;
      target.soulAnchorAvailable = false;
      target.soulAnchorUsed = true;
      resurrected = true;
      killed = false;
    } else {
      target.state = 'dead';
    }
  }
  return {
    hpLoss: hpBefore - target.hp.current,
    tenacityLoss: tenacityBefore - target.tenacity.current,
    killed,
    resurrected,
  };
}

function createLog(state: CombatState, entry: Omit<CombatLogEntry, 'id'>): CombatLogEntry {
  const event: CombatLogEntry = { ...entry, id: `${state.id}:event:${state.nextEventNumber}` };
  state.nextEventNumber += 1;
  state.log.push(event);
  return event;
}

function expireEffects(state: CombatState, atMs: number): void {
  for (const actor of state.actors) {
    const expired = actor.effects.filter(
      (effect) => effect.expiresAt !== undefined && effect.expiresAt <= atMs,
    );
    actor.effects = actor.effects.filter(
      (effect) => effect.expiresAt === undefined || effect.expiresAt > atMs,
    );
    for (const effect of expired) {
      createLog(state, {
        timeMs: atMs,
        kind: 'action_skipped',
        actorId: actor.id,
        hit: false,
        evaded: false,
        blocked: false,
        damageInitial: 0,
        damageFinal: 0,
        modifiers: [],
        tagInteractions: [],
        resourceChanges: [],
        effectsApplied: [],
        killed: false,
        message: `Efeito expirado: ${effect.id}.`,
      });
    }
  }
}

function scheduleNext(
  state: CombatState,
  actor: CombatActor,
  action: CombatAction | undefined,
): void {
  const interval = action?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const scheduleEffects = evaluateTagEffects(
    actor.tags,
    'action.schedule',
    { actor: actorView(actor, state.actors), environment: state.environment },
    state.tagRegistry,
  );
  const speedMultiplier = scheduleEffects
    .filter(
      (effect) => effect.type === 'action_interval_multiplier' && typeof effect.value === 'number',
    )
    .reduce((product, effect) => product * Number(effect.value), 1);
  const dayEffects = evaluateTagEffects(
    actor.tags,
    'environment.tick',
    { actor: actorView(actor, state.actors), environment: state.environment },
    state.tagRegistry,
  );
  const environmentMultiplier = dayEffects
    .filter(
      (effect) =>
        effect.type === 'environment_modifier' &&
        typeof effect.value === 'object' &&
        effect.value !== null &&
        typeof (effect.value as { actionIntervalMultiplier?: unknown }).actionIntervalMultiplier ===
          'number',
    )
    .reduce(
      (product, effect) =>
        product *
        Number((effect.value as { actionIntervalMultiplier: number }).actionIntervalMultiplier),
      1,
    );
  actor.nextEventAt =
    state.nowMs +
    Math.max(
      1,
      Math.floor(
        interval *
          (REFERENCE_SPEED / actor.attributes.speed) *
          speedMultiplier *
          environmentMultiplier,
      ),
    );
}

function applyEnvironmentalEffects(state: CombatState, actor: CombatActor): string[] {
  const effects = evaluateTagEffects(
    actor.tags,
    'environment.tick',
    { actor: actorView(actor, state.actors), environment: state.environment },
    state.tagRegistry,
  );
  const applied: string[] = [];
  if (
    actor.regenerationPerAction &&
    !actor.effects.some((effect) => effect.id === 'base:regeneration-suppressed')
  ) {
    const before = actor.hp.current;
    actor.hp.current = Math.min(actor.hp.maximum, actor.hp.current + actor.regenerationPerAction);
    if (actor.hp.current > before) {
      applied.push(`regeneration:${actor.hp.current - before}`);
    }
  }
  for (const effect of effects) {
    if (effect.type === 'hazard_awareness' && state.environment.hazard) {
      applied.push(`hazard-awareness:${state.environment.hazard}`);
      continue;
    }
    if (
      effect.type === 'environment_status' &&
      typeof effect.value === 'object' &&
      effect.value !== null
    ) {
      const status = effect.value as AppliedCombatEffect;
      if (
        !statusIsImmune(actor, status, state.tagRegistry) &&
        applyStatus(actor, status, state.nowMs, actor, state.tagRegistry)
      ) {
        applied.push(`${actor.id}:${status.id}`);
      }
      continue;
    }
    if (
      effect.type === 'environment_modifier' &&
      typeof effect.value === 'object' &&
      effect.value !== null
    ) {
      applied.push(`environment:${effect.tagId}:${JSON.stringify(effect.value)}`);
      continue;
    }
    if (effect.type === 'regeneration' && typeof effect.value === 'number') {
      const before = actor.hp.current;
      actor.hp.current = Math.min(actor.hp.maximum, actor.hp.current + Math.floor(effect.value));
      if (actor.hp.current > before) {
        applied.push(`regeneration:${actor.hp.current - before}`);
      }
      continue;
    }
    if (effect.type === 'max_hp_regeneration' && typeof effect.value === 'number') {
      const before = actor.hp.current;
      actor.hp.current = Math.min(
        actor.hp.maximum,
        actor.hp.current + Math.floor(actor.hp.maximum * effect.value),
      );
      if (actor.hp.current > before) {
        applied.push(`max_hp_regeneration:${actor.hp.current - before}`);
      }
    }
  }
  return applied;
}

function actionProperties(action: CombatAction): string[] {
  return [
    ...new Set([
      ...(action.kind === 'area' ? ['area'] : []),
      ...(action.properties ?? []),
      ...(action.damage?.properties ?? []),
    ]),
  ];
}

function isTargetBlocked(
  target: CombatActor,
  action: DamagingCombatAction,
  attacker: CombatActor,
  tagRegistry?: EnemyTagDefinition[],
): TagEffect[] {
  const context = () => ({
    attack: { channel: action.damage.channel, properties: actionProperties(action) },
    attacker: actorView(attacker, [attacker, target]),
    defender: { ...actorView(target, [attacker, target]), side: target.side },
    target: { ...actorView(target, [attacker, target]), side: target.side },
    action,
    environment: {},
  });
  const tracking = evaluateTagEffects(attacker.tags, 'targeting.check', context(), tagRegistry);
  if (tracking.some((effect) => effect.type === 'reveal_target' && effect.value === true)) {
    target.revealed = true;
  }
  let effects = evaluateTagEffects(target.tags, 'targeting.check', context(), tagRegistry);
  if (effects.some((effect) => effect.type === 'reveal_target' && effect.value === true)) {
    target.revealed = true;
    effects = evaluateTagEffects(target.tags, 'targeting.check', context(), tagRegistry);
  }
  return effects.filter((effect) => {
    if (effect.type === 'reveal_target' && effect.value === true) {
      target.revealed = true;
      return false;
    }
    if (effect.type !== 'target_gate') {
      return false;
    }
    const required =
      (effect as TagEffect & { requiredProperties?: unknown }).requiredProperties ??
      (typeof effect.value === 'object' && effect.value !== null
        ? (effect.value as { requiredProperties?: unknown }).requiredProperties
        : undefined);
    return (
      Array.isArray(required) &&
      !required.some((property) => actionProperties(action).includes(String(property)))
    );
  });
}

function applyModifiers(
  initial: number,
  modifiers: DamageModifier[],
): { amount: number; records: CombatLogEntry['modifiers'] } {
  let amount = initial;
  const records: CombatLogEntry['modifiers'] = [];
  for (const modifier of resolvedModifiers(modifiers)) {
    amount = modifier.operation === 'add' ? amount + modifier.value : amount * modifier.value;
    records.push({
      id: modifier.id,
      source: `${modifier.origin.kind}:${modifier.origin.id}`,
      stage: 'damage',
      value: modifier.value,
    });
  }
  return { amount: Math.max(0, amount), records };
}

function applyDamage(
  state: CombatState,
  attacker: CombatActor,
  defender: CombatActor,
  action: CombatAction,
): Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'> {
  const damage = { ...action.damage!, properties: actionProperties(action) };
  const interactions: TagEffect[] = [];
  const initial = damage.amount;
  const attackResult = applyModifiers(initial, damage.modifiers ?? []);
  let modified = attackResult.amount;
  const modifierLogs = [...attackResult.records];
  const attackerEffects = evaluateTagEffects(
    attacker.tags,
    'attack.outgoing',
    { damage, attacker, defender, action },
    state.tagRegistry,
  );
  const outgoing = combineTagMultipliers(attackerEffects, damage, defender, state.environment);
  for (const { effect, multiplier } of outgoing) {
    modified *= multiplier;
    interactions.push(effect);
    modifierLogs.push({
      id: effect.ruleId,
      source: effect.tagId,
      stage: 'damage-modifier',
      value: multiplier,
    });
  }
  const incomingEffects = evaluateTagEffects(
    defender.tags,
    'damage.incoming',
    {
      damage,
      attacker,
      defender: {
        ...defender,
        affinityElement: defender.affinityElement,
        lastDamageChannel: defender.lastDamageChannel,
      },
      target: defender,
      action,
      environment: state.environment,
    },
    state.tagRegistry,
  );
  const tagMultipliers = combineTagMultipliers(
    incomingEffects,
    damage,
    defender,
    state.environment,
  );
  for (const { effect, multiplier } of tagMultipliers) {
    modified *= multiplier;
    interactions.push(effect);
    modifierLogs.push({
      id: effect.ruleId,
      source: effect.tagId,
      stage: 'state-modifier',
      value: multiplier,
    });
  }
  const matchingStateEffects = new Map<string, AppliedCombatEffect>();
  for (const effect of defender.effects) {
    if (
      !effect.damageMultiplier ||
      (effect.damageChannel && effect.damageChannel !== damage.channel)
    ) {
      continue;
    }
    const existing = matchingStateEffects.get(effect.id);
    if (!existing || effect.potency > existing.potency) {
      matchingStateEffects.set(effect.id, effect);
    }
  }
  for (const effect of matchingStateEffects.values()) {
    modified *= effect.damageMultiplier!;
    modifierLogs.push({
      id: effect.id,
      source: effect.source ? `${effect.source.kind}:${effect.source.id}` : 'status',
      stage: 'state-modifier',
      value: effect.damageMultiplier!,
    });
  }
  let final = Math.max(0, modified);
  if (damage.channel === 'physical') {
    final *= 1 - defender.mitigation.physical;
    modifierLogs.push({
      id: 'physical-mitigation',
      source: 'defense',
      stage: 'defense',
      value: defender.mitigation.physical,
    });
  } else if (damage.channel === 'magical') {
    final *= 1 - defender.mitigation.magical;
    modifierLogs.push({
      id: 'magical-mitigation',
      source: 'defense',
      stage: 'defense',
      value: defender.mitigation.magical,
    });
  }
  if (defender.damageReduction !== undefined && defender.damageReduction > 0) {
    final *= 1 - defender.damageReduction;
    modifierLogs.push({
      id: 'universal-damage-reduction',
      source: 'energy:unaffiliated',
      stage: 'defense',
      value: defender.damageReduction,
    });
  }
  final = Math.floor(Math.max(0, final));
  const hpBefore = defender.hp.current;
  const tenacityBefore = defender.tenacity.current;
  const barDamage = damageToBars(defender, final);
  defender.lastDamageChannel = damage.channel;
  return {
    hit: true,
    evaded: false,
    blocked: false,
    damageInitial: initial,
    damageFinal: final,
    modifiers: modifierLogs,
    tagInteractions: interactionLogs(
      interactions.concat(
        incomingEffects.filter(
          (effect) => !tagMultipliers.some((entry) => entry.effect === effect),
        ),
      ),
    ),
    hpChange: { before: hpBefore, after: defender.hp.current },
    tenacityChange: { before: tenacityBefore, after: defender.tenacity.current },
    resourceChanges: [],
    effectsApplied: barDamage.resurrected ? ['soul-anchor:resurrected-and-broken'] : [],
    killed: barDamage.killed,
    message: barDamage.resurrected
      ? `${attacker.name} atinge ${defender.name} por ${final} de dano; a Âncora da Alma o traz de volta com 1 HP e se quebra.`
      : `${attacker.name} atinge ${defender.name} por ${final} de dano.`,
  };
}

function runEffects(
  state: CombatState,
  attacker: CombatActor,
  defender: CombatActor,
  action: CombatAction,
  entry: Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'>,
): void {
  const applied: string[] = [];
  for (const effectId of action.removeEffects ?? []) {
    const before = defender.effects.length;
    defender.effects = defender.effects.filter((effect) => effect.id !== effectId);
    if (defender.effects.length !== before) {
      applied.push(`removed:${effectId}`);
    }
  }
  for (const effect of action.effects ?? []) {
    if (statusIsImmune(defender, effect, state.tagRegistry)) {
      continue;
    }
    if (applyStatus(defender, effect, state.nowMs, attacker, state.tagRegistry)) {
      applied.push(effect.id);
    }
  }
  const reactiveEffects = action.damage
    ? evaluateTagEffects(
        defender.tags,
        'damage.received',
        {
          damage: action.damage,
          attacker,
          defender,
          action,
        },
        state.tagRegistry,
      )
    : [];
  for (const effect of reactiveEffects) {
    if (
      effect.type === 'on_hit_effect' &&
      typeof effect.value === 'object' &&
      effect.value !== null
    ) {
      const payload = effect.value as AppliedCombatEffect;
      if (applyStatus(attacker, payload, state.nowMs, defender, state.tagRegistry)) {
        applied.push(`${attacker.id}:${payload.id}`);
      }
    } else if (
      effect.type === 'corrode_armor' &&
      typeof effect.value === 'number' &&
      effect.value >= 0
    ) {
      attacker.mitigation = {
        physical: attacker.mitigation.physical * Math.max(0, 1 - effect.value),
        magical: attacker.mitigation.magical * Math.max(0, 1 - effect.value),
      };
      applied.push(`${attacker.id}:armor-corroded`);
    }
  }
  const healed = entry.hpChange !== undefined && entry.hpChange.after > entry.hpChange.before;
  const appliedBuff = (action.effects ?? []).some(
    (effect) => effect.category === 'buff' && applied.includes(effect.id),
  );
  const supportEffects =
    healed || appliedBuff
      ? evaluateTagEffects(
          attacker.tags,
          'support.completed',
          {
            actor: attacker,
            attacker,
            target: defender,
            defender,
            action: {
              ...action,
              hasHealing: healed,
              hasAppliedBuff: appliedBuff,
            },
          },
          state.tagRegistry,
        )
      : [];
  for (const effect of supportEffects) {
    if (effect.type !== 'on_support_effect') continue;
    const payload = effect.value as AppliedCombatEffect;
    const recipients = [
      ...new Map(
        [attacker, defender].map((recipient) => [recipient.id, recipient] as const),
      ).values(),
    ];
    for (const recipient of recipients) {
      if (statusIsImmune(recipient, payload, state.tagRegistry)) continue;
      if (applyStatus(recipient, payload, state.nowMs, attacker, state.tagRegistry)) {
        applied.push(`${recipient.id}:${payload.id}`);
        entry.tagInteractions.push(...interactionLogs([effect]));
      }
    }
  }
  entry.effectsApplied.push(...applied);
  entry.tagInteractions.push(...interactionLogs(reactiveEffects));
}

function processDamageReactions(
  state: CombatState,
  attacker: CombatActor,
  defender: CombatActor,
  action: CombatAction & { damage: CombatDamage },
  entry: Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'>,
  currentLog: CombatLogEntry,
): void {
  const attackerContext = {
    ...attacker,
    hpRatio: attacker.hp.current / attacker.hp.maximum,
  };
  const effects = evaluateTagEffects(
    attacker.tags,
    'damage.dealt',
    {
      damage: action.damage,
      attacker: attackerContext,
      defender,
      action,
      damageFinal: entry.damageFinal,
    },
    state.tagRegistry,
  );
  for (const effect of effects) {
    if (
      (effect.type === 'vampirism' || effect.type === 'flat_vampirism') &&
      typeof effect.value === 'number' &&
      effect.value > 0
    ) {
      const before = attacker.hp.current;
      const healing =
        effect.type === 'flat_vampirism'
          ? Math.floor(effect.value)
          : Math.floor(entry.damageFinal * effect.value);
      attacker.hp.current = Math.min(attacker.hp.maximum, attacker.hp.current + healing);
      entry.actorHpChange = { before, after: attacker.hp.current };
      currentLog.actorHpChange = entry.actorHpChange;
      entry.effectsApplied.push(`${effect.type}:${attacker.hp.current - before}`);
      entry.tagInteractions.push(...interactionLogs([effect]));
    } else if (
      effect.type === 'on_hit_effect' &&
      typeof effect.value === 'object' &&
      effect.value !== null
    ) {
      const payload = effect.value as AppliedCombatEffect;
      if (!statusIsImmune(attacker, payload, state.tagRegistry)) {
        if (applyStatus(attacker, payload, state.nowMs, attacker, state.tagRegistry)) {
          entry.effectsApplied.push(`${attacker.id}:${payload.id}`);
          entry.tagInteractions.push(...interactionLogs([effect]));
        }
      }
    }
  }
  const incoming = evaluateTagEffects(
    defender.tags,
    'damage.incoming',
    {
      damage: action.damage,
      attacker,
      defender,
      target: defender,
      action,
      environment: state.environment,
    },
    state.tagRegistry,
  );
  for (const effect of incoming) {
    if (effect.type !== 'chain_damage' || typeof effect.value !== 'number' || effect.value <= 0)
      continue;
    const radius = Number((effect as TagEffect & { radius?: unknown }).radius ?? 1);
    const linked = state.actors
      .filter(
        (candidate) =>
          candidate.state === 'alive' &&
          candidate.side === defender.side &&
          candidate.id !== defender.id,
      )
      .filter(
        (candidate) =>
          Math.abs(candidate.position.x - defender.position.x) +
            Math.abs(candidate.position.y - defender.position.y) <=
          radius,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const target of linked) {
      const chainedAction: CombatAction = {
        ...action,
        id: `chain:${action.id}`,
        damage: {
          ...action.damage,
          amount: Math.floor(entry.damageFinal * effect.value),
          properties: [...action.damage.properties, 'chain'],
          origin: { kind: 'effect', id: effect.tagId },
        },
      };
      const chained = applyDamage(state, attacker, target, chainedAction);
      chained.tagInteractions.push(...interactionLogs([effect]));
      chained.message = `Condução de ${defender.name} atinge ${target.name} por ${chained.damageFinal} de dano.`;
      createLog(state, {
        ...chained,
        timeMs: state.nowMs,
        kind: 'attack',
        actorId: attacker.id,
        targetId: target.id,
        actionId: chainedAction.id,
      });
      if (chained.killed) triggerDeathBurst(state, target);
    }
  }
}

function triggerDeathBurst(state: CombatState, dead: CombatActor): void {
  const effects = evaluateTagEffects(
    dead.tags,
    'combat.death',
    { actor: dead, environment: state.environment },
    state.tagRegistry,
  );
  for (const effect of effects) {
    if (effect.type !== 'death_burst' || typeof effect.value !== 'object' || effect.value === null)
      continue;
    const payload = effect.value as {
      amount?: unknown;
      channel?: unknown;
      element?: unknown;
      radius?: unknown;
    };
    if (
      typeof payload.amount !== 'number' ||
      !['physical', 'magical', 'true'].includes(String(payload.channel))
    )
      continue;
    const radius = typeof payload.radius === 'number' ? payload.radius : 1;
    for (const target of state.actors
      .filter((candidate) => candidate.state === 'alive' && candidate.id !== dead.id)
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const distance =
        Math.abs(target.position.x - dead.position.x) +
        Math.abs(target.position.y - dead.position.y);
      if (distance > radius) continue;
      const action: CombatAction = {
        id: `death-burst:${dead.id}`,
        name: `${dead.name} explode`,
        kind: 'area',
        target: 'enemy',
        intervalMs: 1,
        accuracy: 1,
        properties: ['area'],
        damage: {
          amount: Math.floor(payload.amount),
          channel: payload.channel as CombatDamage['channel'],
          element: typeof payload.element === 'string' ? payload.element : undefined,
          properties: ['area'],
          origin: { kind: 'effect', id: effect.tagId },
        },
      };
      const result = applyDamage(state, dead, target, action);
      result.tagInteractions.push(...interactionLogs([effect]));
      result.message = `${dead.name} explode e causa ${result.damageFinal} de dano a ${target.name}.`;
      createLog(state, {
        ...result,
        timeMs: state.nowMs,
        kind: 'attack',
        actorId: dead.id,
        targetId: target.id,
        actionId: action.id,
      });
      if (result.killed) triggerDeathBurst(state, target);
    }
  }
}

function runCounterattack(
  state: CombatState,
  defender: CombatActor,
  attacker: CombatActor,
  event: 'attack.evaded' | 'attack.blocked',
): void {
  const triggers = evaluateTagEffects(
    defender.tags,
    event,
    { actor: defender, attacker, target: attacker, environment: state.environment },
    state.tagRegistry,
  ).filter((effect) => effect.type === 'counterattack');
  if (!triggers.length) return;
  const action = defender.actions
    .filter(
      (candidate): candidate is DamagingCombatAction =>
        Boolean(candidate.damage) && affordable(defender, candidate),
    )
    .sort(
      (left, right) =>
        defender.actionPriority.indexOf(left.id) - defender.actionPriority.indexOf(right.id) ||
        left.id.localeCompare(right.id),
    )[0];
  if (!action) return;
  if (action.cost)
    defender.energy[action.cost.resource] =
      (defender.energy[action.cost.resource] ?? 0) - action.cost.amount;
  const result = rollAttack(state, defender, attacker, action);
  const entry =
    result.hit && !result.evaded
      ? applyDamage(state, defender, attacker, action)
      : {
          hit: result.hit,
          evaded: result.evaded,
          blocked: false,
          damageInitial: action.damage!.amount,
          damageFinal: 0,
          modifiers: [],
          tagInteractions: [],
          resourceChanges: [],
          effectsApplied: [],
          killed: false,
          message: `${defender.name} contra-ataca, mas não acerta.`,
        };
  entry.tagInteractions.push(...interactionLogs(triggers));
  entry.message = `${defender.name} contra-ataca ${attacker.name}: ${entry.message}`;
  createLog(state, {
    ...entry,
    timeMs: state.nowMs,
    kind: 'attack',
    actorId: defender.id,
    targetId: attacker.id,
    actionId: action.id,
  });
  if (entry.killed) triggerDeathBurst(state, attacker);
}

function moveBetween(
  mover: CombatActor,
  anchor: CombatActor,
  distance: number,
  away: boolean,
): void {
  const dx = anchor.position.x - mover.position.x;
  const dy = anchor.position.y - mover.position.y;
  const manhattan = Math.abs(dx) + Math.abs(dy);
  if (manhattan === 0 || distance === 0) return;
  const direction = away ? -1 : 1;
  mover.position = {
    x: mover.position.x + direction * (dx / manhattan) * distance,
    y: mover.position.y + direction * (dy / manhattan) * distance,
  };
}

function applyMovement(
  state: CombatState,
  actor: CombatActor,
  target: CombatActor,
  movement: NonNullable<CombatAction['movement']>,
): { message: string; effect: string; tagInteractions: CombatLogEntry['tagInteractions'] } {
  const forced = movement.kind === 'push' || movement.kind === 'pull';
  const mover = forced ? target : actor;
  const anchor = forced ? actor : target;
  const effects = forced
    ? evaluateTagEffects(
        mover.tags,
        'movement.forced',
        { actor: mover, target: actor, movement, environment: state.environment },
        state.tagRegistry,
      )
    : [];
  const blocked = effects.some(
    (effect) => effect.type === 'displacement_resistance' && effect.value === true,
  );
  const resistance = effects
    .filter(
      (effect) => effect.type === 'displacement_resistance' && typeof effect.value === 'number',
    )
    .reduce((highest, effect) => Math.max(highest, Number(effect.value)), 0);
  const distance = blocked ? 0 : Math.max(0, movement.distance * (1 - resistance));
  const away = movement.kind === 'retreat' || movement.kind === 'push';
  const before = { ...mover.position };
  moveBetween(mover, anchor, distance, away);
  mover.movementState =
    movement.kind === 'burrow'
      ? 'burrowed'
      : movement.kind === 'emerge' || movement.kind === 'advance'
        ? 'pursuing'
        : movement.kind === 'retreat'
          ? 'fleeing'
          : 'displaced';
  const interactions = interactionLogs(effects);
  const result = `${mover.name} se move de (${before.x},${before.y}) para (${mover.position.x},${mover.position.y}).`;
  return {
    message: result,
    effect: `movement:${movement.kind}:${distance}`,
    tagInteractions: interactions,
  };
}

function nextStatusTickAt(state: CombatState): number | undefined {
  return state.actors
    .flatMap((actor) =>
      actor.state === 'alive'
        ? actor.effects.flatMap((effect) =>
            effect.tickDamage &&
            effect.nextTickAt !== undefined &&
            (effect.expiresAt === undefined || effect.nextTickAt < effect.expiresAt)
              ? [effect.nextTickAt]
              : [],
          )
        : [],
    )
    .sort((left, right) => left - right)[0];
}

function processStatusTicks(state: CombatState, atMs: number): void {
  for (const target of state.actors) {
    if (target.state !== 'alive') continue;
    for (const effect of [...target.effects]) {
      if (
        !effect.tickDamage ||
        !effect.tickIntervalMs ||
        effect.nextTickAt === undefined ||
        effect.nextTickAt > atMs ||
        (effect.expiresAt !== undefined && effect.nextTickAt >= effect.expiresAt)
      )
        continue;
      const source = state.actors.find((actor) => actor.id === effect.sourceActorId) ?? target;
      const amount = Math.floor(effect.tickDamage.amount * (effect.potency || 1));
      const action: CombatAction = {
        id: `status:${effect.id}`,
        name: effect.id,
        kind: 'magic',
        target: 'enemy',
        intervalMs: effect.tickIntervalMs,
        accuracy: 1,
        damage: {
          amount,
          channel: effect.tickDamage.channel,
          subtype: effect.tickDamage.subtype,
          element: effect.tickDamage.element,
          properties: [...(effect.tickDamage.properties ?? [])],
          origin: effect.source ?? { kind: 'effect', id: effect.id },
        },
      };
      const result = applyDamage(state, source, target, action);
      createLog(state, {
        ...result,
        timeMs: atMs,
        kind: 'attack',
        actorId: source.id,
        targetId: target.id,
        actionId: action.id,
        message: `${effect.id} causa ${result.damageFinal} de dano a ${target.name}.`,
      });
      if (result.killed) triggerDeathBurst(state, target);
      const current = target.effects.find((candidate) => candidate.id === effect.id)!;
      current.nextTickAt = effect.nextTickAt! + effect.tickIntervalMs;
      if (result.killed) break;
    }
  }
}

function resolveDamageAction(
  state: CombatState,
  actor: CombatActor,
  target: CombatActor,
  action: DamagingCombatAction,
  resourceChanges: CombatLogEntry['resourceChanges'],
  environmentalTags: string[],
): Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'> {
  const blocked = isTargetBlocked(target, action, actor, state.tagRegistry);
  if (blocked.length > 0) {
    return {
      hit: false,
      evaded: false,
      blocked: true,
      damageInitial: action.damage.amount,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: interactionLogs(blocked),
      resourceChanges,
      effectsApplied: environmentalTags,
      killed: false,
      message: `${target.name} não pode ser alcançado por esta ação.`,
    };
  }
  const result = rollAttack(state, actor, target, action);
  if (!result.hit || result.evaded) {
    return {
      hit: result.hit,
      evaded: result.evaded,
      blocked: false,
      damageInitial: action.damage.amount,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: [],
      resourceChanges,
      effectsApplied: environmentalTags,
      killed: false,
      message: result.evaded
        ? `${target.name} desvia de ${action.name}.`
        : `${action.name} erra ${target.name}.`,
    };
  }
  const entry = applyDamage(state, actor, target, action);
  entry.resourceChanges.push(...resourceChanges);
  entry.effectsApplied.push(...environmentalTags);
  runEffects(state, actor, target, action, entry);
  if (action.movement) {
    const movement = applyMovement(state, actor, target, action.movement);
    entry.message += ` ${movement.message}`;
    entry.effectsApplied.push(movement.effect);
    entry.tagInteractions.push(...movement.tagInteractions);
  }
  return entry;
}

function processAction(state: CombatState, actor: CombatActor): void {
  const environmentalTags = applyEnvironmentalEffects(state, actor);
  const selected = chooseAction(actor, state.actors, state.tagRegistry);
  if (!selected) {
    createLog(state, {
      timeMs: state.nowMs,
      kind: 'action_skipped',
      actorId: actor.id,
      hit: false,
      evaded: false,
      blocked: false,
      damageInitial: 0,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: [],
      resourceChanges: [],
      effectsApplied: environmentalTags,
      killed: false,
      message: `${actor.name} não possui ação válida ou recurso suficiente.`,
    });
    actor.actionsTaken = (actor.actionsTaken ?? 0) + 1;
    scheduleNext(state, actor, undefined);
    return;
  }
  const { action, target } = selected;
  const resourceChanges: CombatLogEntry['resourceChanges'] = [];
  if (action.cost) {
    const before = actor.energy[action.cost.resource] ?? 0;
    const after = before - action.cost.amount;
    actor.energy[action.cost.resource] = after;
    resourceChanges.push({ actorId: actor.id, resource: action.cost.resource, before, after });
  }
  if (action.damage) {
    const damagingAction: DamagingCombatAction = { ...action, damage: action.damage };
    const targets = isAreaAction(action)
      ? areaTargets(action, actor, state.actors, state.tagRegistry)
      : [target];
    let firstEntry:
      | Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'>
      | undefined;
    for (const targetActor of targets) {
      if (targetActor.state !== 'alive') continue;
      const includeCastState = firstEntry === undefined;
      const targetEntry = resolveDamageAction(
        state,
        actor,
        targetActor,
        damagingAction,
        includeCastState ? resourceChanges : [],
        includeCastState ? environmentalTags : [],
      );
      const actionLog = createLog(state, {
        ...targetEntry,
        timeMs: state.nowMs,
        kind: 'attack',
        actorId: actor.id,
        targetId: targetActor.id,
        actionId: action.id,
      });
      if (targetEntry.hit && !targetEntry.evaded && !targetEntry.blocked) {
        processDamageReactions(state, actor, targetActor, damagingAction, targetEntry, actionLog);
      }
      if (targetEntry.killed) triggerDeathBurst(state, targetActor);
      if (targetEntry.evaded || targetEntry.blocked) {
        runCounterattack(
          state,
          targetActor,
          actor,
          targetEntry.blocked ? 'attack.blocked' : 'attack.evaded',
        );
      }
      firstEntry ??= targetEntry;
    }
    actor.actionsTaken = (actor.actionsTaken ?? 0) + 1;
    scheduleNext(state, actor, action);
    return;
  }
  let entry: Omit<CombatLogEntry, 'id' | 'timeMs' | 'actorId' | 'targetId' | 'actionId' | 'kind'>;
  if (action.kind === 'heal' || action.kind === 'support') {
    const before = target.hp.current;
    target.hp.current = Math.min(
      target.hp.maximum,
      target.hp.current + Math.max(0, Math.floor(action.healing ?? 0)),
    );
    entry = {
      hit: true,
      evaded: false,
      blocked: false,
      damageInitial: 0,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: [],
      hpChange: { before, after: target.hp.current },
      resourceChanges,
      effectsApplied: environmentalTags,
      killed: false,
      message: `${actor.name} recupera ${target.hp.current - before} HP de ${target.name}.`,
    };
    runEffects(state, actor, target, action, entry);
  } else if (action.kind === 'summon' && action.summon) {
    const spec = action.summon;
    const summonedId = `${actor.id}:summon:${spec.id}:${(actor.actionsTaken ?? 0) + 1}`;
    const summonAttackId = `${spec.id}:attack`;
    const summoned: CombatActor = {
      id: summonedId,
      name: spec.name,
      speciesId: spec.speciesId,
      tags: [...spec.tags],
      side: actor.side,
      attributes: { ...spec.attributes },
      hp: { ...spec.hp },
      tenacity: { ...spec.tenacity },
      energy: { ...spec.energy },
      equipment: [],
      actions: [
        {
          id: summonAttackId,
          name: spec.name,
          kind: spec.damage.channel === 'magical' ? 'magic' : 'attack',
          target: 'enemy',
          intervalMs: spec.intervalMs,
          accuracy: spec.accuracy,
          damage: structuredClone(spec.damage),
        },
      ],
      effects: [],
      policy: { id: `${spec.id}:policy`, rules: [] },
      actionPriority: [summonAttackId],
      mitigation: { ...spec.mitigation },
      position: {
        x: actor.position.x + spec.positionOffset.x,
        y: actor.position.y + spec.positionOffset.y,
      },
      state: 'alive',
      nextEventAt: state.nowMs,
      summonedBy: actor.id,
    };
    state.actors.push(summoned);
    entry = {
      hit: true,
      evaded: false,
      blocked: false,
      damageInitial: 0,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: [],
      resourceChanges,
      effectsApplied: [...environmentalTags, `summoned:${summoned.id}`],
      killed: false,
      message: `${actor.name} invoca ${summoned.name}.`,
    };
  } else {
    entry = {
      hit: true,
      evaded: false,
      blocked: false,
      damageInitial: 0,
      damageFinal: 0,
      modifiers: [],
      tagInteractions: [],
      resourceChanges,
      effectsApplied: environmentalTags,
      killed: false,
      message: `${actor.name} executa ${action.name}.`,
    };
    if (action.movement) {
      const movement = applyMovement(state, actor, target, action.movement);
      entry.message = `${actor.name} executa ${action.name}. ${movement.message}`;
      entry.effectsApplied.push(movement.effect);
      entry.tagInteractions.push(...movement.tagInteractions);
    }
    runEffects(state, actor, target, action, entry);
  }
  createLog(state, {
    ...entry,
    timeMs: state.nowMs,
    kind:
      action.kind === 'summon'
        ? 'summon'
        : action.kind === 'heal' || action.kind === 'support'
          ? 'heal'
          : 'attack',
    actorId: actor.id,
    targetId: target.id,
    actionId: action.id,
  });
  actor.actionsTaken = (actor.actionsTaken ?? 0) + 1;
  scheduleNext(state, actor, action);
}

function activeSides(state: CombatState): Set<string> {
  return new Set(
    state.actors.filter((actor) => actor.state === 'alive').map((actor) => actor.side),
  );
}

export function advanceCombat(state: CombatState, untilMs: number): CombatState {
  if (!Number.isSafeInteger(untilMs) || untilMs < state.nowMs) {
    throw new Error('Combat time cannot move backwards.');
  }
  const next: CombatState = {
    ...state,
    actors: state.actors.map(cloneActor),
    tagRegistry: state.tagRegistry && structuredClone(state.tagRegistry),
    log: state.log.map((entry) => ({
      ...entry,
      modifiers: entry.modifiers.map((modifier) => ({ ...modifier })),
      tagInteractions: entry.tagInteractions.map((interaction) => ({ ...interaction })),
      resourceChanges: entry.resourceChanges.map((change) => ({ ...change })),
      effectsApplied: [...entry.effectsApplied],
    })),
    environment: {
      ...state.environment,
      elementOpposites: state.environment.elementOpposites && {
        ...state.environment.elementOpposites,
      },
    },
  };
  if (next.winner) {
    return next;
  }
  while (activeSides(next).size > 1) {
    const actor = next.actors
      .filter((candidate) => candidate.state === 'alive' && candidate.nextEventAt <= untilMs)
      .sort(
        (left, right) => left.nextEventAt - right.nextEventAt || left.id.localeCompare(right.id),
      )[0];
    const statusAt = nextStatusTickAt(next);
    if (
      statusAt !== undefined &&
      statusAt <= untilMs &&
      (!actor || statusAt <= actor.nextEventAt)
    ) {
      next.nowMs = statusAt;
      processStatusTicks(next, statusAt);
      expireEffects(next, statusAt);
      const remainingSides = activeSides(next);
      if (remainingSides.size === 1) next.winner = [...remainingSides][0];
      continue;
    }
    if (!actor) {
      next.nowMs = untilMs;
      break;
    }
    next.nowMs = actor.nextEventAt;
    expireEffects(next, next.nowMs);
    processAction(next, actor);
    const sides = activeSides(next);
    if (sides.size === 1) {
      next.winner = [...sides][0];
      break;
    }
  }
  return next;
}
