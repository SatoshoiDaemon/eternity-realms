import { getUnlockedRegionIds } from './activity-access';
import { awardExperience, grantCurrency, grantItems } from './progression';
import type { MissionDefinition } from '../content/schema';
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
  available: boolean;
  lockedReason?: string;
}

function validateNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Mission time must be a valid non-negative epoch timestamp.');
  }
}

function getPeriod(mission: MissionDefinition, now: number) {
  if (mission.cadence === 'main' || mission.cadence === 'secondary') {
    return { key: mission.cadence, startAt: 0, endAt: Number.POSITIVE_INFINITY };
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

function matchesCriteria(
  event: DomainEvent,
  criteria: Record<string, unknown> | undefined,
): boolean {
  if (!criteria) return true;
  return Object.entries(criteria).every(([key, expected]) => {
    const actual = (event as unknown as Record<string, unknown>)[key];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

function prerequisiteClaimId(state: GameState, content: ContentCatalog, id: string, now: number) {
  const prerequisite = content.missions.get(id);
  if (!prerequisite) return undefined;
  const period = getPeriod(prerequisite, now);
  const claimId = `${prerequisite.id}@${period.key}`;
  return (state.missionClaims ?? []).includes(claimId) ||
    state.processedEventIds.includes(claimId) ||
    state.events.some((event) => event.type === 'mission.reward_claimed' && event.id === claimId)
    ? claimId
    : undefined;
}

function availabilityError(
  state: GameState,
  mission: MissionDefinition,
  now: number,
  content: ContentCatalog,
): string | undefined {
  const character = state.character;
  if (!character) return 'A character is required to access missions.';
  if (mission.requiredLevel && character.level < mission.requiredLevel) {
    return `Requires character level ${mission.requiredLevel}.`;
  }
  if (
    mission.regionId &&
    !getUnlockedRegionIds(character, content.regions).includes(mission.regionId)
  ) {
    return `Region ${content.regions.get(mission.regionId)?.name ?? mission.regionId} is locked.`;
  }
  for (const prerequisiteId of mission.prerequisites ?? []) {
    if (!prerequisiteClaimId(state, content, prerequisiteId, now)) {
      return `Complete the prerequisite mission: ${prerequisiteId}.`;
    }
  }
  return undefined;
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
  const matchingEvents = state.events.filter(
    (event) =>
      event.type === mission.eventType &&
      event.occurredAt >= period.startAt &&
      event.occurredAt < period.endAt &&
      matchesCriteria(event, mission.criteria),
  );
  const claimId = `${mission.id}@${period.key}`;
  const claimed =
    (state.missionClaims ?? []).includes(claimId) || state.processedEventIds.includes(claimId);
  const lockedReason = availabilityError(state, mission, now, content);
  return {
    missionId: mission.id,
    periodKey: period.key,
    progress: Math.min(matchingEvents.length, mission.target),
    target: mission.target,
    claimed,
    complete: matchingEvents.length >= mission.target,
    available: !lockedReason,
    ...(lockedReason ? { lockedReason } : {}),
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
  if (!progress.available) throw new Error(progress.lockedReason!);
  if (!progress.complete) throw new Error('Mission objective is not complete.');

  const itemUpdate = grantItems(state.character, mission.reward.items, claimId);
  let character = itemUpdate.character;
  const events: DomainEvent[] = [...itemUpdate.events];
  for (const [currency, amount] of Object.entries(mission.reward.currencies ?? {})) {
    const currencyUpdate = grantCurrency(character, currency, amount, `${claimId}:reward`);
    character = currencyUpdate.character;
    events.push(...currencyUpdate.events);
  }
  const experienceUpdate = awardExperience(
    character,
    mission.reward.experience,
    content.rules,
    claimId,
  );
  character = experienceUpdate.character;
  events.push(...experienceUpdate.events);
  const claimedEvent: DomainEvent = {
    id: claimId,
    type: 'mission.reward_claimed',
    occurredAt: now,
    missionId: mission.id,
    periodKey: progress.periodKey,
  };
  const newEvents = [...events, claimedEvent].map((event) => ({ ...event, occurredAt: now }));
  const processed = new Set(state.processedEventIds);
  const accepted = newEvents.filter((event) => {
    if (processed.has(event.id)) return false;
    processed.add(event.id);
    return true;
  });

  return {
    ...state,
    character,
    missionClaims: [...(state.missionClaims ?? []), claimId],
    events: [...state.events, ...accepted],
    processedEventIds: [...state.processedEventIds, ...accepted.map((event) => event.id)],
  };
}
