import { awardExperience, grantItems } from './progression';
import type { ContentCatalog } from '../content/registry';
import type { DomainEvent, GameState } from './types';

const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

export interface MissionProgress {
  missionId: string;
  periodKey: string;
  progress: number;
  target: number;
  claimed: boolean;
  complete: boolean;
}

function validateNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Mission time must be a valid non-negative epoch timestamp.');
  }
}

function getPeriod(
  mission: ContentCatalog['missions'] extends Map<string, infer T> ? T : never,
  now: number,
) {
  if (mission.cadence === 'main') {
    return { key: 'main', startAt: 0, endAt: Number.POSITIVE_INFINITY };
  }
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (mission.cadence === 'daily') {
    return {
      key: new Date(dayStart).toISOString().slice(0, 10),
      startAt: dayStart,
      endAt: dayStart + DAY_MS,
    };
  }
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const weekStart = dayStart - daysSinceMonday * DAY_MS;
  return {
    key: new Date(weekStart).toISOString().slice(0, 10),
    startAt: weekStart,
    endAt: weekStart + WEEK_MS,
  };
}

export function getMissionProgress(
  state: GameState,
  missionId: string,
  now: number,
  content: ContentCatalog,
): MissionProgress {
  validateNow(now);
  const mission = content.missions.get(missionId);
  if (!mission) throw new Error(`Unknown mission: ${missionId}`);
  const period = getPeriod(mission, now);
  const progress = state.events.filter(
    (event) =>
      event.type === mission.eventType &&
      event.occurredAt >= period.startAt &&
      event.occurredAt < period.endAt,
  ).length;
  const claimId = `${mission.id}@${period.key}`;
  const claimed =
    (state.missionClaims ?? []).includes(claimId) || state.processedEventIds.includes(claimId);
  return {
    missionId: mission.id,
    periodKey: period.key,
    progress: Math.min(progress, mission.target),
    target: mission.target,
    claimed,
    complete: progress >= mission.target,
  };
}

export function claimMission(
  state: GameState,
  missionId: string,
  now: number,
  content: ContentCatalog,
): GameState {
  const progress = getMissionProgress(state, missionId, now, content);
  const mission = content.missions.get(missionId)!;
  const claimId = `${mission.id}@${progress.periodKey}`;
  if (!state.character) throw new Error('A character is required to claim a mission reward.');
  if (progress.claimed || state.events.some((event) => event.id === claimId)) {
    throw new Error('Mission reward was already claimed for this period.');
  }
  if (!progress.complete) throw new Error('Mission objective is not complete.');

  const itemUpdate = grantItems(state.character, mission.reward.items, claimId);
  const experienceUpdate = awardExperience(
    itemUpdate.character,
    mission.reward.experience,
    content.rules,
    claimId,
  );
  const claimedEvent: DomainEvent = {
    id: claimId,
    type: 'mission.reward_claimed',
    occurredAt: now,
    missionId: mission.id,
    periodKey: progress.periodKey,
  };
  const events = [...itemUpdate.events, ...experienceUpdate.events, claimedEvent].map((event) => ({
    ...event,
    occurredAt: now,
  }));
  const processed = new Set(state.processedEventIds);
  const newEvents = events.filter((event) => {
    if (processed.has(event.id)) return false;
    processed.add(event.id);
    return true;
  });

  return {
    ...state,
    character: experienceUpdate.character,
    missionClaims: [...(state.missionClaims ?? []), claimId],
    events: [...state.events, ...newEvents],
    processedEventIds: [...state.processedEventIds, ...newEvents.map((event) => event.id)],
  };
}
