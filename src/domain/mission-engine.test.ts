import { describe, expect, it } from 'vitest';
import { loadContentPacks } from '../content/registry';
import { createTestState, testPack } from '../test/fixtures';
import type { GameState } from './types';
import { claimMission, getMissionProgress } from './mission-engine';

const missions = [
  {
    id: 'main',
    kind: 'mission',
    name: 'Main',
    description: 'Complete once.',
    cadence: 'main',
    eventType: 'session.completed',
    target: 1,
    reward: { experience: 0, items: {} },
  },
  {
    id: 'daily',
    kind: 'mission',
    name: 'Daily',
    description: 'Complete twice each day.',
    cadence: 'daily',
    eventType: 'session.completed',
    target: 2,
    reward: { experience: 40, items: { 'iron-ore': 1 } },
  },
  {
    id: 'weekly',
    kind: 'mission',
    name: 'Weekly',
    description: 'Complete three each week.',
    cadence: 'weekly',
    eventType: 'session.completed',
    target: 3,
    reward: { experience: 120, items: {} },
  },
];

const catalog = loadContentPacks([
  testPack,
  { manifest: { id: 'test.missions', name: 'Missions', version: '1.0.0' }, records: missions },
]);

function completedEvents(times: number[]) {
  return times.map((occurredAt, index) => ({
    id: `session-${index}:session.completed`,
    type: 'session.completed' as const,
    occurredAt,
    sessionId: `session-${index}`,
    activityId: 'mining',
  }));
}

describe('data-driven mission progress and reward claims', () => {
  it('counts main, daily, and weekly objectives within their UTC periods', () => {
    const state = {
      ...createTestState(),
      events: completedEvents([10, 20, 86_400_000, 604_800_000]),
    };
    expect(getMissionProgress(state, 'main', 100, catalog)).toMatchObject({
      progress: 1,
      target: 1,
      periodKey: 'main',
      complete: true,
    });
    expect(getMissionProgress(state, 'daily', 86_399_999, catalog)).toMatchObject({
      progress: 2,
      periodKey: '1970-01-01',
      complete: true,
    });
    expect(getMissionProgress(state, 'daily', 86_400_000, catalog).progress).toBe(1);
    expect(getMissionProgress(state, 'weekly', 345_599_999, catalog)).toMatchObject({
      progress: 3,
      periodKey: '1969-12-29',
    });
    expect(getMissionProgress(state, 'weekly', 604_800_000, catalog).periodKey).toBe('1970-01-05');
  });

  it('claims completed mission rewards once and persists the idempotency key', () => {
    const state: GameState = {
      ...createTestState(),
      events: completedEvents([10, 20]),
      missionClaims: [],
    };
    const claimed = claimMission(state, 'daily', 86_399_999, catalog);
    const reopened = JSON.parse(JSON.stringify(claimed)) as GameState;

    expect(claimed.character?.inventory['iron-ore']).toBe(1);
    expect(claimed.character?.experience.total).toBe(40);
    expect(claimed.missionClaims).toEqual(['daily@1970-01-01']);
    expect(claimed.events.filter((event) => event.type === 'mission.reward_claimed')).toHaveLength(
      1,
    );
    expect(getMissionProgress(reopened, 'daily', 50, catalog).claimed).toBe(true);
    expect(() => claimMission(reopened, 'daily', 50, catalog)).toThrow(
      'Mission reward was already claimed for this period.',
    );
  });

  it('reads legacy mission state without an explicit claims array', () => {
    const state = {
      ...createTestState(),
      events: completedEvents([10]),
      missionClaims: undefined,
    } as unknown as GameState;
    expect(getMissionProgress(state, 'main', 20, catalog)).toMatchObject({
      claimed: false,
      complete: true,
    });
  });

  it('handles zero-reward missions and completes the main objective without an XP event', () => {
    const state = { ...createTestState(), events: completedEvents([100]) };
    const claimed = claimMission(state, 'main', 100, catalog);
    expect(claimed.character?.experience.total).toBe(0);
    expect(claimed.character?.inventory).toEqual({});
    expect(claimed.events.at(-1)).toMatchObject({
      type: 'mission.reward_claimed',
      id: 'main@main',
      periodKey: 'main',
    });
  });

  it('claims a legacy completed mission without a claims array', () => {
    const state = {
      ...createTestState(),
      events: completedEvents([100]),
      missionClaims: undefined,
    } as unknown as GameState;
    const claimed = claimMission(state, 'main', 100, catalog);
    expect(claimed.missionClaims).toEqual(['main@main']);
  });

  it('rejects unavailable missions, incomplete claims, missing characters, and invalid timestamps', () => {
    const state = createTestState();
    expect(() => getMissionProgress(state, 'missing', 0, catalog)).toThrow(
      'Unknown mission: missing',
    );
    expect(() => getMissionProgress(state, 'main', -1, catalog)).toThrow(
      'Mission time must be a valid non-negative epoch timestamp.',
    );
    expect(() => getMissionProgress(state, 'main', Number.NaN, catalog)).toThrow(
      'Mission time must be a valid non-negative epoch timestamp.',
    );
    expect(() => claimMission(state, 'daily', 0, catalog)).toThrow(
      'Mission objective is not complete.',
    );
    const noCharacter = { ...state, character: null, events: completedEvents([1]) };
    expect(() => claimMission(noCharacter, 'main', 1, catalog)).toThrow(
      'A character is required to claim a mission reward.',
    );
    const invalidDate = { ...state, events: completedEvents([1]) };
    expect(() => getMissionProgress(invalidDate, 'main', 8.7e15, catalog)).toThrow(
      'Mission time must be a valid non-negative epoch timestamp.',
    );
  });

  it('does not append an event ID already present in the persisted event index', () => {
    const state = {
      ...createTestState(),
      events: completedEvents([10, 20]),
      processedEventIds: ['daily@1970-01-01:item:iron-ore'],
    };
    const claimed = claimMission(state, 'daily', 86_399_999, catalog);
    expect(claimed.character?.inventory['iron-ore']).toBe(1);
    expect(claimed.events.filter((event) => event.id.endsWith(':item:iron-ore'))).toHaveLength(0);
    expect(claimed.processedEventIds).toContain('daily@1970-01-01');
  });

  it('rejects duplicate claims already represented by the event journal', () => {
    const state: GameState = {
      ...createTestState(),
      events: [
        ...completedEvents([10, 20]),
        {
          id: 'daily@1970-01-01',
          type: 'mission.reward_claimed',
          occurredAt: 30,
          missionId: 'daily',
          periodKey: '1970-01-01',
        },
      ],
      missionClaims: [],
    };
    expect(() => claimMission(state, 'daily', 86_399_999, catalog)).toThrow(
      'Mission reward was already claimed for this period.',
    );
  });
});
