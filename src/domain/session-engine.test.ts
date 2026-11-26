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
import { loadContentPacks, loadOfficialContent } from '../content/registry';
import { testPack } from '../test/fixtures';
import { equipConstruction, saveConstruction, unlockNodes } from '../nodes/library';
import type { NodeGraph } from '../nodes/graph';
import { selectEnergyPath } from './mana-affinities';

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
      'attribute.points_awarded',
      'activity.completed',
    ]);
  });

  it('applies racial yields, skill progression, and Fragment earnings once per completed activity', () => {
    const content = loadContentPacks([
      testPack,
      {
        manifest: { id: 'test.progression', name: 'Progression Test', version: '1.0.0' },
        records: [
          {
            ...testPack.records[0],
            activityBonuses: [{ skillId: 'mining-skill', yieldMultiplier: 3 }],
          },
          {
            ...testPack.records[3],
            skillId: 'mining-skill',
            skillExperience: 250,
            fragmentReward: 7,
            outputItemId: 'iron-ore',
          },
        ],
      },
    ]);
    const initial = createTestState();
    initial.character!.extensions.unlockedRegions = [1, 'apexia'];
    const started = enqueueSession(initial, newTestSession('progression'), content, 0);
    const completed = reconcileSessions(started, 1_800_000, content);
    const reopened = reconcileSessions(completed, 3_600_000, content);

    expect(completed.character?.inventory['iron-ore']).toBe(6);
    expect(completed.character?.skills['mining-skill']).toMatchObject({ level: 3, experience: 50 });
    expect((completed.character?.extensions.wallet as Record<string, number>).fragments).toBe(7);
    expect(completed.events.map((event) => event.type)).toContain('activity.completed');
    expect(completed.events.map((event) => event.type)).toContain('currency.earned');
    expect(reopened.character).toEqual(completed.character);
    expect(reopened.events).toEqual(completed.events);
  });

  it('applies valid yield milestones while ignoring malformed or unrelated effects', () => {
    const content = loadContentPacks([
      {
        manifest: { id: 'test.yield-effects', name: 'Yield effects', version: '1.0.0' },
        records: testPack.records.map((record) => {
          if (record.id === 'mining')
            return { ...record, skillId: 'mining-skill', outputItemId: 'iron-ore' };
          if (record.id === 'mining-skill') {
            return {
              ...record,
              milestones: [
                {
                  level: 1,
                  name: 'Yield rules',
                  effects: [
                    { type: 'yield_multiplier', value: 2 },
                    { type: 'yield_multiplier', value: 'bad' },
                    { type: 'yield_multiplier', value: Number.POSITIVE_INFINITY },
                    { type: 'yield_multiplier', value: 0 },
                    { type: 'unrelated', value: 10 },
                  ],
                },
              ],
            };
          }
          return record;
        }),
      },
    ]);
    const started = enqueueSession(
      createTestState(),
      newTestSession('yield-rules', 10),
      content,
      0,
    );
    const completed = reconcileSessions(started, 10, content);
    expect(completed.character?.inventory['iron-ore']).toBe(4);
  });

  it('applies declared physical and energy training when offline sessions complete', () => {
    const content = loadContentPacks([
      testPack,
      {
        manifest: { id: 'test.training', name: 'Training', version: '1.0.0' },
        records: [
          {
            ...testPack.records[3],
            skillId: 'mining-skill',
            trainingEffect: { attributeId: 'energy:chi', amount: 2 },
          },
          {
            ...testPack.records[6],
            milestones: [
              { level: 1, name: 'Test discipline', effects: [{ type: 'training_gain', value: 3 }] },
            ],
          },
        ],
      },
    ]);
    const started = enqueueSession(createTestState(), newTestSession('training'), content, 0);
    const completed = reconcileSessions(started, 1_800_000, content);
    const reopened = reconcileSessions(completed, 3_600_000, content);
    expect(completed.character?.attributes.energetic.chi).toBe(6);
    expect(completed.events.map((event) => event.type)).toContain('attribute.increased');
    expect(reopened.character).toEqual(completed.character);
    expect(reopened.events).toEqual(completed.events);
  });

  it('cancels an offline Aura session when the character awakens Mana before settlement', () => {
    const content = loadOfficialContent();
    const initial = createTestState();
    const started = enqueueSession(
      initial,
      { id: 'path-change', activityId: 'meditate-aura', durationMs: 1_000 },
      content,
      0,
    );
    const awakened = {
      ...started,
      character: selectEnergyPath(started.character!, 'mana'),
    };

    const reconciled = reconcileSessions(awakened, 1_000, content);

    expect(reconciled.sessions[0]).toMatchObject({
      status: 'cancelled',
      finishedAt: 1_000,
    });
    expect(reconciled.queue).toEqual([]);
    expect(reconciled.character?.attributes.energetic.chi ?? 0).toBe(0);
    expect(reconciled.events.map((event) => event.type)).not.toContain('reward.granted');
    expect(reconciled.events).toContainEqual(
      expect.objectContaining({ type: 'session.cancelled', sessionId: 'path-change' }),
    );
  });

  it('doubles physical training gains for the Incomplete Sem Afinidade stage', () => {
    const official = loadOfficialContent();
    const content = loadContentPacks([
      {
        manifest: {
          id: 'test.unaffiliated-training',
          name: 'Sem Afinidade training',
          version: '1.0.0',
        },
        records: [
          ...testPack.records.map((record) =>
            record.id === 'mining'
              ? {
                  ...record,
                  trainingEffect: { attributeId: 'physical:strength', amount: 3 },
                }
              : record,
          ),
          official.energies.get('energy:unaffiliated')!,
        ],
      },
    ]);
    const initial = createTestState();
    initial.character!.energy = {
      affinity: 'unaffiliated',
      unaffiliatedStage: 'incomplete',
      reserves: {},
    };
    const started = enqueueSession(initial, newTestSession('unaffiliated-training'), content, 0);
    const completed = reconcileSessions(started, 1_800_000, content);

    expect(completed.character?.attributes.physical.strength).toBe(7);
    expect(completed.events).toContainEqual(
      expect.objectContaining({
        type: 'attribute.increased',
        attributeId: 'physical:strength',
        amount: 6,
        total: 7,
      }),
    );
  });

  it('uses the default training multiplier when an activity references an absent skill definition', () => {
    const activities = new Map(testCatalog.activities).set('mining', {
      ...testCatalog.activities.get('mining')!,
      skillId: 'missing-skill',
      skillExperience: 1,
      trainingEffect: { attributeId: 'energy:chi', amount: 3 },
    });
    const content = { ...testCatalog, activities };
    const started = enqueueSession(
      createTestState(),
      newTestSession('missing-skill-training', 10),
      content,
      0,
    );
    const completed = reconcileSessions(started, 10, content);
    expect(completed.character?.attributes.energetic.chi).toBe(3);
    expect(completed.character?.skills['missing-skill']?.experience).toBe(1);
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

  it('persists the soul anchor as broken after its one resurrection during an expedition', () => {
    const content = loadOfficialContent([
      {
        manifest: { id: 'test.soul-anchor', name: 'Soul Anchor', version: '1.0.0' },
        records: [
          {
            id: 'mining',
            kind: 'activity',
            name: 'Lethal expedition',
            description: '',
            rewardId: 'mining-iron',
            category: 'expedition',
            expeditionId: 'test:anchor-expedition',
          },
          {
            id: 'test:anchor-enemy',
            kind: 'enemy',
            name: 'Anchor Test Enemy',
            description: '',
            tags: [],
            experience: 1,
            attributes: {
              vigor: 10,
              resistance: 0,
              speed: 20,
              dexterity: 1,
              precision: 1,
              strength: 1,
            },
            hp: { current: 100, maximum: 100 },
            tenacity: { current: 0, maximum: 0 },
            energy: {},
            equipment: [],
            actions: [
              {
                id: 'test:lethal-hit',
                name: 'Lethal hit',
                kind: 'attack',
                target: 'enemy',
                intervalMs: 1_000,
                accuracy: 1,
                damage: {
                  amount: 10,
                  channel: 'physical',
                  subtype: 'crushing',
                  properties: [],
                  origin: { kind: 'ability', id: 'test:lethal-hit' },
                },
              },
            ],
            effects: [],
            policy: { id: 'test:lethal-policy', rules: [] },
            actionPriority: ['test:lethal-hit'],
            mitigation: { physical: 0, magical: 0 },
            position: { x: 1, y: 0 },
          },
          {
            id: 'test:anchor-expedition',
            kind: 'expedition',
            name: 'Anchor Test Expedition',
            description: '',
            activityKind: 'quest',
            spawnIntervalMs: 60_000,
            deathRewardRetention: 0.25,
            environment: {},
            encounters: [{ id: 'anchor', enemyId: 'test:anchor-enemy', weight: 1 }],
          },
        ],
      },
    ]);
    const character = {
      ...createTestState().character!,
      extensions: { installedImplants: ['implant-20'], alchemicalCapacity: 5 },
      attributes: {
        physical: { vigor: 1, resistance: 0, speed: 10, dexterity: 1, precision: 1, strength: 10 },
        energetic: {},
      },
    };
    const state = { ...createTestState(), character };
    const started = enqueueSession(state, newTestSession('anchor-session', 1_000), content, 0);
    const completed = reconcileSessions(started, 1_000, content);

    expect(completed.character?.extensions.brokenImplants).toEqual(['implant-20']);
    expect(completed.character?.extensions.combatHp).toBe(5);
    expect(
      completed.combatRecords?.[0]?.combats[0]?.log.some((entry) =>
        entry.effectsApplied.includes('soul-anchor:resurrected-and-broken'),
      ),
    ).toBe(true);

    const malformedCharacter = {
      ...character,
      extensions: { ...character.extensions, brokenImplants: [1] },
    };
    const malformedStarted = enqueueSession(
      { ...createTestState(), character: malformedCharacter },
      newTestSession('malformed-anchor', 1_000),
      content,
      0,
    );
    expect(() => reconcileSessions(malformedStarted, 1_000, content)).toThrow(
      'Character broken implant list is invalid.',
    );
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
    expect(getSessionProgress({ ...session, elapsedMs: 700 }, 500)).toEqual({
      elapsedMs: 700,
      fraction: 0.7,
    });
    expect(getSessionProgress({ ...session, status: 'queued', startedAt: undefined }, 200)).toEqual(
      { elapsedMs: 0, fraction: 0 },
    );
  });

  it('keeps active progress monotonic across clock rollback and restart, then completes once', () => {
    const started = enqueueSession(
      createTestState(),
      newTestSession('clock-safe', 1_000),
      testCatalog,
      100,
    );
    const checkpointed = reconcileSessions(started, 600, testCatalog);
    expect(checkpointed.sessions[0]).toMatchObject({
      status: 'active',
      startedAt: 100,
      elapsedMs: 500,
      lastObservedAt: 600,
    });

    const reopened = JSON.parse(JSON.stringify(checkpointed)) as GameState;
    const rolledBack = reconcileSessions(reopened, 250, testCatalog);
    expect(rolledBack.sessions[0]).toMatchObject({ elapsedMs: 500, lastObservedAt: 600 });
    expect(getSessionProgress(rolledBack.sessions[0]!, 250)).toEqual({
      elapsedMs: 500,
      fraction: 0.5,
    });

    const completed = reconcileSessions(rolledBack, 1_100, testCatalog);
    const rolledBackAgain = reconcileSessions(
      JSON.parse(JSON.stringify(completed)) as GameState,
      200,
      testCatalog,
    );
    expect(completed.sessions[0]).toMatchObject({ status: 'completed', elapsedMs: 1_000 });
    expect(rolledBackAgain.queue).toEqual([]);
    expect(rolledBackAgain.sessions[0]?.status).toBe('completed');
    expect(rolledBackAgain.character?.inventory['iron-ore']).toBe(2);
    expect(rolledBackAgain.events.filter((event) => event.type === 'reward.granted')).toHaveLength(
      1,
    );
    expect(rolledBackAgain.events).toEqual(completed.events);
  });

  it('hydrates an active legacy session without checkpoint fields', () => {
    const state = enqueueSession(
      createTestState(),
      newTestSession('legacy-active', 1_000),
      testCatalog,
      100,
    );
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    delete legacy.sessions[0]!.elapsedMs;
    delete legacy.sessions[0]!.lastObservedAt;

    const checkpointed = reconcileSessions(legacy, 600, testCatalog);
    expect(checkpointed.sessions[0]).toMatchObject({ elapsedMs: 500, lastObservedAt: 600 });
    expect(getSessionProgress({ ...checkpointed.sessions[0]!, elapsedMs: undefined }, 600)).toEqual(
      {
        elapsedMs: 500,
        fraction: 0.5,
      },
    );
  });

  it('discards stale queue references to completed and cancelled sessions without granting again', () => {
    const first = enqueueSession(
      createTestState(),
      newTestSession('terminal-completed', 10),
      testCatalog,
      100,
    );
    const second = enqueueSession(
      first,
      newTestSession('terminal-cancelled', 10),
      testCatalog,
      101,
    );
    const completed = reconcileSessions(first, 110, testCatalog);
    const staleQueue: GameState = {
      ...completed,
      queue: ['terminal-completed', 'terminal-cancelled'],
      sessions: [
        ...completed.sessions,
        {
          ...second.sessions.find((session) => session.id === 'terminal-cancelled')!,
          status: 'cancelled' as const,
        },
      ],
    };

    const reconciled = reconcileSessions(staleQueue, 50, testCatalog);
    expect(reconciled.queue).toEqual([]);
    expect(reconciled.character?.inventory['iron-ore']).toBe(2);
    expect(reconciled.events).toEqual(completed.events);
    expect(reconciled.processedEventIds).toEqual(completed.processedEventIds);
    expect(second.sessions.some((session) => session.status === 'active')).toBe(true);
  });

  it('treats persisted completion event IDs as authoritative during recovery', () => {
    const started = enqueueSession(
      createTestState(),
      newTestSession('event-checkpoint', 100),
      testCatalog,
      100,
    );
    const completedMarker: GameState = {
      ...started,
      processedEventIds: [
        ...started.processedEventIds,
        'event-checkpoint:session.completed',
        'event-checkpoint:reward.granted',
      ],
    };

    const recovered = reconcileSessions(completedMarker, 1_000, testCatalog);
    expect(recovered.queue).toEqual([]);
    expect(recovered.sessions[0]).toMatchObject({ status: 'completed', elapsedMs: 100 });
    expect(recovered.character?.inventory).toEqual({});
    expect(recovered.events).toEqual(started.events);
  });

  it('starts the queued successor when a persisted completion marker is recovered and rejects corrupt active state', () => {
    const first = enqueueSession(
      createTestState(),
      newTestSession('recover-first', 100),
      testCatalog,
      100,
    );
    const withNext = enqueueSession(first, newTestSession('recover-next', 100), testCatalog, 150);
    const marked = {
      ...withNext,
      processedEventIds: [...withNext.processedEventIds, 'recover-first:session.completed'],
    };
    const recovered = reconcileSessions(marked, 200, testCatalog);
    expect(recovered.queue).toEqual(['recover-next']);
    expect(recovered.sessions.find((session) => session.id === 'recover-next')).toMatchObject({
      status: 'active',
      startedAt: 200,
    });

    const invalid = {
      ...first,
      sessions: first.sessions.map((session) => ({
        ...session,
        status: 'active' as const,
        startedAt: undefined,
      })),
    };
    expect(() => reconcileSessions(invalid, 200, testCatalog)).toThrow(
      'Invalid queued session state: recover-first',
    );
  });

  it('does not reopen an event-committed session after the device clock rolls backward', () => {
    const started = enqueueSession(
      createTestState(),
      newTestSession('committed-before-rollback', 100),
      testCatalog,
      1_000,
    );
    const eventCommitted: GameState = {
      ...started,
      processedEventIds: [
        ...started.processedEventIds,
        'committed-before-rollback:session.completed',
      ],
      events: [
        ...started.events,
        {
          id: 'committed-before-rollback:session.completed',
          type: 'session.completed',
          occurredAt: 1_100,
          sessionId: 'committed-before-rollback',
          activityId: 'mining',
        },
      ],
    };
    const recovered = reconcileSessions(eventCommitted, 500, testCatalog);
    expect(recovered.sessions[0]).toMatchObject({ status: 'completed', elapsedMs: 100 });
    expect(recovered.queue).toEqual([]);
    expect(recovered.character?.inventory).toEqual(started.character?.inventory);
  });

  it('does not grant partial work before completion and recovers a queued head after reopening', () => {
    const started = enqueueSession(createTestState(), newTestSession('s1', 100), testCatalog, 100);
    expect(reconcileSessions(started, 199, testCatalog).sessions[0]).toMatchObject({
      status: 'active',
      elapsedMs: 99,
      lastObservedAt: 199,
    });
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

  it('uses the cancellation time for an active session with legacy or missing clock fields', () => {
    const started = enqueueSession(
      createTestState(),
      newTestSession('legacy-clock'),
      testCatalog,
      100,
    );
    const legacyClock = {
      ...started,
      sessions: [{ ...started.sessions[0]!, startedAt: undefined, lastObservedAt: undefined }],
    };

    expect(cancelActiveSession(legacyClock, 200).sessions[0]?.finishedAt).toBe(200);
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
    const staleTerminalReference = reconcileSessions(
      { ...started, queue: ['s1'], sessions: [{ ...started.sessions[0]!, status: 'completed' }] },
      10_000_000,
      testCatalog,
    );
    expect(staleTerminalReference.queue).toEqual([]);
    expect(staleTerminalReference.character?.inventory).toEqual({});
    expect(() =>
      reconcileSessions(started, 10_000_000, { ...testCatalog, activities: new Map() }),
    ).toThrow('Unknown activity: mining');
    expect(() =>
      reconcileSessions(started, 10_000_000, { ...testCatalog, rewards: new Map() }),
    ).toThrow('Unknown reward: mining-reward');
    expect(() => getSessionProgress(started.sessions[0]!, Number.NaN)).toThrow(
      'Current time must be a finite safe integer.',
    );
    const withQueued = enqueueSession(started, newTestSession('queued'), testCatalog, 1);
    expect(() =>
      editQueuedSession({ ...withQueued, character: null }, 'queued', {}, testCatalog),
    ).toThrow('A character is required before editing a session.');
    expect(() =>
      enqueueSession(
        started,
        { ...newTestSession('locked', 100), activityId: 'locked-activity' },
        {
          ...testCatalog,
          activities: new Map([
            ...testCatalog.activities,
            [
              'locked-activity',
              { ...testCatalog.activities.get('mining')!, id: 'locked-activity', requiredLevel: 2 },
            ],
          ]),
        },
        10,
      ),
    ).toThrow('Activity requires character level 2.');
    const lockedContent = {
      ...testCatalog,
      activities: new Map([
        ...testCatalog.activities,
        [
          'locked-activity',
          { ...testCatalog.activities.get('mining')!, id: 'locked-activity', requiredLevel: 2 },
        ],
      ]),
    };
    expect(() =>
      editQueuedSession(withQueued, 'queued', { activityId: 'locked-activity' }, lockedContent),
    ).toThrow('Activity requires character level 2.');
  });

  it('rejects invalid generated reward quantities and repeated item overflow', () => {
    const activity = { ...testCatalog.activities.get('mining')!, outputItemId: 'iron-ore' };
    const activities = new Map(testCatalog.activities).set('mining', activity);
    const original = testCatalog.rewards.get('mining-reward')!;
    const invalidReward = { ...original, items: [{ itemId: 'iron-ore', quantity: 0 }] };
    const invalidContent = {
      ...testCatalog,
      activities,
      rewards: new Map(testCatalog.rewards).set('mining-reward', invalidReward),
    };
    const invalidStarted = enqueueSession(
      createTestState(),
      newTestSession('invalid-output', 10),
      invalidContent,
      0,
    );
    expect(() => reconcileSessions(invalidStarted, 10, invalidContent)).toThrow(
      'Activity output is invalid for iron-ore.',
    );

    const overflowingReward = {
      ...original,
      items: [
        { itemId: 'iron-ore', quantity: Number.MAX_SAFE_INTEGER },
        { itemId: 'iron-ore', quantity: 1 },
      ],
    };
    const overflowContent = {
      ...testCatalog,
      activities,
      rewards: new Map(testCatalog.rewards).set('mining-reward', overflowingReward),
    };
    const overflowStarted = enqueueSession(
      createTestState(),
      newTestSession('overflow-output', 10),
      overflowContent,
      0,
    );
    expect(() => reconcileSessions(overflowStarted, 10, overflowContent)).toThrow(
      'Activity output exceeds the safe integer range for iron-ore.',
    );
  });
});
