import { describe, expect, it } from 'vitest';
import type { GameState } from './types';
import {
  cancelActiveSession,
  editQueuedSession,
  enqueueSession,
  getSessionProgress,
  reconcileSessions,
  reorderQueuedSession,
} from './session-engine';
import { createTestState, newTestSession, testCatalog } from '../test/fixtures';
import { loadContentPacks } from '../content/registry';
import { testPack } from '../test/fixtures';
import { equipConstruction, saveConstruction, unlockNodes } from '../nodes/library';
import type { NodeGraph } from '../nodes/graph';

describe('universal timed session engine', () => {
  it('starts a declarative activity and awards its saved result once after offline time', () => {
    const started = enqueueSession(createTestState(), newTestSession('s1'), testCatalog, 1_000);
    const completeAt = 1_000 + 1_800_000;
    const completed = reconcileSessions(started, completeAt, testCatalog);
    const reopened = reconcileSessions(completed, completeAt + 86_400_000, testCatalog);

    expect(started.queue).toEqual(['s1']);
    expect(started.sessions[0]?.status).toBe('active');
    expect(completed.queue).toEqual([]);
    expect(completed.sessions[0]?.status).toBe('completed');
    expect(completed.character?.inventory['iron-ore']).toBe(2);
    expect(completed.character?.experience).toEqual({ current: 20, total: 120 });
    expect(completed.character?.level).toBe(2);
    expect(reopened.character).toEqual(completed.character);
    expect(reopened.events).toEqual(completed.events);
    expect(completed.events.map((event) => event.type)).toEqual([
      'session.started',
      'session.completed',
      'reward.granted',
      'item.acquired',
      'experience.gained',
      'level.increased',
    ]);
  });

  it('simulates a Dungeon inside the existing session reconciliation and persists unique kill rewards', () => {
    const combatPack = {
      manifest: { id: 'test.dungeon', name: 'Test Dungeon', version: '1.0.0' },
      records: [
        {
          id: 'mining',
          kind: 'activity',
          name: 'Dungeon',
          description: '',
          rewardId: 'empty-reward',
          category: 'expedition',
          expeditionId: 'test:foundry',
        },
        {
          id: 'empty-reward',
          kind: 'reward',
          name: 'Empty',
          description: '',
          experience: 0,
          items: [],
        },
        {
          id: 'test:relic-drops',
          kind: 'loot_table',
          name: 'Relic drops',
          description: '',
          guaranteed: [{ itemId: 'iron-ore', quantity: 1 }],
        },
        {
          id: 'test:relic-guardian',
          kind: 'enemy',
          name: 'Relic Guardian',
          description: '',
          tags: ['base:construct'],
          lootTableId: 'test:relic-drops',
          experience: 9,
          attributes: {
            vigor: 1,
            resistance: 1,
            speed: 1,
            dexterity: 1,
            precision: 1,
            strength: 1,
          },
          hp: { current: 3, maximum: 3 },
          tenacity: { current: 0, maximum: 0 },
          energy: {},
          equipment: [],
          actions: [],
          effects: [],
          policy: { id: 'test:idle', rules: [] },
          actionPriority: [],
          mitigation: { physical: 0, magical: 0 },
          position: { x: 1, y: 0 },
        },
        {
          id: 'test:foundry',
          kind: 'expedition',
          name: 'Foundry',
          description: '',
          activityKind: 'dungeon',
          spawnIntervalMs: 60_000,
          deathRewardRetention: 0.25,
          environment: { type: 'cavern' },
          encounters: [{ id: 'guardian', enemyId: 'test:relic-guardian', weight: 1 }],
          nodeUnlocks: ['core:damage'],
        },
      ],
    };
    const content = loadContentPacks([testPack, combatPack]);
    const graph: NodeGraph = {
      schemaVersion: 1,
      id: 'test:heavy-strike',
      name: 'Heavy Strike',
      kind: 'ability',
      rootId: 'source',
      glyphIds: [],
      nodes: [
        { instanceId: 'source', definitionId: 'core:source-caster', children: ['type'] },
        { instanceId: 'type', definitionId: 'core:type-true', children: ['form'] },
        { instanceId: 'form', definitionId: 'core:form-weapon-strike', children: ['effect'] },
        {
          instanceId: 'effect',
          definitionId: 'core:effect-damage',
          children: [],
          parameters: { amount: 50 },
        },
      ],
    };
    const hero = createTestState().character!;
    const preparedHero = equipConstruction(
      saveConstruction(
        unlockNodes(
          hero,
          graph.nodes.map((node) => node.definitionId),
        ),
        graph,
        0,
      ),
      graph.id,
    );
    const state = {
      ...createTestState(),
      character: preparedHero,
      combatRecords: undefined as unknown as GameState['combatRecords'],
    };
    const started = enqueueSession(state, newTestSession('dungeon', 1_000), content, 0);
    const completed = reconcileSessions(started, 1_000, content);
    const record = (
      completed as GameState & {
        combatRecords?: Array<{
          kills: number;
          experience: number;
          drops: Array<{ rewardId: string }>;
        }>;
      }
    ).combatRecords?.[0];
    const reopened = reconcileSessions(completed, 86_401_000, content);

    expect(record).toMatchObject({ kills: 1, experience: 9 });
    expect(
      (record as NonNullable<GameState['combatRecords']>[number] | undefined)?.combats[0]?.log.find(
        (entry) => entry.actorId === 'player:character-1',
      )?.actionId,
    ).toBe(graph.id);
    expect(record?.drops).toHaveLength(1);
    expect(completed.character?.inventory['iron-ore']).toBe(1);
    expect(completed.character?.nodeLibrary?.unlockedNodeIds).toContain('core:damage');
    expect(completed.events.some((event) => event.type === 'expedition.completed')).toBe(true);
    expect(reopened.character).toEqual(completed.character);
    expect((reopened as GameState & { combatRecords?: unknown[] }).combatRecords).toEqual(
      (completed as GameState & { combatRecords?: unknown[] }).combatRecords,
    );

    const repeatedRecord = reconcileSessions(
      {
        ...started,
        combatRecords: (
          completed as GameState & { combatRecords?: NonNullable<GameState['combatRecords']> }
        ).combatRecords,
      },
      1_000,
      content,
    );
    expect(repeatedRecord.combatRecords).toHaveLength(1);
    const retainedRecords = reconcileSessions(
      {
        ...started,
        combatRecords: [{ id: 'older-run' } as NonNullable<GameState['combatRecords']>[number]],
      },
      1_000,
      content,
    );
    expect(retainedRecords.combatRecords).toHaveLength(2);
    const withoutExpedition = { ...content, expeditions: new Map(content.expeditions) };
    withoutExpedition.expeditions.delete('test:foundry');
    expect(() => reconcileSessions(started, 1_000, withoutExpedition)).toThrow(
      'Unknown expedition: test:foundry',
    );

    const legacyCharacter = {
      ...createTestState().character!,
      nodeLibrary: undefined,
    };
    const legacyState = { ...createTestState(), character: legacyCharacter };
    const legacyStarted = enqueueSession(
      legacyState,
      newTestSession('legacy-build', 1_000),
      content,
      0,
    );
    expect(() => reconcileSessions(legacyStarted, 1_000, content)).not.toThrow();
  });

  it('initializes combat history for legacy saves without a record field', () => {
    const initial = {
      ...createTestState(),
      combatRecords: undefined as unknown as GameState['combatRecords'],
    };
    const started = enqueueSession(initial, newTestSession('legacy', 100), testCatalog, 0);
    const completed = reconcileSessions(started, 100, testCatalog);
    expect(completed.combatRecords).toEqual([]);
  });

  it('accepts five total active and queued sessions and rejects a sixth', () => {
    let state: GameState = createTestState();
    for (let index = 1; index <= 5; index += 1) {
      state = enqueueSession(state, newTestSession(`s${index}`), testCatalog, index);
    }

    expect(state.queue).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(() => enqueueSession(state, newTestSession('s6'), testCatalog, 6)).toThrow(
      'A character can have at most five active or queued sessions.',
    );
  });

  it('keeps queued work sequential when multiple sessions finish offline', () => {
    const first = enqueueSession(createTestState(), newTestSession('s1', 100), testCatalog, 500);
    const second = enqueueSession(first, newTestSession('s2', 200), testCatalog, 600);
    const caughtUp = reconcileSessions(second, 900, testCatalog);

    expect(caughtUp.queue).toEqual([]);
    expect(
      caughtUp.sessions.map((session) => [session.id, session.status, session.startedAt]),
    ).toEqual([
      ['s1', 'completed', 500],
      ['s2', 'completed', 600],
    ]);
    expect(caughtUp.character?.inventory['iron-ore']).toBe(4);
  });

  it('cancels only the active unfinished result and starts the next session at cancellation time', () => {
    const first = enqueueSession(createTestState(), newTestSession('s1', 1_000), testCatalog, 100);
    const second = enqueueSession(first, newTestSession('s2', 1_000), testCatalog, 200);
    const cancelled = cancelActiveSession(second, 700);

    expect(cancelled.sessions.find((session) => session.id === 's1')?.status).toBe('cancelled');
    expect(cancelled.sessions.find((session) => session.id === 's2')).toMatchObject({
      status: 'active',
      startedAt: 700,
    });
    expect(cancelled.character?.inventory).toEqual({});
    expect(cancelled.events.map((event) => event.type)).toEqual([
      'session.started',
      'session.cancelled',
      'session.started',
    ]);
    expect(() => cancelActiveSession(createTestState(), 800)).toThrow(
      'There is no active session to cancel.',
    );
  });

  it('edits and reorders only queued sessions while keeping the active session fixed', () => {
    const first = enqueueSession(createTestState(), newTestSession('s1'), testCatalog, 0);
    const second = enqueueSession(first, newTestSession('s2', 500), testCatalog, 1);
    const third = enqueueSession(second, newTestSession('s3', 600), testCatalog, 2);
    const edited = editQueuedSession(third, 's2', { durationMs: 750 }, testCatalog);
    const reordered = reorderQueuedSession(edited, 's3', 1);

    expect(reordered.queue).toEqual(['s1', 's3', 's2']);
    expect(reordered.sessions.find((session) => session.id === 's2')?.durationMs).toBe(750);
    expect(() => editQueuedSession(reordered, 's1', { durationMs: 2 }, testCatalog)).toThrow(
      'Only queued sessions can be edited.',
    );
    expect(() =>
      editQueuedSession(reordered, 's2', { activityId: 'missing' }, testCatalog),
    ).toThrow('Unknown activity: missing');
    expect(() => editQueuedSession(reordered, 's2', { durationMs: 0 }, testCatalog)).toThrow(
      'Session duration must be a positive safe integer.',
    );
    expect(() => reorderQueuedSession(reordered, 's1', 1)).toThrow(
      'Only queued sessions can be reordered.',
    );
    expect(() => reorderQueuedSession(reordered, 's2', 0)).toThrow(
      'Queue position must be between 1 and 2.',
    );
    expect(() => reorderQueuedSession(reordered, 's2', 1.5)).toThrow(
      'Queue position must be between 1 and 2.',
    );
    expect(() => reorderQueuedSession({ ...reordered, queue: ['s1', 's3'] }, 's2', 1)).toThrow(
      'Only queued sessions can be reordered.',
    );
  });

  it('reports bounded progress from persisted timestamps and does not move backward', () => {
    const active = enqueueSession(createTestState(), newTestSession('s1', 1_000), testCatalog, 100);
    const session = active.sessions[0]!;

    expect(getSessionProgress(session, 50)).toEqual({ elapsedMs: 0, fraction: 0 });
    expect(getSessionProgress(session, 600)).toEqual({ elapsedMs: 500, fraction: 0.5 });
    expect(getSessionProgress(session, 2_000)).toEqual({ elapsedMs: 1_000, fraction: 1 });
    expect(getSessionProgress({ ...session, status: 'completed' }, 200)).toEqual({
      elapsedMs: 1_000,
      fraction: 1,
    });
    expect(getSessionProgress({ ...session, status: 'queued', startedAt: undefined }, 200)).toEqual(
      { elapsedMs: 0, fraction: 0 },
    );
  });

  it('does not grant partial work before completion and recovers a queued head after reopening', () => {
    const started = enqueueSession(createTestState(), newTestSession('s1', 100), testCatalog, 100);
    expect(reconcileSessions(started, 199, testCatalog)).toEqual(started);
    const queuedSave = {
      ...started,
      queue: ['s1'],
      sessions: [{ ...started.sessions[0]!, status: 'queued' as const, startedAt: undefined }],
    };
    const recovered = reconcileSessions(queuedSave, 500, testCatalog);

    expect(recovered.sessions[0]).toMatchObject({ status: 'active', startedAt: 500 });
  });

  it('leaves the character idle after reconciling an empty queue', () => {
    const state = {
      ...createTestState(),
      character: { ...createTestState().character!, activityState: 'active' as const },
    };
    expect(reconcileSessions(state, 0, testCatalog).character?.activityState).toBe('idle');
  });

  it('handles already-recorded start events and cancellation with no queued successor', () => {
    const base = createTestState();
    const knownEvent = { ...base, processedEventIds: ['s1:session.started'] };
    const started = enqueueSession(knownEvent, newTestSession('s1'), testCatalog, 100);
    expect(started.events).toEqual([]);
    const cancelled = cancelActiveSession(started, 200);
    expect(cancelled.queue).toEqual([]);

    const withoutCharacter = {
      ...enqueueSession(base, newTestSession('s2'), testCatalog, 100),
      character: null,
    };
    expect(cancelActiveSession(withoutCharacter, 200).character).toBeNull();
  });

  it('rejects a corrupt successor that is already active', () => {
    const first = enqueueSession(createTestState(), newTestSession('s1'), testCatalog, 100);
    const second = enqueueSession(first, newTestSession('s2'), testCatalog, 200);
    const invalid = {
      ...second,
      sessions: second.sessions.map((session) =>
        session.id === 's2' ? { ...session, status: 'active' as const } : session,
      ),
    };

    expect(() => cancelActiveSession(invalid, 300)).toThrow(
      'Session cannot start from status: active',
    );
  });

  it('validates duration, character, activity, ids, queue ordering, and recovery inputs', () => {
    const noCharacter = { ...createTestState(), character: null };
    expect(() => enqueueSession(noCharacter, newTestSession('s1'), testCatalog, 0)).toThrow(
      'A character is required before starting a session.',
    );
    expect(() =>
      enqueueSession(createTestState(), newTestSession('s1', 0), testCatalog, 0),
    ).toThrow('Session duration must be a positive safe integer.');
    expect(() =>
      enqueueSession(
        createTestState(),
        { ...newTestSession('s1'), activityId: 'missing' },
        testCatalog,
        0,
      ),
    ).toThrow('Unknown activity: missing');
    expect(() =>
      enqueueSession(createTestState(), { ...newTestSession('s1'), id: ' ' }, testCatalog, 0),
    ).toThrow('Session id cannot be empty.');
    const started = enqueueSession(createTestState(), newTestSession('s1'), testCatalog, 0);
    expect(() => enqueueSession(started, newTestSession('s1'), testCatalog, 1)).toThrow(
      'Session id already exists: s1',
    );
    expect(() =>
      enqueueSession(
        createTestState(),
        newTestSession('late', 100),
        testCatalog,
        Number.MAX_SAFE_INTEGER - 10,
      ),
    ).toThrow('Session end time exceeds the safe integer range.');
    expect(() => editQueuedSession(started, 'unknown', { durationMs: 1 }, testCatalog)).toThrow(
      'Unknown session: unknown',
    );
    expect(() => reorderQueuedSession(started, 'unknown', 1)).toThrow('Unknown session: unknown');
    expect(reconcileSessions({ ...started, queue: [] }, 10_000_000, testCatalog)).toMatchObject({
      queue: [],
    });
    expect(
      reconcileSessions({ ...started, character: null }, 10_000_000, testCatalog).character,
    ).toBeNull();
    expect(() => reconcileSessions(started, Number.NaN, testCatalog)).toThrow(
      'Current time must be a finite safe integer.',
    );
    expect(reconcileSessions({ ...started, queue: [''] }, 1, testCatalog).queue).toEqual(['']);
    const overflowingEnd = {
      ...started,
      sessions: [{ ...started.sessions[0]!, startedAt: Number.MAX_SAFE_INTEGER, durationMs: 1 }],
    };
    expect(() => reconcileSessions(overflowingEnd, Number.MAX_SAFE_INTEGER, testCatalog)).toThrow(
      'Session end time exceeds the safe integer range.',
    );
    expect(() => cancelActiveSession(started, Number.POSITIVE_INFINITY)).toThrow(
      'Current time must be a finite safe integer.',
    );
    expect(() =>
      reconcileSessions(
        { ...started, queue: ['s1'], sessions: [{ ...started.sessions[0]!, status: 'completed' }] },
        10_000_000,
        testCatalog,
      ),
    ).toThrow('Invalid queued session state: s1');
    expect(() =>
      reconcileSessions(started, 10_000_000, { ...testCatalog, activities: new Map() }),
    ).toThrow('Unknown activity: mining');
    expect(() =>
      reconcileSessions(started, 10_000_000, { ...testCatalog, rewards: new Map() }),
    ).toThrow('Unknown reward: mining-reward');
    expect(() => getSessionProgress(started.sessions[0]!, Number.NaN)).toThrow(
      'Current time must be a finite safe integer.',
    );
  });
});
