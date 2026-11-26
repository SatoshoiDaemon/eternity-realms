Warning: truncated output (original token count: 29588)
Total output lines: 3667

import { describe, expect, it } from 'vitest';
import type { CombatActor, CombatAction } from './types';
import { advanceCombat, createCombatState } from './combat-engine';
import { BASE_ENEMY_TAGS, loadTagRegistry } from './tag-registry';
import { loadOfficialContent } from '../content/registry';

const strike: CombatAction = {
  id: 'base:strike',
  name: 'Strike',
  kind: 'attack',
  target: 'enemy',
  intervalMs: 1_000,
  accuracy: 1,
  damage: {
    amount: 40,
    channel: 'physical',
    subtype: 'crushing',
    properties: [],
    origin: { kind: 'ability', id: 'base:strike' },
  },
};

function actor(
  id: string,
  side: 'party' | 'enemy',
  overrides: Partial<CombatActor> = {},
): CombatActor {
  return {
    id,
    name: id,
    speciesId: `${side}:test`,
    tags: [],
    side,
    attributes: { vigor: 10, resistance: 0, speed: 10, dexterity: 10, precision: 10, strength: 10 },
    hp: { current: 100, maximum: 100 },
    tenacity: { current: 0, maximum: 0 },
    energy: {},
    equipment: [],
    actions: [strike],
    effects: [],
    policy: { id: 'base:default', rules: [] },
    actionPriority: ['base:strike'],
    mitigation: { physical: 0, magical: 0 },
    position: { x: side === 'party' ? 0 : 1, y: 0 },
    nextEventAt: 0,
    state: 'ready',
    ...overrides,
  };
}

describe('deterministic event combat', () => {
  it.each(['physical', 'magical', 'true'] as const)(
    'applies universal Sem Afinidade reduction to %s damage',
    (channel) => {
      const action: CombatAction = {
        ...strike,
        id: `test:${channel}-damage`,
        damage: { ...strike.damage!, channel },
      };
      const state = createCombatState(
        `universal-reduction:${channel}`,
        [
          actor('attacker', 'party', { actions: [action], actionPriority: [action.id] }),
          actor('defender', 'enemy', { actions: [], damageReduction: 0.2 }),
        ],
        4,
      );
      const resolved = advanceCombat(state, 0);
      expect(resolved.log.find((entry) => entry.actorId === 'attacker')).toMatchObject({
        damageInitial: 40,
        damageFinal: 32,
        modifiers: expect.arrayContaining([
          expect.objectContaining({ id: 'universal-damage-reduction', value: 0.2 }),
        ]),
      });
    },
  );

  it('rejects invalid universal actor damage reduction', () => {
    for (const damageReduction of [-0.1, 1, Number.NaN]) {
      expect(() =>
        createCombatState(
          `invalid-reduction:${damageReduction}`,
          [actor('invalid', 'party', { damageReduction }), actor('target', 'enemy')],
          4,
        ),
      ).toThrow('damage reduction must be between zero and one.');
    }
  });

  it('applies an Oni racial trait as a fixed ten HP heal after each successful hit', () => {
    const content = loadOfficialContent();
    const oni = actor('oni', 'party', {
      hp: { current: 80, maximum: 100 },
      tags: ['race:oni'],
    });
    const state = createCombatState('oni-feeding', [oni, actor('victim', 'enemy')], 21, {}, [
      ...content.enemyTags.values(),
    ]);

    const result = advanceCombat(state, 0);
    expect(result.actors.find((entry) => entry.id === 'oni')?.hp.current).toBe(50);
    expect(result.actors.find((entry) => entry.id === 'oni')?.effects).toContainEqual(
      expect.objectContaining({ id: 'core:haste', potency: 2, counter: 1 }),
    );
    expect(result.log.find((entry) => entry.actorId === 'oni')?.effectsApplied).toContain(
      'flat_vampirism:10',
    );
  });

  it('grants an Oni Pressa 4/4 after striking a bleeding target', () => {
    const content = loadOfficialContent();
    const oni = actor('oni', 'party', { tags: ['race:oni'] });
    const bleedingTarget = actor('victim', 'enemy', {
      actions: [],
      effects: [{ id: 'core:bleeding', category: 'dot', potency: 1, counter: 3 }],
    });
    const result = advanceCombat(
      createCombatState('oni-predator-bleeding-target', [oni, bleedingTarget], 23, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'oni')?.effects).toContainEqual(
      expect.objectContaining({ id: 'core:haste', potency: 4, counter: 4 }),
    );
  });

  it('rejects an on-hit status when the attacker has a matching immunity', () => {
    const content = loadOfficialContent();
    const selfPoisonTag = {
      id: 'test:self-poison-on-hit',
      category: 'behavior' as const,
      name: 'Self poisoning on hit',
      description: 'Test tag for the attacker immunity path.',
      origin: 'test',
      activationConditions: ['successful hit'],
      eventsObserved: ['damage.dealt'],
      modifiers: [
        {
          id: 'self-poison',
          event: 'damage.dealt',
          conditions: [],
          interactionId: 'test:self-poison',
          potency: 1,
          priority: 100,
          effect: {
            type: 'on_hit_effect' as const,
            value: { id: 'base:poison', category: 'dot', potency: 1, counter: 2 },
          },
        },
      ],
      interactions: [{ id: 'self-poison', counterplay: 'test' }],
      requirements: [],
      properties: [],
    };
    const attacker = actor('toxic-attacker', 'party', {
      tags: ['base:toxic', selfPoisonTag.id],
    });
    const victim = actor('victim', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('immune-on-hit-status', [attacker, victim], 31, {}, [
        ...content.enemyTags.values(),
        selfPoisonTag,
      ]),
      0,
    );

    expect(
      result.actors
        .find((entry) => entry.id === 'toxic-attacker')
        ?.effects.some((effect) => effect.id === 'base:poison'),
    ).toBe(false);
  });

  it.each([
    { hp: 80, bleeding: false, expectedHp: 90, label: 'base healing' },
    { hp: 80, bleeding: true, expectedHp: 100, label: 'a bleeding target' },
    { hp: 75, bleeding: false, expectedHp: 100, label: '25% HP lost' },
    { hp: 40, bleeding: false, expectedHp: 90, label: '50% HP lost' },
    { hp: 10, bleeding: false, expectedHp: 90, label: '10% HP remaining' },
    { hp: 20, bleeding: true, expectedHp: 70, label: 'overlapping conditions' },
  ])('scales Oni Fome Eterna healing for $label', ({ hp, bleeding, expectedHp }) => {
    const content = loadOfficialContent();
    const oni = actor('oni', 'party', {
      tags: ['race:oni'],
      hp: { current: hp, maximum: 100 },
    });
    const victim = actor('victim', 'enemy', {
      actions: [],
      effects: bleeding ? [{ id: 'core:bleeding', category: 'dot', potency: 1, counter: 2 }] : [],
    });
    const result = advanceCombat(
      createCombatState(`oni-fome-eterna:${hp}:${bleeding}`, [oni, victim], 29, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'oni')?.hp.current).toBe(expectedHp);
  });

  it('doubles received debuff duration for Nephalem without extending buffs', () => {
    const content = loadOfficialContent();
    const race = content.races.get('nephalem')!;
    const nephalem = actor('z-nephalem', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const incoming: CombatAction = {
      id: 'test:debuff-and-buff',
      name: 'Debuff and buff',
      kind: 'support',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
      effects: [
        { id: 'core:fragile', category: 'debuff', potency: 2, counter: 2, expiresAt: 2_000 },
        { id: 'core:attack-increase', category: 'buff', potency: 2, counter: 2 },
      ],
    };
    const attacker = actor('a-attacker', 'enemy', {
      actions: [incoming],
      actionPriority: [incoming.id],
    });
    const result = advanceCombat(
      createCombatState('nephalem-debuff-duration', [attacker, nephalem], 37, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );
    const effects = result.actors.find((entry) => entry.id === 'z-nephalem')?.effects;

    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:fragile', counter: 4, expiresAt: 4_000 }),
        expect.objectContaining({ id: 'core:attack-increase', counter: 2, expiresAt: 2_000 }),
      ]),
    );
  });

  it.each(['enemy', 'lowest_enemy_hp'] as const)(
    'prioritizes Nephalem for enemy attacks targeting %s',
    (target) => {
      const content = loadOfficialContent();
      const race = content.races.get('nephalem')!;
      const attack: CombatAction = { ...strike, id: 'test:locked-strike', target };
      const attacker = actor('a-attacker', 'enemy', {
        actions: [attack],
        actionPriority: [attack.id],
      });
      const decoy = actor('a-decoy', 'party', {
        hp: { current: 10, maximum: 100 },
        actions: [],
      });
      const nephalem = actor('z-nephalem', 'party', {
        tags: [...(race.combatTags ?? []), race.combatTag!.id],
        actions: [],
      });
      const result = advanceCombat(
        createCombatState(
          `nephalem-target-priority:${target}`,
          [attacker, decoy, nephalem],
          43,
          {},
          [...content.enemyTags.values()],
        ),
        0,
      );

      expect(result.actors.find((entry) => entry.id === 'z-nephalem')?.hp.current).toBe(60);
      expect(result.actors.find((entry) => entry.id === 'a-decoy')?.hp.current).toBe(10);
    },
  );

  it('keeps normal duration when an incoming-status tag grants another effect type', () => {
    const content = loadOfficialContent();
    const tagId = 'race:test-status-immunity';
    const tagRegistry = loadTagRegistry([
      ...content.enemyTags.values(),
      {
        id: tagId,
        category: 'behavior',
        name: 'Status observer',
        description: 'Test-only status rule.',
        origin: 'test',
        activationConditions: [],
        eventsObserved: ['status.incoming'],
        modifiers: [
          {
            id: `${tagId}:rule`,
            event: 'status.incoming',
            conditions: [{ path: 'status.category', op: 'eq', value: 'debuff' }],
            interactionId: `${tagId}:interaction`,
            potency: 1,
            priority: 0,
            effect: { type: 'status_immunity', value: 'core:poison' },
          },
        ],
        interactions: [{ id: `${tagId}:interaction`, counterplay: 'test' }],
        requirements: [],
        properties: [],
      },
    ]);
    const incoming: CombatAction = {
      id: 'test:debuff',
      name: 'Debuff',
      kind: 'support',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
      effects: [{ id: 'core:fragile', category: 'debuff', potency: 2, counter: 2 }],
    };
    const attacker = actor('a-attacker', 'party', {
      actions: [incoming],
      actionPriority: [incoming.id],
    });
    const observer = actor('z-observer', 'enemy', { tags: [tagId], actions: [] });
    const result = advanceCombat(
      createCombatState('non-duration-status-rule', [attacker, observer], 41, {}, tagRegistry),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'z-observer')?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'core:fragile', counter: 2 })]),
    );
  });

  it('doubles Burn duration applied by an Angel', () => {
    const content = loadOfficialContent();
    const race = content.races.get('angel')!;
    const angel = actor('a-angel', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [
        {
          id: 'test:burn',
          name: 'Burn',
          kind: 'support',
          target: 'enemy',
          intervalMs: 1_000,
          accuracy: 1,
          effects: [{ id: 'core:burn', category: 'dot', potency: 2, counter: 2 }],
        },
      ],
      actionPriority: ['test:burn'],
    });
    const target = actor('z-target', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('angel-halo-burn-duration', [angel, target], 47, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'z-target')?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:burn', counter: 4, expiresAt: 4_000 }),
      ]),
    );
  });

  it('halves received Painful Wounds potency and duration for an Angel', () => {
    const content = loadOfficialContent();
    const race = content.races.get('angel')!;
    const angel = actor('z-angel', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const attack: CombatAction = {
      id: 'test:painful-wounds',
      name: 'Painful Wounds',
      kind: 'support',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
      effects: [
        { id: 'core:painful-wounds', category: 'debuff', potency: 4, counter: 3, expiresAt: 3_000 },
      ],
    };
    const attacker = actor('a-attacker', 'enemy', {
      actions: [attack],
      actionPriority: [attack.id],
    });
    const result = advanceCombat(
      createCombatState('angel-genesi-painful-wounds', [attacker, angel], 49, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'z-angel')?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'core:painful-wounds',
          potency: 2,
          counter: 1.5,
          expiresAt: 1_500,
        }),
      ]),
    );
  });

  it.each(['heal', 'buff'] as const)(
    'grants Genesi blessings to both participants after an Angel %s action',
    (trigger) => {
      const content = loadOfficialContent();
      const race = content.races.get('angel')!;
      const action: CombatAction =
        trigger === 'heal'
          ? {
              id: 'test:angel-heal',
              name: 'Heal',
              kind: 'heal',
              target: 'ally',
              intervalMs: 1_000,
              accuracy: 1,
              healing: 5,
            }
          : {
              id: 'test:angel-buff',
              name: 'Support buff',
              kind: 'support',
              target: 'ally',
              intervalMs: 1_000,
              accuracy: 1,
              effects: [{ id: 'core:attack-increase', category: 'buff', potency: 1, counter: 2 }],
            };
      const angel = actor('a-angel', 'party', {
        tags: [...(race.combatTags ?? []), race.combatTag!.id],
        actions: [action],
        actionPriority: [action.id],
        hp: { current: 80, maximum: 100 },
      });
      const ally = actor('b-ally', 'party', { hp: { current: 80, maximum: 100 }, actions: [] });
      const enemy = actor('z-enemy', 'enemy', { actions: [] });
      const result = advanceCombat(
        createCombatState(`angel-genesi-support:${trigger}`, [angel, ally, enemy], 53, {}, [
          ...content.enemyTags.values(),
        ]),
        0,
      );

      for (const recipientId of ['a-angel', 'b-ally']) {
        const effects = result.actors.find((entry) => entry.id === recipientId)?.effects;
        expect(effects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'core:blessing', potency: 4, counter: 1 }),
            expect.objectContaining({ id: 'core:protection', potency: 4, counter: 1 }),
          ]),
        );
      }
    },
  );

  it('grants a single set of Genesi buffs when an Angel heals itself', () => {
    const content = loadOfficialContent();
    const race = content.races.get('angel')!;
    const healing: CombatAction = {
      id: 'test:angel-self-heal',
      name: 'Self heal',
      kind: 'heal',
      target: 'self',
      intervalMs: 1_000,
      accuracy: 1,
      healing: 5,
    };
    const angel = actor('a-angel', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [healing],
      actionPriority: [healing.id],
      hp: { current: 80, maximum: 100 },
    });
    const enemy = actor('z-enemy', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('angel-genesi-self-heal', [angel, enemy], 61, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );
    const effects = result.actors.find((entry) => entry.id === 'a-angel')?.effects;

    expect(effects?.filter((effect) => effect.id === 'core:blessing')).toHaveLength(1);
    expect(effects?.filter((effect) => effect.id === 'core:protection')).toHaveLength(1);
  });

  it('respects support-status immunity, preserves equal buffs, and ignores other reaction types', () => {
    const content = loadOfficialContent();
    const race = content.races.get('angel')!;
    const immunityTagId = 'test:support-blessing-immunity';
    const reactionTagId = 'test:support-other-reaction';
    const tagRegistry = loadTagRegistry([
      ...content.enemyTags.values(),
      {
        id: immunityTagId,
        category: 'behavior',
        name: 'Blessing resistance',
        description: 'Rejects Blessing.',
        origin: 'test',
        activationConditions: [],
        eventsObserved: ['status.incoming'],
        modifiers: [
          {
            id: `${immunityTagId}:rule`,
            event: 'status.incoming',
            conditions: [{ path: 'status.id', op: 'eq', value: 'core:blessing' }],
            interactionId: `${immunityTagId}:interaction`,
            potency: 1,
            priority: 0,
            effect: { type: 'status_immunity', value: 'core:blessing' },
          },
        ],
        interactions: [{ id: `${immunityTagId}:interaction`, counterplay: 'test' }],
        requirements: [],
        properties: [],
      },
      {
        id: reactionTagId,
        category: 'behavior',
        name: 'Other support reaction',
        description: 'A different support event effect type.',
        origin: 'test',
        activationConditions: [],
        eventsObserved: ['support.completed'],
        modifiers: [
          {
            id: `${reactionTagId}:rule`,
            event: 'support.completed',
            conditions: [],
            interactionId: `${reactionTagId}:interaction`,
            potency: 1,
            priority: 0,
            effect: { type: 'regeneration', value: 3 },
          },
        ],
        interactions: [{ id: `${reactionTagId}:interaction`, counterplay: 'test' }],
        requirements: [],
        properties: [],
      },
    ]);
    const healing: CombatAction = {
      id: 'test:angel-heal',
      name: 'Heal',
      kind: 'heal',
      target: 'ally',
      intervalMs: 1_000,
      accuracy: 1,
      healing: 5,
    };
    const angel = actor('a-angel', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id, reactionTagId],
      actions: [healing],
      actionPriority: [healing.id],
      hp: { current: 80, maximum: 100 },
      effects: [
        { id: 'core:blessing', category: 'buff', potency: 4, counter: 1 },
        { id: 'core:protection', category: 'buff', potency: 4, counter: 1 },
      ],
    });
    const ally = actor('b-ally', 'party', {
      tags: [immunityTagId],
      hp: { current: 80, maximum: 100 },
      actions: [],
    });
    const enemy = actor('z-enemy', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('angel-genesi-support-edges', [angel, ally, enemy], 67, {}, tagRegistry),
      0,
    );
    const angelEffects = result.actors.find((entry) => entry.id === 'a-angel')?.effects;
    const allyEffects = result.actors.find((entry) => entry.id === 'b-ally')?.effects;

    expect(angelEffects?.filter((effect) => effect.id === 'core:blessing')).toHaveLength(1);
    expect(angelEffects?.filter((effect) => effect.id === 'core:protection')).toHaveLength(1);
    expect(allyEffects?.some((effect) => effect.id === 'core:blessing')).toBe(false);
    expect(allyEffects?.some((effect) => effect.id === 'core:protection')).toBe(true);
    expect(allyEffects?.some((effect) => effect.id === 'test:support-other-reaction')).toBe(false);
  });

  it('adds three Genesi regeneration levels per resolved Angel turn', () => {
    const content = loadOfficialContent();
    const race = content.races.get('angel')!;
    const angel = actor('a-angel', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      hp: { current: 80, maximum: 100 },
    });
    const enemy = actor('z-enemy', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('angel-genesi-regeneration', [angel, enemy], 59, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'a-angel')?.hp.current).toBe(83);
  });

  it.each(['core:poison', 'core:bleeding'])(
    'Slime rejects the %s status through its racial physiology',
    (statusId) => {
      const content = loadOfficialContent();
      const race = content.races.get('slime')!;
      const slime = actor('z-slime', 'party', {
        tags: [...(race.combatTags ?? []), race.combatTag!.id],
        actions: [],
      });
      const application: CombatAction = {
        id: `test:apply-${statusId}`,
        name: 'Apply status',
        kind: 'support',
        target: 'enemy',
        intervalMs: 1_000,
        accuracy: 1,
        effects: [{ id: statusId, category: 'dot', potency: 2, counter: 3 }],
      };
      const attacker = actor('a-attacker', 'enemy', {
        actions: [application],
        actionPriority: [application.id],
      });
      const result = advanceCombat(
        createCombatState(`slime-immunity:${statusId}`, [attacker, slime], 71, {}, [
          ...content.enemyTags.values(),
        ]),
        0,
      );

      expect(result.actors.find((entry) => entry.id === 'z-slime')?.effects).not.toContainEqual(
        expect.objectContaining({ id: statusId }),
      );
    },
  );

  it('Slime doubles Burn potency and keeps Burn and Freeze until explicitly removed', () => {
    const content = loadOfficialContent();
    const race = content.races.get('slime')!;
    const slime = actor('z-slime', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const application: CombatAction = {
      id: 'test:apply-slime-elements',
      name: 'Apply statuses',
      kind: 'support',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
      effects: [
        { id: 'core:burn', category: 'dot', potency: 2, counter: 1 },
        { id: 'core:freeze', category: 'control', potency: 1, counter: 1 },
      ],
    };
    const attacker = actor('a-attacker', 'enemy', {
      actions: [application],
      actionPriority: [application.id],
    });
    const result = advanceCombat(
      createCombatState('slime-elemental-reaction', [attacker, slime], 73, {}, [
        ...content.enemyTags.values(),
      ]),
      4_000,
    );
    const effects = result.actors.find((entry) => entry.id === 'z-slime')?.effects;

    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:burn', potency: 4, counter: 0, expiresAt: undefined }),
        expect.objectContaining({ id: 'core:freeze', counter: 0, expiresAt: undefined }),
      ]),
    );
  });

  it('preserves Slime Burn and Freeze statuses already present at combat start', () => {
    const content = loadOfficialContent();
    const race = content.races.get('slime')!;
    const slime = actor('a-slime', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      effects: [
        { id: 'core:burn', category: 'dot', potency: 2, counter: 4, expiresAt: 4_000 },
        { id: 'core:freeze', category: 'control', potency: 1, counter: 2, expiresAt: 2_000 },
      ],
    });
    const state = createCombatState(
      'slime-persistent-start-status',
      [slime, actor('z-enemy', 'enemy')],
      74,
      {},
      [...content.enemyTags.values()],
    );
    const effects = state.actors.find((entry) => entry.id === 'a-slime')?.effects;

    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:burn', counter: 0, expiresAt: undefined }),
        expect.objectContaining({ id: 'core:freeze', counter: 0, expiresAt: undefined }),
      ]),
    );
  });

  it('applies acidic poison and Fragile when a Slime is struck in melee', () => {
    const content = loadOfficialContent();
    const race = content.races.get('slime')!;
    const attacker = actor('a-attacker', 'party', { actions: [strike] });
    const slime = actor('z-slime', 'enemy', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const result = advanceCombat(
      createCombatState('slime-acid-contact', [attacker, slime], 83, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'a-attacker')?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:poison', potency: 15, counter: 1 }),
        expect.objectContaining({ id: 'core:fragile', potency: 7, counter: 3 }),
      ]),
    );
  });

  it('does not transmit acid effects to ranged attackers who never touch the Slime', () => {
    const content = loadOfficialContent();
    const race = content.races.get('slime')!;
    const ranged: CombatAction = {
      ...strike,
      id: 'test:ranged-strike',
      name: 'Ranged strike',
      kind: 'ranged',
    };
    const attacker = actor('a-attacker', 'party', {
      actions: [ranged],
      actionPriority: [ranged.id],
    });
    const slime = actor('z-slime', 'enemy', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const result = advanceCombat(
      createCombatState('slime-ranged-counterplay', [attacker, slime], 87, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'a-attacker')?.effects).toEqual([]);
  });

  it('adds four regeneration levels per resolved Slime turn', () => {
    const content = loadOfficialContent();
    const race = content.races.get('slime')!;
    const slime = actor('a-slime', 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      hp: { current: 80, maximum: 100 },
    });
    const enemy = actor('z-enemy', 'enemy', { actions: [] });
    const result = advanceCombat(
      createCombatState('slime-regeneration', [slime, enemy], 89, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === 'a-slime')?.hp.current).toBe(84);
  });

  it('prevents Ghosts from choosing ordinary physical attacks but permits spiritual attacks', () => {
    const content = loadOfficialContent();
    const race = content.races.get('ghost')!;
    const tags = [...(race.combatTags ?? []), race.combatTag!.id];
    const ordinary = actor('a-ghost', 'party', { tags, actions: [strike] });
    const ordinaryResult = advanceCombat(
      createCombatState(
        'ghost-physical-anchor',
        [ordinary, actor('z-target', 'enemy', { actions: [] })],
        101,
        {},
        [...content.enemyTags.values()],
      ),
      0,
    );
    expect(ordinaryResult.actors.find((entry) => entry.id === 'z-target')?.hp.current).toBe(100);

    for (const property of ['spiritual', 'telekinetic']) {
      const empowered: CombatAction = {
        ...strike,
        id: `test:${property}-attack`,
        properties: [property],
      };
      const empoweredGhost = actor('a-ghost', 'party', {
        tags,
        actions: [empowered],
        actionPriority: [empowered.id],
      });
      const empoweredResult = advanceCombat(
        createCombatState(
          `ghost-${property}-attack`,
          [empoweredGhost, actor('z-target', 'enemy', { actions: [] })],
          property === 'spiritual' ? 103 : 105,
          {},
          [...content.enemyTags.values()],
        ),
        0,
      );
      expect(empoweredResult.actors.find((entry) => entry.id === 'z-target')?.hp.current).toBe(60);
    }
  });

  it.each(['core:confusion', 'core:exhaustion', 'core:haste'])(
    'applies the Dwarf racial immunity to %s without granting immunity to other statuses',
    (statusId) => {
      const content = loadOfficialContent();
      const dwarfRace = content.races.get('dwarf')!;
      const dwarf = actor('z-dwarf', 'party', {
        tags: [dwarfRace.combatTag!.id],
        actions: [],
      });
      const incoming: CombatAction = {
        id: 'test:apply-dwarf-status',
        name: 'Status test',
        kind: 'support',
        target: 'enemy',
        intervalMs: 1_000,
        accuracy: 1,
        effects: [
          {
            id: statusId,
            category:
              statusId === 'core:haste'
                ? 'buff'
                : statusId === 'core:exhaustion'
                  ? 'debuff'
                  : 'control',
            potency: 1,
            counter: 2,
          },
          { id: 'core:poison', category: 'dot', potency: 1, counter: 2 },
        ],
      };
      const attacker = actor('a-attacker', 'enemy', {
        actions: [incoming],
        actionPriority: [incoming.id],
      });
      const result = advanceCombat(
        createCombatState('dwarf-status-immunity', [attacker, dwarf], 17, {}, [
          ...content.enemyTags.values(),
        ]),
        0,
      );

      expect(result.actors.find((entry) => entry.id === 'z-dwarf')?.effects).toEqual([
        expect.objectContaining({ id: 'core:poison' }),
      ]);
    },
  );

  it.each([
    ['doll', 'core:confusion'],
    ['doll', 'core:charm'],
    ['giant', 'core:haste'],
  ])('applies the %s racial status immunity to %s', (raceId, statusId) => {
    const content = loadOfficialContent();
    const race = content.races.get(raceId)!;
    const target = actor(`z-${raceId}`, 'party', {
      tags: [...(race.combatTags ?? []), race.combatTag!.id],
      actions: [],
    });
    const incoming: CombatAction = {
      id: 'test:apply-racial-status',
      name: 'Status test',
      kind: 'support',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
      effects: [
        {
          id: statusId,
          category: statusId === 'core:haste' ? 'buff' : 'control',
          potency: 1,
          counter: 2,
        },
        { id: 'core:poison', category: 'dot', potency: 1, counter: 2 },
      ],
    };
    const attacker = actor('a-attacker', 'enemy', {
      actions: [incoming],
      actionPriority: [incoming.id],
    });
    const result = advanceCombat(
      createCombatState(`racial-immunity:${raceId}:${statusId}`, [attacker, target], 19, {}, [
        ...content.enemyTags.values(),
      ]),
      0,
    );

    expect(result.actors.find((entry) => entry.id === `z-${raceId}`)?.effects).toEqual([
      expect.objectContaining({ id: 'core:poison' }),
    ]);
  });

  it('applies a character regeneration implant on turns and respects recorded suppression', () => {
    const regenerator = actor('a-regenerator', 'party', {
      hp: { current: 20, maximum: 100 },
      regenerationPerAction: 5,
    });
    const first = advanceCombat(
      createCombatState(
        'implant-regeneration',
        [regenerator, actor('z-target', 'enemy', { actions: [] })],
        1,
      ),
      0,
    );
    expect(first.actors.find((entry) => entry.id === 'a-regenerator')?.hp.current).toBe(25);
    expect(first.log.find((entry) => entry.actorId === 'a-regenerator')?.effectsApplied).toContain(
      'regeneration:5',
    );

    const suppressed = advanceCombat(
      createCombatState(
        'suppressed-implant-regeneration',
        [
          actor('a-regenerator', 'party', {
            hp: { current: 20, maximum: 100 },
            regenerationPerAction: 5,
            effects: [
              { id: 'base:regeneration-suppressed', category: 'debuff', potency: 1, counter: 2 },
            ],
          }),
          actor('z-target', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(suppressed.actors.find((entry) => entry.id === 'a-regenerator')?.hp.current).toBe(20);

    const full = advanceCombat(
      createCombatState(
        'full-implant-regeneration',
        [
          actor('a-regenerator', 'party', { regenerationPerAction: 5 }),
          actor('z-target', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(full.actors.find((entry) => entry.id === 'a-regenerator')?.hp.current).toBe(100);
    expect(
      full.log.find((entry) => entry.actorId === 'a-regenerator')?.effectsApplied,
    ).not.toContain('regeneration:0');
  });

  it('resurrects once at 1 HP with the soul anchor marked broken', () => {
    const revived = advanceCombat(
      createCombatState(
        'soul-anchor',
        [
          actor('a-anchored', 'party', {
            hp: { current: 20, maximum: 100 },
            soulAnchorAvailable: true,
          }),
          actor('z-enemy', 'enemy', {
            actions: [
              {
                ...strike,
                id: 'enemy:lethal',
                damage: {
                  ...strike.damage!,
                  amount: 40,
                  origin: { kind: 'ability', id: 'enemy:lethal' },
                },
              },
            ],
            actionPriority: ['enemy:lethal'],
          }),
        ],
        1,
      ),
      0,
    );
    const anchor = revived.actors.find((entry) => entry.id === 'a-anchored');
    const lethalLog = revived.log.find((entry) => entry.actorId === 'z-enemy');
    expect(anchor).toMatchObject({
      hp: { current: 1, maximum: 100 },
      state: 'alive',
      soulAnchorAvailable: false,
      soulAnchorUsed: true,
    });
    expect(lethalLog).toMatchObject({ killed: false });
    expect(lethalLog?.effectsApplied).toContain('soul-anchor:resurrected-and-broken');
  });

  it('resolves the same ordered events when continuous or resumed in offline batches', () => {
    const actors = [actor('hero', 'party'), actor('beast', 'enemy')];
    const continuous = advanceCombat(createCombatState('run-1', actors, 1234), 4_000);
    const firstBatch = advanceCombat(createCombatState('run-1', actors, 1234), 1_500);
    const resumed = advanceCombat(firstBatch, 4_000);

    expect(resumed).toEqual(continuous);
    expect(continuous.log.map((entry) => entry.id)).toEqual(
      continuous.log.map((_, index) => `run-1:event:${index + 1}`),
    );
  });

  it('uses stable actor ordering for simultaneous events and gives faster actors more turns', () => {
    const slow = actor('z-slow', 'enemy', {
      attributes: { ...actor('z-slow', 'enemy').attributes, speed: 5 },
    });
    const fast = actor('a-fast', 'party', {
      attributes: { ...actor('a-fast', 'party').attributes, speed: 20 },
    });
    const result = advanceCombat(createCombatState('speed', [slow, fast], 5), 2_000);
    const initialTimeEvents = result.log.filter((entry) => entry.timeMs === 0);

    expect(initialTimeEvents.map((entry) => entry.actorId)).toEqual(['a-fast', 'z-slow']);
    expect(result.log.filter((entry) => entry.actorId === 'a-fast').length).toBeGreaterThan(
      result.log.filter((entry) => entry.actorId === 'z-slow').length,
    );
  });

  it('checks hit and dodge separately from damage channel, so true damage can miss', () => {
    const trueStrike: CombatAction = {
      ...strike,
      id: 'base:true-strike',
      accuracy: 0,
      damage: { ...strike.damage!, amount: 99, channel: 'true', subtype: undefined },
    };
    const result = advanceCombat(
      createCombatState(
        'miss',
        [
          actor('hero', 'party', { actions: [trueStrike], actionPriority: ['base:true-strike'] }),
          actor('dummy', 'enemy'),
        ],
        99,
      ),
      1_000,
    );

    expect(result.log.find((entry) => entry.actorId === 'hero')?.hit).toBe(false);
    expect(result.actors.find((entry) => entry.id === 'dummy')?.hp.current).toBe(100);
  });

  it('applies the physical and magical mitigation pipeline, while true damage bypasses defense', () => {
    const physical = advanceCombat(
      createCombatState(
        'physical',
        [
          actor('hero', 'party', { actions: [strike], actionPriority: ['base:strike'] }),
          actor('target', 'enemy', { mitigation: { physical: 0.5, magical: 0.75 } }),
        ],
        1,
      ),
      1,
    );
    const trueStrike = {
      ...strike,
      damage: { ...strike.damage!, channel: 'true' as const, subtype: undefined },
    };
    const trueDamage = advanceCombat(
      createCombatState(
        'true',
        [
          actor('hero', 'party', { actions: [trueStrike], actionPriority: ['base:strike'] }),
          actor('target', 'enemy', { mitigation: { physical: 0.5, magical: 0.75 } }),
        ],
        1,
      ),
      1,
    );

    expect(physical.log[0]?.damageFinal).toBe(20);
    expect(trueDamage.log[0]?.damageFinal).toBe(40);
  });

  it('lets area damage interact with a segmented creature', () => {
    const areaStrike: CombatAction = {
      ...strike,
      id: 'base:area-strike',
      kind: 'area',
      properties: ['area'],
    };
    const result = advanceCombat(
      createCombatState(
        'segmented-area',
        [
          actor('hero', 'party', { actions: [areaStrike], actionPriority: [areaStrike.id] }),
          actor('segments', 'enemy', { tags: ['base:segmented'] }),
        ],
        10,
      ),
      1,
    );
    expect(result.log.find((entry) => entry.actorId === 'hero')).toMatchObject({
      damageInitial: 40,
      damageFinal: 50,
      tagInteractions: [expect.objectContaining({ tagId: 'base:segmented' })],
    });
  });

  it('resolves area attacks against every living target with independent logs and rolls', () => {
    const areaStrike: CombatAction = {
      ...strike,
      id: 'base:wide-strike',
      kind: 'area',
      properties: [],
    };
    const result = advanceCombat(
      createCombatState(
        'area-group',
        [
          actor('hero', 'party', { actions: [areaStrike], actionPriority: [areaStrike.id] }),
          actor('a-swarm', 'enemy', { tags: ['base:swarm'] }),
          actor('b-swarm', 'enemy', { tags: ['base:swarm'] }),
        ],
        15,
      ),
      1,
    );
    const hits = result.log.filter((entry) => entry.actorId === 'hero');

    expect(hits.map((entry) => entry.targetId)).toEqual(['a-swarm', 'b-swarm']);
    expect(hits.map((entry) => entry.damageFinal)).toEqual([60, 60]);
    expect(
      result.actors.filter((entry) => entry.side === 'enemy').map((entry) => entry.hp.current),
    ).toEqual([40, 40]);
  });

  it('applies an area action to the configured ally group or its explicit self target', () => {
    const allyArea: CombatAction = {
      ...strike,
      id: 'base:ally-area',
      kind: 'area',
      target: 'ally',
    };
    const allyResult = advanceCombat(
      createCombatState(
        'ally-area',
        [
          actor('hero', 'party', { actions: [allyArea], actionPriority: [allyArea.id] }),
          actor('support', 'party', { actions: [] }),
          actor('foe', 'enemy', { actions: [] }),
        ],
        16,
      ),
      1,
    );
    expect(
      allyResult.log.filter((entry) => entry.actorId === 'hero').map((entry) => entry.targetId),
    ).toEqual(['support']);
    expect(allyResult.actors.find((entry) => entry.id === 'foe')?.hp.current).toBe(100);

    const selfArea: CombatAction = { ...allyArea, id: 'base:self-area', target: 'self' };
    const selfResult = advanceCombat(
      createCombatState(
        'self-area',
        [
          actor('hero', 'party', { actions: [selfArea], actionPriority: [selfArea.id] }),
          actor('foe', 'enemy', { actions: [] }),
        ],
        17,
      ),
      1,
    );
    expect(selfResult.log.find((entry) => entry.actorId === 'hero')?.targetId).toBe('hero');
    expect(selfResult.actors.find((entry) => entry.id === 'hero')?.hp.current).toBe(60);
  });

  it('skips area targets killed by an earlier death-trigger in the same action', () => {
    const areaStrike: CombatAction = {
      ...strike,
      id: 'base:volatile-area',
      kind: 'area',
    };
    const volatile = actor('a-volatile', 'enemy', {
      tags: ['base:volatile'],
      hp: { current: 20, maximum: 20 },
      position: { x: 1, y: 0 },
    });
    const burstTarget = actor('b-burst-target', 'enemy', {
      hp: { current: 20, maximum: 20 },
      position: { x: 2, y: 0 },
    });
    const result = advanceCombat(
      createCombatState(
        'area-death-trigger',
        [
          actor('hero', 'party', { actions: [areaStrike], actionPriority: [areaStrike.id] }),
          volatile,
          burstTarget,
        ],
        18,
      ),
      1,
    );

    expect(result.actors.find((entry) => entry.id === 'b-burst-target')?.state).toBe('dead');
    expect(
      result.log.filter((entry) => entry.actorId === 'hero').map((entry) => entry.targetId),
    ).toEqual(['a-volatile']);
  });

  it('splits damage between HP and Tenacity and only dies after both are depleted', () => {
    const heavyStrike = { ...strike, damage: { ...strike.damage!, amount: 160 } };
    const result = advanceCombat(
      createCombatState(
        'tenacity',
        [
          actor('hero', 'party', { actions: [heavyStrike], actionPriority: ['base:strike'] }),
          actor('target', 'enemy', {
            hp: { current: 30, maximum: 30 },
            tenacity: { current: 100, maximum: 100 },
          }),
        ],
        1,
      ),
      1,
    );

    expect(result.actors.find((entry) => entry.id === 'target')).toMatchObject({
      hp: { current: 0 },
      tenacity: { current: 20 },
      state: 'alive',
    });
  });

  it('uses declared action priorities, validates energy costs, and applies player-selectable priorities', () => {
    const cheap = { ...strike, id: 'base:cheap' };
    const costly = { ...strike, id: 'base:costly', cost: { resource: 'mana', amount: 9 } };
    const hero = actor('hero', 'party', {
      actions: [costly, cheap],
      actionPriority: ['base:costly', 'base:cheap'],
      energy: { mana: 2 },
    });
    const result = advanceCombat(
      createCombatState('priority', [hero, actor('enemy', 'enemy')], 10),
      1,
    );

    expect(result.log.find((entry) => entry.actorId === 'hero')?.actionId).toBe('base:cheap');
    expect(result.log.find((entry) => entry.actorId === 'hero')?.resourceChanges).toEqual([]);
  });

  it('records evades, tag interactions, status effects, and deaths in structured log entries', () => {
    const poisonStrike: CombatAction = {
      ...strike,
      damage: { ...strike.damage!, amount: 101, element: 'venom' },
      effects: [{ id: 'base:poison', category: 'dot', potency: 3, counter: 2 }],
    };
    const result = advanceCombat(
      createCombatState(
        'log',
        [
          actor('hero', 'party', { actions: [poisonStrike], actionPriority: ['base:strike'] }),
          actor('enemy', 'enemy', {
            tags: ['base:toxic'],
            effects: [],
            evasion: { chance: 0, guaranteed: 0 },
            hp: { current: 40, maximum: 40 },
          }),
        ],
        7,
      ),
      1,
    );

    const heroEntry = result.log.find((entry) => entry.actorId === 'hero');
    expect(heroEntry).toMatchObject({ actorId: 'hero', targetId: 'enemy', hit: true });
    expect(heroEntry?.tagInteractions.length).toBeGreaterThan(0);
    expect(heroEntry?.killed).toBe(true);
    expect(heroEntry?.effectsApplied).toContain('hero:base:poison');
  });

  it('ticks configured damage statuses on virtual time and resumes them identically in offline batches', () => {
    const poisonStrike: CombatAction = {
      ...strike,
      id: 'base:poison-strike',
      damage: { ...strike.damage!, amount: 1 },
      effects: [
        {
          id: 'base:poison',
          category: 'dot',
          potency: 2,
          counter: 4,
          tickDamage: { amount: 3, channel: 'magical', element: 'poison', properties: ['toxic'] },
          tickIntervalMs: 1_000,
        },
      ],
    };
    const actors = [
      actor('hero', 'party', { actions: [poisonStrike], actionPriority: [poisonStrike.id] }),
      actor('target', 'enemy', {
        hp: { current: 100, maximum: 100 },
        actions: [{ ...strike, damage: { ...strike.damage!, amount: 0 } }],
      }),
    ];
    const uninterrupted = advanceCombat(createCombatState('poison', actors, 55), 3_000);
    const resumed = advanceCombat(
      advanceCombat(createCombatState('poison', actors, 55), 1_250),
      3_000,
    );
    expect(resumed).toEqual(uninterrupted);
    expect(
      uninterrupted.log
        .filter((entry) => entry.actionId === 'status:base:poison')
        .map((entry) => entry.damageFinal),
    ).toEqual([6, 6, 6]);
    expect(uninterrupted.actors.find((entry) => entry.id === 'target')?.hp.current).toBeLessThan(
      100,
    );
  });

  it('runs guardian interception, counterattacks, vampirism, corrosion, conduction, and death bursts', () => {
    const hero = actor('hero', 'party', {
      hp: { current: 20, maximum: 100 },
      tags: ['base:vampiric'],
    });
    const target = actor('target', 'enemy', {
      tags: ['base:counterattacker'],
      evasion: { chance: 1, guaranteed: 0 },
    });
    const counter = advanceCombat(createCombatState('counter', [hero, target], 2), 0);
    expect(counter.log.some((entry) => entry.message.includes('contra-ataca'))).toBe(true);

    const guardian = actor('z-guardian', 'enemy', { tags: ['base:guardian'] });
    const guarded = actor('a-target', 'enemy');
    const intercepted = advanceCombat(
      createCombatState('intercept', [actor('a-hero', 'party'), guardian, guarded], 2),
      0,
    );
    expect(intercepted.log.find((entry) => entry.actorId === 'a-hero')?.targetId).toBe(
      'z-guardian',
    );

    const lifesteal = advanceCombat(
      createCombatState(
        'lifesteal',
        [hero, actor('weak', 'enemy', { hp: { current: 100, maximum: 100 } })],
        2,
      ),
      0,
    );
    expect(lifesteal.log.find((entry) => entry.actorId === 'hero')?.actorHpChange).toEqual({
      before: 20,
      after: 30,
    });

    const corrosive = actor('acid', 'enemy', { tags: ['base:corrosive'] });
    const corroded = advanceCombat(
      createCombatState(
        'corrosion',
        [actor('a-player', 'party', { mitigation: { physical: 0.5, magical: 0.5 } }), corrosive],
        2,
      ),
      0,
    );
    expect(corroded.actors.find((entry) => entry.id === 'a-player')?.mitigation).toEqual({
      physical: 0,
      magical: 0,
    });

    const lightning: CombatAction = {
      ...strike,
      damage: { ...strike.damage!, amount: 40, channel: 'magical', element: 'lightning' },
    };
    const primary = actor('a-main', 'enemy', {
      tags: ['base:stormbound'],
      hp: { current: 200, maximum: 200 },
    });
    const adjacent = actor('z-adjacent', 'enemy', {
      hp: { current: 200, maximum: 200 },
      position: { x: 2, y: 0 },
    });
    const chained = advanceCombat(
      createCombatState(
        'chain',
        [
          actor('hero', 'party', { actions: [lightning], actionPriority: [lightning.id] }),
          primary,
          adjacent,
        ],
        2,
      ),
      0,
    );
    expect(
      chained.log.some(
        (entry) => entry.actionId === `chain:${lightning.id}` && entry.targetId === 'z-adjacent',
      ),
    ).toBe(true);

    const lethal: CombatAction = { ...strike, damage: { ...strike.damage!, amount: 500 } };
    const volatile = actor('volatile', 'enemy', {
      tags: ['base:volatile'],
      hp: { current: 1, maximum: 1 },
      tenacity: { current: 0, maximum: 0 },
    });
    const burst = advanceCombat(
      createCombatState(
        'burst',
        [actor('hero', 'party', { actions: [lethal], actionPriority: [lethal.id] }), volatile],
        2,
      ),
      0,
    );
    expect(
      burst.log.some(
        (entry) => entry.actionId === 'death-burst:volatile' && entry.targetId === 'hero',
      ),
    ).toBe(true);
  });

  it('applies forced movement and honors colossal or partial displacement resistance', () => {
    const shove: CombatAction = {
      ...strike,
      id: 'base:shove',
      movement: { kind: 'push', distance: 2 },
    };
    const colossal = advanceCombat(
      createCombatState(
        'colossal-move',
        [
          actor('hero', 'party', { actions: [shove], actionPriority: [shove.id] }),
          actor('target', 'enemy', { tags: ['base:colossal'] }),
        ],
        8,
      ),
      0,
    );
    expect(colossal.actors.find((entry) => entry.id === 'target')?.position).toEqual({
      x: 1,
      y: 0,
    });
    expect(colossal.log[0]?.tagInteractions.some((entry) => entry.tagId === 'base:colossal')).toBe(
      true,
    );

    const slow = advanceCombat(
      createCombatState(
        'slow-move',
        [
          actor('hero', 'party', {
            actions: [{ ...shove, movement: { kind: 'push', distance: 1 } }],
            actionPriority: [shove.id],
          }),
          actor('target', 'enemy', { tags: ['base:slow'] }),
        ],
        8,
      ),
      0,
    );
    expect(slow.actors.find((entry) => entry.id === 'target')?.position.x).toBe(1.5);
  });

  it('validates participants and time windows', () => {
    expect(() => createCombatState('empty', [], 1)).toThrow('Combat requires at least two actors.');
    expect(() =>
      createCombatState('duplicate', [actor('same', 'party'), actor('same', 'enemy')], 1),
    ).toThrow('Combat actor ids must be unique.');
    expect(() =>
      createCombatState('same-side', [actor('a', 'party'), actor('b', 'party')], 1),
    ).toThrow('Combat requires at least two opposing sides.');
    expect(() =>
      advanceCombat(createCombatState('time', [ac…4588 tokens truncated…, counter], 2), 0);
    expect(
      result.log.some(
        (entry) => entry.actorId === counter.id && entry.actionId === counterAction.id,
      ),
    ).toBe(true);
  });

  it('handles healing, support, empty targets, blocked phase attacks, and non-damaging actions', () => {
    const heal: CombatAction = {
      id: 'base:heal',
      name: 'Heal',
      kind: 'heal',
      target: 'lowest_ally_hp',
      intervalMs: 1_000,
      accuracy: 1,
      healing: 15,
    };
    const guard: CombatAction = {
      id: 'base:guard',
      name: 'Guard',
      kind: 'guard',
      target: 'self',
      intervalMs: 1_000,
      accuracy: 1,
    };
    const phaseStrike = { ...strike, id: 'base:phase-strike' };
    const healed = advanceCombat(
      createCombatState(
        'heal',
        [
          actor('a-healer', 'party', { actions: [heal], actionPriority: [heal.id] }),
          actor('b-ally', 'party', { hp: { current: 10, maximum: 100 }, actions: [] }),
          actor('z-enemy', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(healed.actors.find((entry) => entry.id === 'b-ally')?.hp.current).toBe(25);

    const nonDamaging = advanceCombat(
      createCombatState(
        'guard',
        [
          actor('a-hero', 'party', { actions: [guard], actionPriority: [guard.id] }),
          actor('z-enemy', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(nonDamaging.log.find((entry) => entry.actorId === 'a-hero')?.message).toContain(
      'executa Guard',
    );

    const phased = advanceCombat(
      createCombatState(
        'phased',
        [
          actor('a-hero', 'party', { actions: [phaseStrike], actionPriority: [phaseStrike.id] }),
          actor('z-ghost', 'enemy', { tags: ['base:ethereal'], actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(phased.log.find((entry) => entry.actorId === 'a-hero')?.blocked).toBe(true);

    const allyOnly: CombatAction = { ...guard, id: 'base:ally-only', target: 'ally' };
    const noTarget = advanceCombat(
      createCombatState(
        'no-target',
        [
          actor('a-hero', 'party', { actions: [allyOnly], actionPriority: [allyOnly.id] }),
          actor('z-enemy', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(noTarget.log[0]?.kind).toBe('action_skipped');
  });

  it('applies environmental regeneration, time-of-day action cadence, and fast movement tags', () => {
    const actorWithEnvironment = actor('a-hero', 'party', {
      tags: ['base:plant', 'base:nocturnal', 'base:fast'],
      hp: { current: 50, maximum: 100 },
      actions: [],
    });
    const initial = createCombatState(
      'environment',
      [actorWithEnvironment, actor('z-enemy', 'enemy', { actions: [] })],
      1,
      {
        condition: 'fertile',
        timeOfDay: 'night',
      },
    );
    const result = advanceCombat(initial, 0);
    const saved = result.actors.find((entry) => entry.id === 'a-hero');
    expect(saved?.hp.current).toBe(51);
    expect(saved?.nextEventAt).toBe(600);
    expect(result.log[0]?.effectsApplied).toContain('regeneration:1');
  });

  it('interacts with all player-selectable target modes and ends after a side is defeated', () => {
    const selfGuard: CombatAction = {
      id: 'base:self',
      name: 'Self',
      kind: 'guard',
      target: 'self',
      intervalMs: 1,
      accuracy: 1,
    };
    const allyHeal: CombatAction = {
      id: 'base:ally',
      name: 'Ally',
      kind: 'heal',
      target: 'ally',
      intervalMs: 1,
      accuracy: 1,
      healing: 5,
    };
    const lowestEnemy: CombatAction = {
      ...strike,
      id: 'base:lowest-enemy',
      target: 'lowest_enemy_hp',
      damage: { ...strike.damage!, amount: 10_000 },
    };
    const first = advanceCombat(
      createCombatState(
        'self',
        [
          actor('a-hero', 'party', { actions: [selfGuard], actionPriority: [selfGuard.id] }),
          actor('b-ally', 'party', {
            actions: [allyHeal],
            actionPriority: [allyHeal.id],
            hp: { current: 1, maximum: 100 },
          }),
          actor('z-enemy', 'enemy', { actions: [lowestEnemy], actionPriority: [lowestEnemy.id] }),
        ],
        1,
      ),
      0,
    );
    expect(
      first.log.some((entry) => entry.actorId === 'a-hero' && entry.targetId === 'a-hero'),
    ).toBe(true);
    expect(
      first.log.some((entry) => entry.actorId === 'b-ally' && entry.targetId === 'a-hero'),
    ).toBe(true);
    expect(first.winner).toBeUndefined();

    const finisher = advanceCombat(
      createCombatState(
        'finisher',
        [
          actor('a-hero', 'party', { actions: [strike], actionPriority: [strike.id] }),
          actor('z-enemy', 'enemy', { hp: { current: 1, maximum: 100 }, actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(finisher.winner).toBe('party');
    expect(finisher.log.at(-1)?.killed).toBe(true);
  });

  it('runs mod-provided tag rules through the same combat event pipeline', () => {
    const modTags = loadTagRegistry([
      {
        id: 'mod:empowered',
        category: 'affinity',
        name: 'Empowered',
        description: '',
        origin: 'mod:combat-pack',
        activationConditions: [],
        eventsObserved: ['attack.outgoing'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'damage-boost',
            event: 'attack.outgoing',
            conditions: [],
            interactionId: 'mod:damage-boost',
            potency: 1,
            priority: 10,
            effect: { type: 'damage_multiplier', value: 2 },
          },
        ],
      },
      {
        id: 'mod:nonbias',
        category: 'behavior',
        name: 'Non Bias',
        description: '',
        origin: 'mod:combat-pack',
        activationConditions: [],
        eventsObserved: ['action.select'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'other-action-rule',
            event: 'action.select',
            conditions: [],
            interactionId: 'mod:other-action-rule',
            potency: 1,
            priority: 1,
            effect: { type: 'hazard_awareness' },
          },
        ],
      },
    ]);
    const amplified = actor('a-mod-hero', 'party', { tags: ['mod:empowered', 'mod:nonbias'] });
    const result = advanceCombat(
      createCombatState('mod-tags', [amplified, actor('z-target', 'enemy')], 7, {}, modTags),
      0,
    );
    expect(result.log[0]).toMatchObject({
      damageInitial: 40,
      damageFinal: 80,
      tagInteractions: [
        expect.objectContaining({ tagId: 'mod:empowered', ruleId: 'damage-boost' }),
      ],
    });
  });

  it('creates a combat-contract summon, counts living auxiliaries, and resumes deterministically', () => {
    const summonAction: CombatAction = {
      id: 'base:call-wisp',
      name: 'Call Wisp',
      kind: 'summon',
      target: 'self',
      intervalMs: 1_000,
      accuracy: 1,
      summon: {
        id: 'core:rift-wisp',
        name: 'Rift Wisp',
        speciesId: 'core:rift-wisp',
        tags: ['base:ethereal'],
        attributes: {
          vigor: 2,
          resistance: 1,
          speed: 20,
          dexterity: 8,
          precision: 12,
          strength: 3,
        },
        hp: { current: 20, maximum: 20 },
        tenacity: { current: 0, maximum: 0 },
        energy: {},
        damage: {
          amount: 8,
          channel: 'magical',
          element: 'arcane',
          properties: ['spiritual'],
          origin: { kind: 'ability', id: 'core:rift-wisp-bolt' },
        },
        intervalMs: 500,
        accuracy: 1,
        mitigation: { physical: 0, magical: 0 },
        positionOffset: { x: 0, y: 1 },
      },
    };
    const actors = [
      actor('a-summoner', 'enemy', {
        tags: ['base:summoner'],
        actions: [strike, summonAction],
        actionPriority: [strike.id, summonAction.id],
      }),
      actor('z-target', 'party', { actions: [], hp: { current: 200, maximum: 200 } }),
    ];
    const complete = advanceCombat(createCombatState('summons', actors, 12), 1_000);
    const resumed = advanceCombat(
      advanceCombat(createCombatState('summons', actors, 12), 500),
      1_000,
    );
    const wisp = complete.actors.find((candidate) => candidate.speciesId === 'core:rift-wisp');

    expect(resumed).toEqual(complete);
    expect(wisp).toMatchObject({ side: 'enemy', summonedBy: 'a-summoner', state: 'alive' });
    expect(complete.log.filter((entry) => entry.actionId === summonAction.id)).toHaveLength(1);
    expect(complete.log.some((entry) => entry.actorId === wisp?.id)).toBe(true);

    const physicalSummonAction: CombatAction = {
      ...summonAction,
      id: 'base:call-iron-wisp',
      summon: {
        ...summonAction.summon!,
        id: 'core:iron-wisp',
        damage: { ...summonAction.summon!.damage, channel: 'physical', subtype: 'crushing' },
      },
    };
    const physicalResult = advanceCombat(
      createCombatState(
        'physical-summon',
        [
          actor('summoner', 'party', {
            actions: [physicalSummonAction],
            actionPriority: [physicalSummonAction.id],
          }),
          actor('foe', 'enemy'),
        ],
        13,
      ),
      1,
    );
    expect(
      physicalResult.actors.find((candidate) => candidate.summonedBy === 'summoner')?.actions[0]
        ?.kind,
    ).toBe('attack');
  });

  it('rejects missing summon profiles and summon profiles attached to other action kinds', () => {
    const missingProfile = { ...strike, kind: 'summon' as const };
    const mismatchedProfile = {
      ...strike,
      summon: {
        id: 'core:broken',
      },
    } as unknown as CombatAction;
    expect(() =>
      createCombatState(
        'bad-summon',
        [actor('hero', 'party', { actions: [missingProfile] }), actor('foe', 'enemy')],
        1,
      ),
    ).toThrow('Combat actor hero has an invalid summon action.');
    expect(() =>
      createCombatState(
        'bad-summon-kind',
        [actor('hero', 'party', { actions: [mismatchedProfile] }), actor('foe', 'enemy')],
        1,
      ),
    ).toThrow('Combat actor hero has an invalid summon action.');
  });

  it('burrows from self movement and blocks ordinary attacks until revealed or countered', () => {
    const burrow = actor('burrower', 'enemy', {
      tags: ['base:burrowing'],
      actions: [
        {
          id: 'base:burrow',
          name: 'Burrow',
          kind: 'move',
          target: 'self',
          intervalMs: 1_000,
          accuracy: 1,
          movement: { kind: 'burrow', distance: 0 },
        },
      ],
      actionPriority: ['base:burrow'],
    });
    const burrowed = advanceCombat(
      createCombatState('burrow', [actor('hero', 'party'), burrow], 3),
      1,
    );
    expect(burrowed.actors.find((entry) => entry.id === 'burrower')?.movementState).toBe(
      'burrowed',
    );

    const blocked = advanceCombat(
      createCombatState(
        'burrow-gate',
        [
          actor('hero', 'party'),
          actor('hidden', 'enemy', { tags: ['base:burrowing'], movementState: 'burrowed' }),
        ],
        4,
      ),
      1,
    );
    expect(blocked.log.find((entry) => entry.actorId === 'hero')?.blocked).toBe(true);

    const countered = advanceCombat(
      createCombatState(
        'burrow-counter',
        [
          actor('earth-sensor', 'party', { tags: ['base:subterranean'] }),
          actor('hidden', 'enemy', { tags: ['base:burrowing'], movementState: 'burrowed' }),
        ],
        5,
      ),
      1,
    );
    expect(countered.log.find((entry) => entry.actorId === 'earth-sensor')?.blocked).toBe(false);
    expect(countered.actors.find((entry) => entry.id === 'hidden')?.revealed).toBe(true);
  });

  it('lets a burrowed creature emerge through its configured movement action', () => {
    const emerge = actor('burrower', 'enemy', {
      movementState: 'burrowed',
      actions: [
        {
          id: 'base:emerge',
          name: 'Emerge',
          kind: 'move',
          target: 'self',
          intervalMs: 1_000,
          accuracy: 1,
          movement: { kind: 'emerge', distance: 0 },
        },
      ],
      actionPriority: ['base:emerge'],
    });
    const result = advanceCombat(
      createCombatState('emerge', [actor('hero', 'party'), emerge], 6),
      1,
    );
    expect(result.actors.find((entry) => entry.id === 'burrower')?.movementState).toBe('pursuing');
  });

  it('does not replace an equal on-hit effect already carried by the attacker', () => {
    const reactiveTag = loadTagRegistry([
      {
        id: 'mod:reactive-ward',
        category: 'behavior',
        name: 'Reactive Ward',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['damage.received'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'ward-on-hit',
            event: 'damage.received',
            conditions: [],
            interactionId: 'mod:ward-on-hit',
            potency: 1,
            priority: 1,
            effect: {
              type: 'on_hit_effect',
              value: { id: 'mod:ward', category: 'buff', potency: 1, counter: 1 },
            },
          },
        ],
      },
    ]);
    const ward: NonNullable<CombatActor['effects'][number]> = {
      id: 'mod:ward',
      category: 'buff',
      potency: 1,
      counter: 1,
    };
    const result = advanceCombat(
      createCombatState(
        'existing-reactive-ward',
        [
          actor('a-hero', 'party', { effects: [ward] }),
          actor('z-defender', 'enemy', { tags: ['mod:reactive-ward'] }),
        ],
        2,
        {},
        reactiveTag,
      ),
      0,
    );
    const hit = result.log.find((entry) => entry.actorId === 'a-hero');
    expect(hit?.effectsApplied).not.toContain('a-hero:mod:ward');
    expect(result.actors.find((entry) => entry.id === 'a-hero')?.effects).toHaveLength(1);
  });

  it('initializes and returns a finished combat when only one side has living actors', () => {
    const finished = createCombatState(
      'already-finished',
      [
        actor('a-dead', 'party', { hp: { current: 0, maximum: 100 }, actions: [] }),
        actor('z-alive', 'enemy', { actions: [] }),
      ],
      4,
    );
    expect(finished.winner).toBe('enemy');
    expect(advanceCombat(finished, 1000)).toEqual(finished);
  });

  it('lets tracking reveal camouflage and lets fast hunters acquire fleeing targets', () => {
    const revealed = advanceCombat(
      createCombatState(
        'reveal',
        [
          actor('a-tracker', 'party', { tags: ['base:beast'] }),
          actor('z-camouflaged', 'enemy', { tags: ['base:camouflaged', 'base:beast'] }),
        ],
        8,
      ),
      0,
    );
    expect(revealed.log.find((entry) => entry.actorId === 'a-tracker')).toMatchObject({
      hit: true,
      blocked: false,
    });
    expect(revealed.actors.find((entry) => entry.id === 'z-camouflaged')?.revealed).toBe(true);

    const fastAction = { ...strike, id: 'base:fast-hunt' };
    const hunted = advanceCombat(
      createCombatState(
        'fleeing-target',
        [
          actor('a-fast', 'party', {
            tags: ['base:fast'],
            actions: [fastAction],
            actionPriority: [fastAction.id],
          }),
          actor('z-fleeing', 'enemy', { movementState: 'fleeing' }),
        ],
        9,
      ),
      0,
    );
    expect(hunted.log.find((entry) => entry.actorId === 'a-fast')?.targetId).toBe('z-fleeing');
  });

  it('ignores unrelated environmental tag operations without affecting the action', () => {
    const customTags = loadTagRegistry([
      ...BASE_ENEMY_TAGS,
      {
        id: 'mod:environment-policy',
        category: 'behavior',
        name: 'Environment Policy',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['environment.tick'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'policy',
            event: 'environment.tick',
            conditions: [],
            interactionId: 'mod:environment-policy',
            potency: 1,
            priority: 1,
            effect: { type: 'policy_bias', value: { actionKinds: ['attack'], bonus: 1 } },
          },
        ],
      },
    ]);
    const state = createCombatState(
      'ignored-environment',
      [
        actor('a-policy', 'party', { tags: ['mod:environment-policy'], actions: [] }),
        actor('z-idle', 'enemy', { actions: [] }),
      ],
      2,
      {},
      customTags,
    );
    expect(advanceCombat(state, 0).log[0]?.kind).toBe('action_skipped');
  });

  it('covers targeting, policy, adaptive affinity, and optional state branches', () => {
    const tickActor = actor('a-tick-copy', 'party', {
      effects: [
        {
          id: 'base:explicit-expiry',
          category: 'buff',
          potency: 1,
          counter: 3,
          expiresAt: 500,
          tickDamage: { amount: 1, channel: 'true', properties: ['direct'] },
          tickIntervalMs: 10,
          nextTickAt: 5,
        },
        { id: 'base:no-expiry', category: 'buff', potency: 1, counter: 0 },
        {
          id: 'base:explicit-tick',
          category: 'dot',
          potency: 1,
          counter: 2,
          tickDamage: { amount: 1, channel: 'true' },
          tickIntervalMs: 10,
          nextTickAt: 20,
        },
      ],
    });
    const cloned = createCombatState(
      'optional-state',
      [tickActor, actor('z-idle', 'enemy', { actions: [] })],
      1,
    );
    expect(
      cloned.actors[0]?.effects.map((effect) => [effect.expiresAt, effect.nextTickAt]),
    ).toEqual([
      [500, 5],
      [undefined, undefined],
      [2_000, 20],
    ]);

    const lowest: CombatAction = {
      ...strike,
      id: 'base:lowest-tie',
      target: 'lowest_enemy_hp',
      damage: { ...strike.damage!, properties: [], amount: 1 },
    };
    const hunter = actor('a-lowest', 'party', {
      tags: ['base:caster'],
      actions: [lowest],
      actionPriority: [],
      policy: {
        id: 'base:conditional-lowest',
        rules: [
          {
            actionId: lowest.id,
            priority: 4,
            conditions: [{ path: 'actor.hpRatio', operator: 'gte', value: 0.5 }],
          },
        ],
      },
    });
    const tied = advanceCombat(
      createCombatState(
        'lowest-tie',
        [
          hunter,
          actor('b-ratio', 'enemy', { hp: { current: 50, maximum: 100 }, actions: [] }),
          actor('z-ratio', 'enemy', { hp: { current: 25, maximum: 50 }, actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(tied.log.find((entry) => entry.actorId === hunter.id)?.targetId).toBe('b-ratio');

    const noDamageGuard: CombatAction = {
      id: 'base:unarmed-intercept',
      name: 'Intercept',
      kind: 'guard',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
    };
    const intercepted = advanceCombat(
      createCombatState(
        'support-intercept',
        [
          actor('a-scout', 'party', {
            actions: [noDamageGuard],
            actionPriority: [noDamageGuard.id],
            tags: ['base:caster'],
          }),
          actor('b-selected', 'enemy', { actions: [] }),
          actor('c-guardian', 'enemy', { tags: ['base:guardian'], actions: [] }),
        ],
        2,
      ),
      0,
    );
    expect(intercepted.log.find((entry) => entry.actorId === 'a-scout')?.targetId).toBe(
      'c-guardian',
    );

    const adaptiveMismatch = advanceCombat(
      createCombatState(
        'adaptive-mismatch',
        [
          actor('a-hero', 'party'),
          actor('z-adaptive', 'enemy', { tags: ['base:adaptive'], lastDamageChannel: 'magical' }),
        ],
        2,
      ),
      0,
    );
    expect(adaptiveMismatch.log.find((entry) => entry.actorId === 'a-hero')?.damageFinal).toBe(40);

    const lonelyHeal: CombatAction = {
      id: 'base:lonely-heal',
      name: 'Lonely Heal',
      kind: 'heal',
      target: 'ally',
      intervalMs: 1_000,
      accuracy: 1,
    };
    const noAlly = advanceCombat(
      createCombatState(
        'missing-target',
        [
          actor('a-no-ally', 'party', { actions: [lonelyHeal], actionPriority: [] }),
          actor('z-enemy', 'enemy', { actions: [] }),
        ],
        4,
      ),
      0,
    );
    expect(noAlly.log.find((entry) => entry.actorId === 'a-no-ally')?.kind).toBe('action_skipped');

    const freeAction = { ...strike, id: 'base:free-focus', cost: { resource: 'focus', amount: 0 } };
    const freeCast = advanceCombat(
      createCombatState(
        'missing-resource',
        [
          actor('a-free', 'party', {
            actions: [freeAction],
            actionPriority: [freeAction.id],
            energy: {},
          }),
          actor('z-free-target', 'enemy', { actions: [] }),
        ],
        5,
      ),
      0,
    );
    expect(freeCast.log.find((entry) => entry.actorId === 'a-free')?.resourceChanges).toEqual([
      { actorId: 'a-free', resource: 'focus', before: 0, after: 0 },
    ]);

    const noHealValue: CombatAction = {
      id: 'base:no-heal-value',
      name: 'No Healing',
      kind: 'heal',
      target: 'lowest_ally_hp',
      intervalMs: 1_000,
      accuracy: 1,
    };
    const healing = advanceCombat(
      createCombatState(
        'default-heal',
        [
          actor('a-no-heal-value', 'party', {
            actions: [noHealValue],
            actionPriority: [noHealValue.id],
          }),
          actor('b-injured', 'party', { hp: { current: 10, maximum: 100 }, actions: [] }),
          actor('z-heal-enemy', 'enemy', { actions: [] }),
        ],
        6,
      ),
      0,
    );
    expect(healing.actors.find((entry) => entry.id === 'b-injured')?.hp.current).toBe(10);
  });

  it('executes declarative counterplay, reactive effects, and default death-burst fields', () => {
    const extraTags = loadTagRegistry([
      ...BASE_ENEMY_TAGS,
      {
        id: 'mod:value-gate',
        category: 'anatomy',
        name: 'Value Gate',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['targeting.check'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'value-gate',
            event: 'targeting.check',
            conditions: [],
            interactionId: 'mod:value-gate',
            potency: 1,
            priority: 1,
            effect: { type: 'target_gate', value: { requiredProperties: ['spiritual'] } },
          },
        ],
      },
      {
        id: 'mod:scalar-gate',
        category: 'anatomy',
        name: 'Scalar Gate',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['targeting.check'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'scalar-gate',
            event: 'targeting.check',
            conditions: [],
            interactionId: 'mod:scalar-gate',
            potency: 1,
            priority: 1,
            effect: { type: 'target_gate', value: 'ignored' },
          },
        ],
      },
      {
        id: 'mod:path-affinity',
        category: 'affinity',
        name: 'Path Affinity',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['damage.incoming'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'path-relation',
            event: 'damage.incoming',
            conditions: [],
            interactionId: 'mod:path-affinity',
            potency: 1,
            priority: 1,
            effect: {
              type: 'elemental_relation',
              value: 1,
              affinityPath: 'defender.affinityElement',
              oppositesPath: 'environment.elementOpposites',
              sameElement: 1.5,
              oppositeElement: 0.5,
            },
          },
        ],
      },
      {
        id: 'mod:path-affinity-array',
        category: 'affinity',
        name: 'Path Affinity Array',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['damage.incoming'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'path-relation-array',
            event: 'damage.incoming',
            conditions: [],
            interactionId: 'mod:path-affinity-array',
            potency: 1,
            priority: 1,
            effect: {
              type: 'elemental_relation',
              value: 1,
              affinityPath: 'defender.affinityElements',
              oppositesPath: 'environment.elementOpposites',
              sameElement: 1.5,
              oppositeElement: 0.5,
            },
          },
        ],
      },
      {
        id: 'mod:energy-immunity',
        category: 'affinity',
        name: 'Energy Immunity',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['status.incoming'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'energy-immunity',
            event: 'status.incoming',
            conditions: [],
            interactionId: 'mod:energy-immunity',
            potency: 1,
            priority: 1,
            effect: { type: 'status_immunity', value: 'energy' },
          },
        ],
      },
      {
        id: 'mod:zero-vampirism',
        category: 'behavior',
        name: 'Dry Vampirism',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['damage.dealt'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'zero-vampirism',
            event: 'damage.dealt',
            conditions: [],
            interactionId: 'mod:zero-vampirism',
            potency: 1,
            priority: 1,
            effect: { type: 'vampirism', value: 0 },
          },
        ],
      },
      {
        id: 'mod:negative-corrosion',
        category: 'affinity',
        name: 'Negative Corrosion',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['damage.received'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'negative-corrosion',
            event: 'damage.received',
            conditions: [],
            interactionId: 'mod:negative-corrosion',
            potency: 1,
            priority: 1,
            effect: { type: 'corrode_armor', value: -1 },
          },
        ],
      },
      {
        id: 'mod:no-radius-burst',
        category: 'behavior',
        name: 'No Radius Burst',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['combat.death'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'default-burst',
            event: 'combat.death',
            conditions: [],
            interactionId: 'mod:no-radius-burst',
            potency: 1,
            priority: 1,
            effect: { type: 'death_burst', value: { amount: 5, channel: 'true' } },
          },
        ],
      },
    ]);

    const gateAction = { ...strike, id: 'base:gate-test' };
    const gated = advanceCombat(
      createCombatState(
        'gate-values',
        [
          actor('a-gate-attacker', 'party', {
            actions: [gateAction],
            actionPriority: [gateAction.id],
          }),
          actor('z-gated', 'enemy', { tags: ['mod:value-gate', 'mod:scalar-gate'], actions: [] }),
        ],
        8,
        {},
        extraTags,
      ),
      0,
    );
    expect(gated.log.find((entry) => entry.actorId === 'a-gate-attacker')?.blocked).toBe(true);

    const water = {
      ...strike,
      id: 'base:water-path',
      damage: { ...strike.damage!, channel: 'magical' as const, element: 'water' },
    };
    const affinity = advanceCombat(
      createCombatState(
        'path-affinity',
        [
          actor('a-water', 'party', { actions: [water], actionPriority: [water.id] }),
          actor('z-fire', 'enemy', {
            tags: ['mod:path-affinity'],
            affinityElement: 'fire',
            actions: [],
          }),
        ],
        9,
        { elementOpposites: { fire: ['water'] } },
        extraTags,
      ),
      0,
    );
    expect(affinity.log.find((entry) => entry.actorId === 'a-water')?.damageFinal).toBe(20);

    const noSelectedAffinity = advanceCombat(
      createCombatState(
        'no-selected-affinity',
        [
          actor('a-no-affinity', 'party', { actions: [water], actionPriority: [water.id] }),
          actor('z-unattuned', 'enemy', { tags: ['mod:path-affinity'], actions: [] }),
        ],
        9,
        { elementOpposites: { fire: ['water'] } },
        extraTags,
      ),
      0,
    );
    expect(
      noSelectedAffinity.log.find((entry) => entry.actorId === 'a-no-affinity')?.damageFinal,
    ).toBe(40);

    const affinityArrayPath = advanceCombat(
      createCombatState(
        'path-affinity-array',
        [
          actor('a-water-array', 'party', { actions: [water], actionPriority: [water.id] }),
          actor('z-fire-water-array', 'enemy', {
            tags: ['mod:path-affinity-array'],
            affinityElement: 'fire',
            affinityElements: ['fire', 'water'],
            actions: [],
          }),
        ],
        9,
        { elementOpposites: { fire: ['water'] } },
        extraTags,
      ),
      0,
    );
    expect(
      affinityArrayPath.log.find((entry) => entry.actorId === 'a-water-array')?.damageFinal,
    ).toBe(60);

    const multipleAffinities = advanceCombat(
      createCombatState(
        'multiple-path-affinities',
        [
          actor('a-water', 'party', { actions: [water], actionPriority: [water.id] }),
          actor('z-fire-water', 'enemy', {
            tags: ['mod:path-affinity'],
            affinityElement: 'fire',
            affinityElements: ['fire', 'water'],
            actions: [],
          }),
        ],
        9,
        { elementOpposites: { fire: ['water'] } },
        extraTags,
      ),
      0,
    );
    expect(multipleAffinities.log.find((entry) => entry.actorId === 'a-water')?.damageFinal).toBe(
      60,
    );

    const energyEffect: CombatAction = {
      ...strike,
      id: 'base:energy-status',
      effects: [
        {
          id: 'mod:energy-bind',
          category: 'control',
          potency: 1,
          counter: 2,
          source: { kind: 'effect', id: 'mod:energy-bolt' },
        },
      ],
    };
    const immune = advanceCombat(
      createCombatState(
        'effect-immunity',
        [
          actor('a-energy', 'party', {
            actions: [energyEffect],
            actionPriority: [energyEffect.id],
          }),
          actor('z-immune', 'enemy', { tags: ['mod:energy-immunity'], actions: [] }),
        ],
        10,
        {},
        extraTags,
      ),
      0,
    );
    expect(immune.actors.find((entry) => entry.id === 'z-immune')?.effects).toEqual([]);

    const vamp = advanceCombat(
      createCombatState(
        'zero-vamp',
        [
          actor('a-no-vamp', 'party', {
            tags: ['mod:zero-vampirism'],
            hp: { current: 10, maximum: 100 },
          }),
          actor('z-vamp-target', 'enemy', { actions: [] }),
        ],
        11,
        {},
        extraTags,
      ),
      0,
    );
    expect(vamp.actors.find((entry) => entry.id === 'a-no-vamp')?.hp.current).toBe(10);

    const corrosion = advanceCombat(
      createCombatState(
        'negative-corrosion',
        [
          actor('a-corrosion-attacker', 'party', { mitigation: { physical: 0.5, magical: 0.5 } }),
          actor('z-corrosive', 'enemy', { tags: ['mod:negative-corrosion'], actions: [] }),
        ],
        12,
        {},
        extraTags,
      ),
      0,
    );
    expect(
      corrosion.actors.find((entry) => entry.id === 'a-corrosion-attacker')?.mitigation,
    ).toEqual({ physical: 0.5, magical: 0.5 });

    const finisher = {
      ...strike,
      id: 'base:burst-finisher',
      damage: { ...strike.damage!, amount: 100 },
    };
    const burst = advanceCombat(
      createCombatState(
        'default-burst-payload',
        [
          actor('a-killer', 'party', { actions: [finisher], actionPriority: [finisher.id] }),
          actor('b-near-ally', 'party', { position: { x: 2, y: 0 }, actions: [] }),
          actor('c-burst', 'enemy', {
            tags: ['mod:no-radius-burst'],
            hp: { current: 1, maximum: 1 },
            position: { x: 1, y: 0 },
            actions: [],
          }),
          actor('z-far', 'enemy', { position: { x: 20, y: 20 }, actions: [] }),
        ],
        13,
        {},
        extraTags,
      ),
      0,
    );
    expect(
      burst.log.some(
        (entry) => entry.actionId === 'death-burst:c-burst' && entry.targetId === 'b-near-ally',
      ),
    ).toBe(true);
    expect(
      burst.log.some(
        (entry) => entry.actionId === 'death-burst:c-burst' && entry.targetId === 'z-far',
      ),
    ).toBe(false);
  });

  it('selects policy and movement actions from declarative conditions and preferred range', () => {
    const forbiddenMove: CombatAction = {
      id: 'base:move-forbidden',
      name: 'Move',
      kind: 'move',
      target: 'enemy',
      intervalMs: 1_000,
      accuracy: 1,
    };
    const retreat: CombatAction = {
      ...forbiddenMove,
      id: 'base:retreat',
      name: 'Retreat',
      movement: { kind: 'retreat', distance: 1 },
    };
    const advance: CombatAction = {
      ...forbiddenMove,
      id: 'base:advance',
      name: 'Advance',
      movement: { kind: 'advance', distance: 1 },
    };
    const conditions = [
      { path: 'target.side', operator: 'eq' as const, value: 'enemy' },
      { path: 'actor.side', operator: 'neq' as const, value: 'enemy' },
      { path: 'target.hp.current', operator: 'lt' as const, value: 200 },
      { path: 'target.hp.current', operator: 'lte' as const, value: 100 },
      { path: 'actor.attributes.speed', operator: 'gt' as const, value: 5 },
      { path: 'actor.attributes.speed', operator: 'gte' as const, value: 10 },
    ];
    const hero = actor('a-hero', 'party', {
      tags: ['base:caster'],
      actions: [forbiddenMove, retreat, advance, strike],
      actionPriority: [forbiddenMove.id, retreat.id, advance.id, strike.id],
      policy: {
        id: 'policy:movement',
        rules: [
          ...conditions.map((condition) => ({
            actionId: retreat.id,
            priority: 10,
            conditions: [condition],
          })),
          {
            actionId: retreat.id,
            priority: 99,
            conditions: [{ path: 'actor.missing.value', operator: 'eq' as const, value: true }],
          },
          {
            actionId: retreat.id,
            priority: 99,
            conditions: [{ path: 'actor.name', operator: 'eq' as const, value: 'not-hero' }],
          },
          {
            actionId: retreat.id,
            priority: 99,
            conditions: [{ path: 'actor.name', operator: 'neq' as const, value: 'a-hero' }],
          },
        ],
      },
    });
    const result = advanceCombat(
      createCombatState('policy-movement', [hero, actor('z-enemy', 'enemy')], 1),
      0,
    );
    expect(result.log.find((entry) => entry.actorId === 'a-hero')?.actionId).toBe(retreat.id);
    expect(result.actors.find((entry) => entry.id === 'a-hero')?.position.x).toBe(-1);

    const stationary = advanceCombat(
      createCombatState(
        'stationary-policy',
        [
          actor('a-stationary', 'party', {
            tags: ['base:stationary'],
            actions: [forbiddenMove, strike],
            actionPriority: [forbiddenMove.id, strike.id],
          }),
          actor('z-stationary-target', 'enemy'),
        ],
        2,
      ),
      0,
    );
    expect(stationary.log.find((entry) => entry.actorId === 'a-stationary')?.actionId).toBe(
      strike.id,
    );

    const advancing = advanceCombat(
      createCombatState(
        'preferred-advance',
        [
          actor('a-caster', 'party', {
            tags: ['base:caster'],
            actions: [advance],
            actionPriority: [advance.id],
          }),
          actor('z-far-target', 'enemy', { position: { x: 5, y: 0 }, actions: [] }),
        ],
        2,
      ),
      0,
    );
    expect(advancing.actors.find((entry) => entry.id === 'a-caster')?.position.x).toBe(1);
  });

  it('intercepts through stable guardian ordering and removes or replaces statuses by the canonical precedence', () => {
    const intercepted = advanceCombat(
      createCombatState(
        'multiple-guardians',
        [
          actor('a-hero', 'party'),
          actor('a-guardian', 'enemy', { tags: ['base:guardian'], actions: [] }),
          actor('b-guardian', 'enemy', { tags: ['base:guardian'], actions: [] }),
          actor('z-target', 'enemy', { actions: [] }),
        ],
        1,
      ),
      0,
    );
    expect(intercepted.log.find((entry) => entry.actorId === 'a-hero')?.targetId).toBe(
      'b-guardian',
    );

    const cleanse: CombatAction = {
      ...strike,
      id: 'base:cleanse',
      removeEffects: ['base:old'],
      effects: [
        { id: 'base:renewed', category: 'buff', potency: 2, counter: 5 },
        { id: 'base:biology', category: 'biological', potency: 3, counter: 2 },
      ],
    };
    const effects = advanceCombat(
      createCombatState(
        'cleanse',
        [
          actor('a-hero', 'party', { actions: [cleanse], actionPriority: [cleanse.id] }),
          actor('z-construct', 'enemy', {
            tags: ['base:construct'],
            effects: [
              { id: 'base:old', category: 'debuff', potency: 1, counter: 1 },
              { id: 'base:renewed', category: 'buff', potency: 2, counter: 1 },
            ],
          }),
        ],
        1,
      ),
      0,
    );
    expect(effects.actors.find((entry) => entry.id === 'z-construct')?.effects).toContainEqual(
      expect.objectContaining({ id: 'base:renewed', counter: 5 }),
    );
    expect(
      effects.actors
        .find((entry) => entry.id === 'z-construct')
        ?.effects.some((effect) => effect.id === 'base:biology' || effect.id === 'base:old'),
    ).toBe(false);
    expect(effects.log.find((entry) => entry.actorId === 'a-hero')?.effectsApplied).toContain(
      'removed:base:old',
    );
  });

  it('handles hazards, full-health regeneration, lethal effect ticks, and their offline winner event', () => {
    const environmentState = createCombatState(
      'hazard-environment',
      [
        actor('a-beast', 'party', {
          tags: ['base:beast', 'base:plant', 'base:amphibious', 'base:nocturnal'],
          actions: [],
          hp: { current: 100, maximum: 100 },
        }),
        actor('z-enemy', 'enemy', { actions: [] }),
      ],
      1,
      { hazard: 'trap', condition: 'fertile', type: 'water', timeOfDay: 'night' },
    );
    const environmentResult = advanceCombat(environmentState, 0);
    expect(environmentResult.log[0]?.effectsApplied).toContain('hazard-awareness:trap');
    expect(
      environmentResult.log[0]?.effectsApplied.some((effect) => effect.startsWith('environment:')),
    ).toBe(true);
    expect(environmentResult.log[0]?.effectsApplied).not.toContain('regeneration:0');
    expect(environmentResult.actors.find((entry) => entry.id === 'a-beast')?.nextEventAt).toBe(800);

    const ticking = actor('z-ticking', 'enemy', {
      hp: { current: 2, maximum: 2 },
      effects: [
        { id: 'base:no-tick', category: 'buff', potency: 1, counter: 1 },
        {
          id: 'base:future-tick',
          category: 'dot',
          potency: 1,
          counter: 4,
          tickDamage: { amount: 1, channel: 'true' },
          tickIntervalMs: 1000,
          nextTickAt: 2000,
        },
        {
          id: 'base:expiry-tick',
          category: 'dot',
          potency: 1,
          counter: 1,
          expiresAt: 1000,
          tickDamage: { amount: 1, channel: 'true' },
          tickIntervalMs: 1000,
          nextTickAt: 1000,
        },
        {
          id: 'base:lethal-tick',
          category: 'dot',
          potency: 0,
          counter: 2,
          tickDamage: { amount: 2, channel: 'true' },
          tickIntervalMs: 1000,
          nextTickAt: 1000,
          expiresAt: 2000,
        },
      ],
    });
    const alreadyDead = actor('y-dead-status', 'enemy', {
      hp: { current: 0, maximum: 10 },
      actions: [],
      effects: [
        {
          id: 'base:dead-dot',
          category: 'dot',
          potency: 1,
          counter: 2,
          tickDamage: { amount: 1, channel: 'true' },
          tickIntervalMs: 1000,
          nextTickAt: 1000,
        },
      ],
    });
    const ticked = advanceCombat(
      createCombatState(
        'lethal-tick',
        [actor('a-source', 'party', { actions: [] }), ticking, alreadyDead],
        2,
      ),
      1000,
    );
    expect(ticked.winner).toBe('party');
    expect(
      ticked.log.find((entry) => entry.actionId === 'status:base:lethal-tick')?.damageFinal,
    ).toBe(2);
  });

  it('records paid counterattacks, skips unavailable reactions, handles death bursts, and clones detailed logs', () => {
    const costlyCounter = {
      ...strike,
      id: 'base:costly-counter',
      cost: { resource: 'mana', amount: 2 },
    };
    const alternateCounter = {
      ...strike,
      id: 'base:alternate-counter',
      damage: { ...strike.damage!, amount: 20 },
    };
    const countered = advanceCombat(
      createCombatState(
        'costly-counter',
        [
          actor('a-hero', 'party', { actions: [strike], actionPriority: [strike.id] }),
          actor('z-counter', 'enemy', {
            tags: ['base:counterattacker'],
            actions: [costlyCounter, alternateCounter],
            actionPriority: [costlyCounter.id, alternateCounter.id],
            energy: { mana: 2 },
            evasion: { chance: 1, guaranteed: 0 },
          }),
        ],
        1,
      ),
      0,
    );
    expect(countered.actors.find((entry) => entry.id === 'z-counter')?.energy.mana).toBe(0);
    expect(countered.log.some((entry) => entry.message.includes('contra-ataca'))).toBe(true);

    const noReaction = advanceCombat(
      createCombatState(
        'no-reaction',
        [
          actor('a-hero', 'party'),
          actor('z-defender', 'enemy', { evasion: { chance: 1, guaranteed: 0 } }),
        ],
        1,
      ),
      0,
    );
    expect(noReaction.log.filter((entry) => entry.message.includes('contra-ataca'))).toHaveLength(
      0,
    );
    const noCounterAction = advanceCombat(
      createCombatState(
        'no-counter-action',
        [
          actor('a-hero', 'party'),
          actor('z-empty-counter', 'enemy', {
            tags: ['base:counterattacker'],
            actions: [],
            evasion: { chance: 1, guaranteed: 0 },
          }),
        ],
        1,
      ),
      0,
    );
    expect(
      noCounterAction.log.filter((entry) => entry.message.includes('contra-ataca')),
    ).toHaveLength(0);

    const noPriority = advanceCombat(
      createCombatState(
        'counter-priority-tie',
        [
          actor('a-priority-hero', 'party'),
          actor('z-priority-counter', 'enemy', {
            tags: ['base:counterattacker'],
            actions: [costlyCounter, alternateCounter],
            actionPriority: [],
            energy: { mana: 2 },
            evasion: { chance: 1, guaranteed: 0 },
          }),
        ],
        14,
      ),
      0,
    );
    expect(noPriority.log.find((entry) => entry.message.includes('contra-ataca'))?.actionId).toBe(
      alternateCounter.id,
    );

    const missCounter = { ...strike, id: 'base:miss-counter', accuracy: 0 };
    const missedReaction = advanceCombat(
      createCombatState(
        'counter-miss',
        [
          actor('a-miss-hero', 'party'),
          actor('z-miss-counter', 'enemy', {
            tags: ['base:counterattacker'],
            actions: [missCounter],
            actionPriority: [missCounter.id],
            evasion: { chance: 1, guaranteed: 1 },
          }),
        ],
        15,
      ),
      0,
    );
    expect(missedReaction.log.find((entry) => entry.message.includes('contra-ataca'))?.hit).toBe(
      false,
    );

    const paidAction = { ...strike, id: 'base:paid-action', cost: { resource: 'mana', amount: 1 } };
    const paid = advanceCombat(
      createCombatState(
        'paid-action',
        [
          actor('a-paid', 'party', {
            actions: [paidAction],
            actionPriority: [paidAction.id],
            energy: { mana: 2 },
          }),
          actor('z-paid-target', 'enemy', { actions: [] }),
        ],
        2,
      ),
      0,
    );
    expect(paid.log[0]?.resourceChanges).toEqual([
      { actorId: 'a-paid', resource: 'mana', before: 2, after: 1 },
    ]);

    const badBurst = loadTagRegistry([
      ...BASE_ENEMY_TAGS,
      {
        id: 'mod:invalid-burst',
        category: 'behavior',
        name: 'Invalid Burst',
        description: '',
        origin: 'mod:test',
        activationConditions: [],
        eventsObserved: ['combat.death'],
        interactions: [],
        requirements: [],
        properties: [],
        modifiers: [
          {
            id: 'null-payload',
            event: 'combat.death',
            conditions: [],
            interactionId: 'mod:null-burst',
            potency: 1,
            priority: 1,
            effect: { type: 'death_burst', value: null },
          },
          {
            id: 'wrong-payload',
            event: 'combat.death',
            conditions: [],
            interactionId: 'mod:wrong-burst',
            potency: 1,
            priority: 1,
            effect: { type: 'death_burst', value: { amount: 'large', channel: 'energy' } },
          },
        ],
      },
    ]);
    const burst = advanceCombat(
      createCombatState(
        'death-burst-range',
        [
          actor('a-hero', 'party', {
            hp: { current: 1, maximum: 100 },
            actions: [{ ...strike, damage: { ...strike.damage!, amount: 500 } }],
            actionPriority: [strike.id],
          }),
          actor('b-backup', 'party', { position: { x: 8, y: 0 }, actions: [] }),
          actor('z-volatile', 'enemy', {
            tags: ['base:volatile', 'mod:invalid-burst'],
            hp: { current: 1, maximum: 1 },
            actions: [],
          }),
        ],
        3,
        {},
        badBurst,
      ),
      0,
    );
    expect(
      burst.log.some(
        (entry) => entry.actionId === 'death-burst:z-volatile' && entry.targetId === 'a-hero',
      ),
    ).toBe(true);
    expect(
      burst.log.some(
        (entry) => entry.actionId === 'death-burst:z-volatile' && entry.targetId === 'b-backup',
      ),
    ).toBe(false);

    const lightning: CombatAction = {
      ...strike,
      id: 'base:chain-lethal',
      damage: { ...strike.damage!, amount: 400, channel: 'magical', element: 'lightning' },
    };
    const chain = advanceCombat(
      createCombatState(
        'chain-kill',
        [
          actor('a-chain-hero', 'party', { actions: [lightning], actionPriority: [lightning.id] }),
          actor('b-storm', 'enemy', {
            tags: ['base:stormbound'],
            hp: { current: 200, maximum: 200 },
            actions: [],
          }),
          actor('c-near', 'enemy', { position: { x: 2, y: 0 }, actions: [] }),
          actor('z-volatile-chain', 'enemy', {
            tags: ['base:volatile'],
            hp: { current: 1, maximum: 1 },
            position: { x: 2, y: 0 },
            actions: [],
          }),
        ],
        5,
      ),
      0,
    );
    expect(
      chain.log.some(
        (entry) =>
          entry.actionId === `chain:${lightning.id}` &&
          entry.targetId === 'z-volatile-chain' &&
          entry.killed,
      ),
    ).toBe(true);
    expect(
      chain.log.some(
        (entry) => entry.actionId === 'death-burst:z-volatile-chain' && entry.targetId === 'c-near',
      ),
    ).toBe(true);

    const seeded = createCombatState(
      'clone-log',
      [actor('a-idle', 'party', { actions: [] }), actor('z-idle', 'enemy', { actions: [] })],
      4,
    );
    seeded.log.push({
      id: 'seed:event:1',
      timeMs: 0,
      kind: 'attack',
      actorId: 'a',
      hit: true,
      evaded: false,
      blocked: false,
      damageInitial: 0,
      damageFinal: 0,
      modifiers: [{ id: 'm', source: 's', stage: 'damage', value: 1 }],
      tagInteractions: [{ tagId: 't', ruleId: 'r', interactionId: 'i', reason: 'r' }],
      resourceChanges: [{ actorId: 'a', resource: 'mana', before: 1, after: 0 }],
      effectsApplied: ['effect'],
      killed: false,
      message: 'stored',
    });
    expect(advanceCombat(seeded, 0).log[0]).toEqual(seeded.log[0]);
  });
});
