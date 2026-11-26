import {
  awardExperience,
  awardSkillExperience,
  applyTrainingEffect,
  grantCurrency,
  grantItems,
  grantLootDrops,
} from './progression';
import type { ContentCatalog } from '../content/registry';
import type { Character, DomainEvent, ExpeditionCombatRecord, GameState, Session } from './types';
import { createCharacterCombatActor } from '../combat/player-actor';
import { simulateExpedition } from '../combat/expedition';
import type { CombatAction } from '../combat/types';
import { compileConstruction } from '../nodes/graph';
import { constructionPriority, unlockNodes } from '../nodes/library';
import { getActivityAccessError, getUnlockedRegionIds } from './activity-access';
import { getUnaffiliatedEffects } from './unaffiliated';

const MAX_PENDING_SESSIONS = 5;

function validateTime(now: number): void {
  if (!Number.isSafeInteger(now)) {
    throw new Error('Current time must be a finite safe integer.');
  }
}

function getSession(state: GameState, sessionId: string): Session {
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
}

function updateSession(state: GameState, updated: Session): GameState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === updated.id ? updated : session)),
  };
}

function appendEvents(state: GameState, events: DomainEvent[]): GameState {
  const knownIds = new Set(state.processedEventIds);
  const accepted: DomainEvent[] = [];
  for (const event of events) {
    if (!knownIds.has(event.id)) {
      knownIds.add(event.id);
      accepted.push(event);
    }
  }
  if (accepted.length === 0) {
    return state;
  }
  return {
    ...state,
    events: [...state.events, ...accepted],
    processedEventIds: [...state.processedEventIds, ...accepted.map((event) => event.id)],
  };
}

function setActivityState(state: GameState): GameState {
  if (!state.character) {
    return state;
  }
  const activityState = state.queue.length > 0 ? 'active' : 'idle';
  if (state.character.activityState === activityState) {
    return state;
  }
  const character: Character = { ...state.character, activityState };
  return { ...state, character };
}

function startQueuedSession(state: GameState, sessionId: string, startedAt: number): GameState {
  const session = getSession(state, sessionId);
  if (session.status !== 'queued') {
    throw new Error(`Session cannot start from status: ${session.status}`);
  }
  if (!Number.isSafeInteger(startedAt + session.durationMs)) {
    throw new Error('Session end time exceeds the safe integer range.');
  }
  const active: Session = {
    ...session,
    status: 'active',
    startedAt,
    elapsedMs: 0,
    lastObservedAt: startedAt,
  };
  const next = updateSession(state, active);
  return appendEvents(next, [
    {
      id: `${session.id}:session.started`,
      type: 'session.started',
      occurredAt: startedAt,
      sessionId: session.id,
      activityId: session.activityId,
    },
  ]);
}

function eventTime(events: DomainEvent[], occurredAt: number): DomainEvent[] {
  return events.map((event) => ({ ...event, occurredAt }));
}

function seedFromSessionId(sessionId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = Math.imul(hash ^ sessionId.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function activityRewardItems(
  character: Character,
  activity: ReturnType<ContentCatalog['activities']['get']> & {},
  rewardItems: Array<{ itemId: string; quantity: number }>,
  content: ContentCatalog,
): Record<string, number> {
  const race = content.races.get(character.raceId);
  let multiplier =
    race?.activityBonuses?.find((bonus) => bonus.skillId === activity.skillId)?.yieldMultiplier ??
    1;
  if (activity.skillId) {
    const skill = content.skills.get(activity.skillId);
    const level = character.skills[activity.skillId]?.level ?? 1;
    const unlocked = (skill?.milestones ?? []).filter((milestone) => milestone.level <= level);
    for (const milestone of unlocked) {
      for (const effect of milestone.effects) {
        if (
          effect.type === 'yield_multiplier' &&
          typeof effect.value === 'number' &&
          Number.isFinite(effect.value) &&
          effect.value > 0
        ) {
          multiplier *= effect.value;
        }
      }
    }
  }
  const result: Record<string, number> = {};
  for (const item of rewardItems) {
    const quantity =
      activity.outputItemId === item.itemId
        ? Math.floor(item.quantity * multiplier)
        : item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`Activity output is invalid for ${item.itemId}.`);
    }
    result[item.itemId] = (result[item.itemId] ?? 0) + quantity;
    if (!Number.isSafeInteger(result[item.itemId])) {
      throw new Error(`Activity output exceeds the safe integer range for ${item.itemId}.`);
    }
  }
  return result;
}

function activityTrainingEffect(
  character: Character,
  activity: ReturnType<ContentCatalog['activities']['get']> & {},
  content: ContentCatalog,
) {
  const trainingEffect = activity.trainingEffect;
  if (!trainingEffect) return trainingEffect;
  const skill = activity.skillId ? content.skills.get(activity.skillId) : undefined;
  const skillLevel = activity.skillId ? (character.skills[activity.skillId]?.level ?? 1) : 1;
  const skillMultiplier = (skill?.milestones ?? [])
    .filter((milestone) => milestone.level <= skillLevel)
    .flatMap((milestone) => milestone.effects)
    .filter(
      (effect) =>
        effect.type === 'training_gain' &&
        typeof effect.value === 'number' &&
        Number.isFinite(effect.value) &&
        effect.value > 0,
    )
    .reduce((total, effect) => total * Number(effect.value), 1);
  const unaffiliated = getUnaffiliatedEffects(
    character,
    content.energies.get('energy:unaffiliated'),
  );
  const trainingMultiplier = trainingEffect.attributeId.startsWith('physical:')
    ? unaffiliated.trainingGainMultiplier
    : 1;
  return {
    ...trainingEffect,
    amount: Math.max(1, Math.floor(trainingEffect.amount * skillMultiplier * trainingMultiplier)),
  };
}

function recordBrokenImplant(character: Character, implantId: string): Character {
  const value = character.extensions.brokenImplants;
  const broken = new Set((value as string[] | undefined) ?? []);
  broken.add(implantId);
  return { ...character, extensions: { ...character.extensions, brokenImplants: [...broken] } };
}

function createExpeditionPlayerActor(character: Character, content: ContentCatalog) {
  const equippedActions: CombatAction[] = (character.nodeLibrary?.constructions ?? [])
    .filter((construction) => construction.equipped)
    .map(
      (construction) =>
        compileConstruction(construction.graph, content.nodes, content.glyphs, content.sigils)
          .action,
    );
  const actor = createCharacterCombatActor(
    character,
    content.items,
    content.rules.combat,
    equippedActions,
    content.races.get(character.raceId),
    content.systems,
    [...content.energies.values()],
  );
  const configuredPriority = constructionPriority(character);
  actor.actionPriority = [
    ...configuredPriority,
    ...actor.actionPriority.filter((id) => !configuredPriority.includes(id)),
  ];
  return actor;
}

export function enqueueSession(
  state: GameState,
  input: { id: string; activityId: string; durationMs: number },
  content: ContentCatalog,
  now: number,
): GameState {
  validateTime(now);
  if (!state.character) {
    throw new Error('A character is required before starting a session.');
  }
  if (!input.id.trim()) {
    throw new Error('Session id cannot be empty.');
  }
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new Error('Session duration must be a positive safe integer.');
  }
  if (!content.activities.has(input.activityId)) {
    throw new Error(`Unknown activity: ${input.activityId}`);
  }
  const selectedActivity = content.activities.get(input.activityId)!;
  const accessError = getActivityAccessError(state.character, selectedActivity, content);
  if (accessError) throw new Error(accessError);
  if (state.sessions.some((session) => session.id === input.id)) {
    throw new Error(`Session id already exists: ${input.id}`);
  }
  if (state.queue.length >= MAX_PENDING_SESSIONS) {
    throw new Error('A character can have at most five active or queued sessions.');
  }

  const session: Session = {
    id: input.id,
    activityId: input.activityId,
    durationMs: input.durationMs,
    status: 'queued',
    createdAt: now,
  };
  let next: GameState = {
    ...state,
    sessions: [...state.sessions, session],
    queue: [...state.queue, session.id],
  };
  if (next.queue.length === 1) {
    next = startQueuedSession(next, session.id, now);
  }
  return setActivityState(next);
}

export function editQueuedSession(
  state: GameState,
  sessionId: string,
  changes: { activityId?: string; durationMs?: number },
  content: ContentCatalog,
): GameState {
  const session = getSession(state, sessionId);
  if (session.status !== 'queued') {
    throw new Error('Only queued sessions can be edited.');
  }
  const activityId = changes.activityId ?? session.activityId;
  const durationMs = changes.durationMs ?? session.durationMs;
  if (!content.activities.has(activityId)) {
    throw new Error(`Unknown activity: ${activityId}`);
  }
  if (!state.character) throw new Error('A character is required before editing a session.');
  const accessError = getActivityAccessError(
    state.character,
    content.activities.get(activityId)!,
    content,
  );
  if (accessError) throw new Error(accessError);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error('Session duration must be a positive safe integer.');
  }
  return updateSession(state, { ...session, activityId, durationMs });
}

export function reorderQueuedSession(
  state: GameState,
  sessionId: string,
  position: number,
): GameState {
  const session = getSession(state, sessionId);
  if (session.status !== 'queued' || state.queue.indexOf(sessionId) === 0) {
    throw new Error('Only queued sessions can be reordered.');
  }
  if (!Number.isSafeInteger(position) || position < 1 || position >= state.queue.length) {
    throw new Error(`Queue position must be between 1 and ${state.queue.length - 1}.`);
  }
  const queue = [...state.queue];
  const currentIndex = queue.indexOf(sessionId);
  if (currentIndex < 1) {
    throw new Error('Only queued sessions can be reordered.');
  }
  queue.splice(currentIndex, 1);
  queue.splice(position, 0, sessionId);
  return { ...state, queue };
}

export function cancelActiveSession(state: GameState, now: number): GameState {
  validateTime(now);
  const activeId = state.queue[0];
  if (!activeId || getSession(state, activeId).status !== 'active') {
    throw new Error('There is no active session to cancel.');
  }
  const session = getSession(state, activeId);
  const cancelled = updateSession(state, { ...session, status: 'cancelled', finishedAt: now });
  let next = appendEvents({ ...cancelled, queue: state.queue.slice(1) }, [
    {
      id: `${session.id}:session.cancelled`,
      type: 'session.cancelled',
      occurredAt: now,
      sessionId: session.id,
      activityId: session.activityId,
    },
  ]);
  const nextId = next.queue[0];
  if (nextId) {
    next = startQueuedSession(next, nextId, now);
  }
  return setActivityState(next);
}

export function reconcileSessions(
  state: GameState,
  now: number,
  content: ContentCatalog,
): GameState {
  validateTime(now);
  if (!state.character) {
    return state;
  }
  if (state.queue.length === 0) {
    return setActivityState(state);
  }

  let next = state;
  while (next.queue.length > 0) {
    const sessionId = next.queue[0];
    if (!sessionId) {
      return setActivityState(next);
    }
    let session = getSession(next, sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') {
      next = { ...next, queue: next.queue.slice(1) };
      continue;
    }
    if (session.status === 'queued') {
      next = startQueuedSession(next, session.id, now);
      session = getSession(next, session.id);
    }
    if (session.status !== 'active' || session.startedAt === undefined) {
      throw new Error(`Invalid queued session state: ${session.id}`);
    }
    const activity = content.activities.get(session.activityId);
    if (!activity) {
      throw new Error(`Unknown activity: ${session.activityId}`);
    }
    const reward = content.rewards.get(activity.rewardId);
    if (!reward) {
      throw new Error(`Unknown reward: ${activity.rewardId}`);
    }
    const completedAt = session.startedAt + session.durationMs;
    if (!Number.isSafeInteger(completedAt)) {
      throw new Error('Session end time exceeds the safe integer range.');
    }
    const completionEventId = `${session.id}:session.completed`;
    const rewardEventId = `${session.id}:reward.granted`;
    const alreadyProcessed =
      next.processedEventIds.includes(completionEventId) ||
      next.processedEventIds.includes(rewardEventId) ||
      next.events.some((event) => event.id === completionEventId || event.id === rewardEventId);
    if (alreadyProcessed) {
      const completedSession: Session = {
        ...session,
        status: 'completed',
        elapsedMs: session.durationMs,
        finishedAt: session.finishedAt ?? completedAt,
      };
      next = updateSession({ ...next, queue: next.queue.slice(1) }, completedSession);
      const nextId = next.queue[0];
      if (nextId) {
        next = startQueuedSession(next, nextId, completedSession.finishedAt!);
      }
      continue;
    }
    const elapsedMs = Math.max(
      Math.max(0, session.elapsedMs ?? 0),
      Math.min(session.durationMs, Math.max(0, now - session.startedAt)),
    );
    const lastObservedAt = Math.max(session.lastObservedAt ?? session.startedAt, now);
    if (elapsedMs < session.durationMs && now < completedAt) {
      if (session.elapsedMs !== elapsedMs || session.lastObservedAt !== lastObservedAt) {
        next = updateSession(next, { ...session, elapsedMs, lastObservedAt });
      }
      return setActivityState(next);
    }

    const character = next.character!;
    const withItems = grantItems(
      character,
      activityRewardItems(character, activity, reward.items, content),
      session.id,
    );
    const expedition = activity.expeditionId
      ? content.expeditions.get(activity.expeditionId)
      : undefined;
    if (activity.expeditionId && !expedition) {
      throw new Error(`Unknown expedition: ${activity.expeditionId}`);
    }
    const simulation = expedition
      ? simulateExpedition({
          sessionId: session.id,
          player: createExpeditionPlayerActor(character, content),
          expedition,
          enemies: [...content.enemies.values()],
          lootTables: [...content.lootTables.values()],
          durationMs: session.durationMs,
          seed: seedFromSessionId(session.id),
          tagRegistry: [...content.enemyTags.values()],
        })
      : undefined;
    const withLoot = simulation
      ? grantLootDrops(withItems.character, simulation.drops, new Set(next.processedEventIds))
      : { character: withItems.character, events: [] as DomainEvent[] };
    const afterImplants = simulation?.nextPlayer.soulAnchorUsed
      ? recordBrokenImplant(withLoot.character, 'implant-20')
      : withLoot.character;
    const withCombatVitals = simulation
      ? {
          ...afterImplants,
          energy: { ...withLoot.character.energy, reserves: { ...simulation.nextPlayer.energy } },
          extensions: {
            ...afterImplants.extensions,
            combatHp: simulation.nextPlayer.hp.current,
          },
        }
      : withLoot.character;
    const characterWithUnlocks = simulation
      ? unlockNodes(withCombatVitals, simulation.unlockedNodeIds)
      : withCombatVitals;
    const trainingUpdate = applyTrainingEffect(
      characterWithUnlocks,
      activityTrainingEffect(characterWithUnlocks, activity, content),
      session.id,
    );
    const skillUpdate = activity.skillId
      ? awardSkillExperience(
          trainingUpdate.character,
          activity.skillId,
          activity.skillExperience ?? 0,
          content.skills.get(activity.skillId)?.experiencePerLevel ?? 100,
          session.id,
        )
      : { character: trainingUpdate.character, events: [] as DomainEvent[] };
    const withExperience = awardExperience(
      skillUpdate.character,
      reward.experience + (simulation?.experience ?? 0),
      content.rules,
      session.id,
    );
    const currencyUpdate = grantCurrency(
      withExperience.character,
      'fragments',
      activity.fragmentReward ?? 0,
      session.id,
    );
    const previouslyUnlocked = new Set(
      Array.isArray(character.extensions.unlockedRegions)
        ? character.extensions.unlockedRegions.filter((id): id is string => typeof id === 'string')
        : [],
    );
    const nowUnlocked = getUnlockedRegionIds(currencyUpdate.character, content.regions);
    const newRegions = nowUnlocked.filter((id) => !previouslyUnlocked.has(id));
    const characterWithRegions = {
      ...currencyUpdate.character,
      extensions: {
        ...currencyUpdate.character.extensions,
        unlockedRegions: [...new Set([...previouslyUnlocked, ...nowUnlocked])],
      },
    };
    const completedSession: Session = {
      ...session,
      status: 'completed',
      elapsedMs: session.durationMs,
      lastObservedAt,
      finishedAt: completedAt,
      rewardId: reward.id,
    };
    const combatRecord: ExpeditionCombatRecord | undefined =
      simulation && expedition
        ? {
            id: session.id,
            sessionId: session.id,
            expeditionId: expedition.id,
            seed: seedFromSessionId(session.id),
            kills: simulation.kills,
            deaths: simulation.deaths,
            experience: simulation.experience,
            drops: simulation.drops,
            unlockedNodeIds: simulation.unlockedNodeIds,
            virtualDurationMs: simulation.virtualDurationMs,
            combats: simulation.combats,
            completedAt,
          }
        : undefined;
    const combatRecords = combatRecord
      ? [
          ...(next.combatRecords ?? []).filter((record) => record.id !== combatRecord.id),
          combatRecord,
        ]
      : (next.combatRecords ?? []);
    next = updateSession(
      {
        ...next,
        character: characterWithRegions,
        queue: next.queue.slice(1),
        combatRecords,
      },
      completedSession,
    );
    next = appendEvents(next, [
      {
        id: `${session.id}:session.completed`,
        type: 'session.completed',
        occurredAt: completedAt,
        sessionId: session.id,
        activityId: session.activityId,
      },
      {
        id: `${session.id}:reward.granted`,
        type: 'reward.granted',
        occurredAt: completedAt,
        sessionId: session.id,
        rewardId: reward.id,
      },
      ...eventTime(withItems.events, completedAt),
      ...eventTime(withLoot.events, completedAt),
      ...eventTime(skillUpdate.events, completedAt),
      ...eventTime(trainingUpdate.events, completedAt),
      ...eventTime(withExperience.events, completedAt),
      ...eventTime(currencyUpdate.events, completedAt),
      {
        id: `${session.id}:activity.completed`,
        type: 'activity.completed',
        occurredAt: completedAt,
        sessionId: session.id,
        activityId: activity.id,
      },
      ...(simulation?.combats
        .flatMap((combat) =>
          combat.actors
            .filter((actor) => actor.side === 'enemy' && actor.state === 'dead')
            .map((actor) => actor.speciesId),
        )
        .map((enemyId, index) => ({
          id: `${session.id}:enemy.defeated:${index + 1}`,
          type: 'enemy.defeated' as const,
          occurredAt: completedAt,
          enemyId,
          sessionId: session.id,
        })) ?? []),
      ...(expedition?.activityKind === 'quest'
        ? [
            {
              id: `${session.id}:quest.completed`,
              type: 'quest.completed' as const,
              occurredAt: completedAt,
              expeditionId: expedition.id,
              sessionId: session.id,
            },
          ]
        : []),
      ...newRegions.map((regionId) => ({
        id: `${session.id}:region.unlocked:${regionId}`,
        type: 'region.unlocked' as const,
        occurredAt: completedAt,
        regionId,
      })),
      ...(combatRecord
        ? [
            {
              id: `${session.id}:expedition.completed`,
              type: 'expedition.completed' as const,
              occurredAt: completedAt,
              sessionId: session.id,
              expeditionId: combatRecord.expeditionId,
              kills: combatRecord.kills,
              deaths: combatRecord.deaths,
            },
          ]
        : []),
      ...(combatRecord?.unlockedNodeIds.map((nodeId) => ({
        id: `${session.id}:node:${nodeId}`,
        type: 'node.unlocked' as const,
        occurredAt: completedAt,
        sessionId: session.id,
        nodeId,
      })) ?? []),
    ]);

    const nextId = next.queue[0];
    if (nextId) {
      next = startQueuedSession(next, nextId, completedAt);
    }
  }
  return setActivityState(next);
}

export function getSessionProgress(
  session: Session,
  now: number,
): { elapsedMs: number; fraction: number } {
  validateTime(now);
  if (session.status === 'completed') {
    return { elapsedMs: session.durationMs, fraction: 1 };
  }
  if (session.status !== 'active' || session.startedAt === undefined) {
    return { elapsedMs: 0, fraction: 0 };
  }
  const elapsedMs = Math.max(
    Math.max(0, session.elapsedMs ?? 0),
    Math.min(session.durationMs, Math.max(0, now - session.startedAt)),
  );
  return { elapsedMs, fraction: elapsedMs / session.durationMs };
}
