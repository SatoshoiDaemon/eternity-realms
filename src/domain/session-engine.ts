import { awardExperience, grantItems } from './progression';
import type { ContentCatalog } from '../content/registry';
import type { Character, DomainEvent, GameState, Session } from './types';

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
  const active: Session = { ...session, status: 'active', startedAt };
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
    if (now < completedAt) {
      return setActivityState(next);
    }

    const character = next.character!;
    const withItems = grantItems(
      character,
      Object.fromEntries(reward.items.map((item) => [item.itemId, item.quantity])),
      session.id,
    );
    const withExperience = awardExperience(
      withItems.character,
      reward.experience,
      content.rules,
      session.id,
    );
    const completedSession: Session = {
      ...session,
      status: 'completed',
      finishedAt: completedAt,
      rewardId: reward.id,
    };
    next = updateSession(
      {
        ...next,
        character: withExperience.character,
        queue: next.queue.slice(1),
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
      ...eventTime(withExperience.events, completedAt),
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
  const elapsedMs = Math.max(0, Math.min(session.durationMs, now - session.startedAt));
  return { elapsedMs, fraction: elapsedMs / session.durationMs };
}
