import { describe, expect, it } from 'vitest';
import {
  BASE_ENEMY_TAGS,
  evaluateTagEffects,
  loadTagRegistry,
  type EnemyTagDefinition,
  type TagCondition,
} from './tag-registry';

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (typeof child !== 'object' || child === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = segments.at(-1);
  if (leaf) {
    current[leaf] = value;
  }
}

function matchingContext(conditions: TagCondition[]): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const condition of conditions) {
    if (condition.op === 'eq') {
      setPath(context, condition.path, condition.value);
    } else if (condition.op === 'includes') {
      setPath(context, condition.path, [condition.value]);
    } else if (condition.op === 'includes_any') {
      setPath(context, condition.path, Array.isArray(condition.value) ? [condition.value[0]] : []);
    } else if (
      condition.op === 'not_includes' ||
      condition.op === 'not_includes_any' ||
      condition.op === 'not_includes_id'
    ) {
      setPath(context, condition.path, []);
    } else if (condition.op === 'truthy') {
      setPath(context, condition.path, true);
    } else if (condition.op === 'gt' && typeof condition.value === 'number') {
      setPath(context, condition.path, condition.value + 1);
    } else if (condition.op === 'lt' && typeof condition.value === 'number') {
      setPath(context, condition.path, condition.value - 1);
    } else if (condition.op === 'eq_field') {
      const field = String(condition.value);
      const value = 'matched';
      setPath(context, condition.path, value);
      setPath(context, field, value);
    } else if (condition.op === 'neq') {
      setPath(context, condition.path, '__different__');
    }
  }
  return context;
}

const registry = loadTagRegistry(BASE_ENEMY_TAGS);

describe('data driven enemy tags', () => {
  it('loads the complete namespaced 52 tag base registry as executable rules', () => {
    expect(registry).toHaveLength(52);
    expect(registry.every((tag) => tag.id.startsWith('base:'))).toBe(true);
    expect(registry.every((tag) => tag.modifiers.length > 0)).toBe(true);
    expect(new Set(registry.map((tag) => tag.id)).size).toBe(52);
  });

  it('does not multiply an equivalent shadow resistance from two tags twice', () => {
    const result = evaluateTagEffects(['base:undead', 'base:cursed'], 'damage.incoming', {
      damage: { element: 'shadow', channel: 'magical', properties: [] },
    });

    expect(result.filter((effect) => effect.interactionId === 'damage:shadow')).toHaveLength(1);
    expect(result.find((effect) => effect.interactionId === 'damage:shadow')?.type).toBe(
      'damage_multiplier',
    );
    expect(result.find((effect) => effect.interactionId === 'damage:shadow')?.value).toBe(0.5);
  });

  it('makes an unanchored ghost intangible to ordinary physical attacks', () => {
    const ordinary = evaluateTagEffects(['base:ghost', 'base:ethereal'], 'targeting.check', {
      attack: { channel: 'physical', properties: [] },
    });
    const anchored = evaluateTagEffects(['base:ghost', 'base:ethereal'], 'targeting.check', {
      attack: { channel: 'physical', properties: ['spiritual', 'anchoring'] },
    });
    const telekinetic = evaluateTagEffects(['base:ghost', 'base:ethereal'], 'targeting.check', {
      attack: { channel: 'physical', properties: ['telekinetic'] },
    });

    expect(ordinary.some((effect) => effect.type === 'target_gate')).toBe(true);
    expect(anchored.some((effect) => effect.type === 'target_gate')).toBe(false);
    expect(telekinetic.some((effect) => effect.type === 'target_gate')).toBe(false);
  });

  it('applies material weaknesses and environmental affinity from rules, not creature names', () => {
    const mineral = evaluateTagEffects(['base:mineral'], 'damage.incoming', {
      damage: { channel: 'physical', subtype: 'crushing', properties: [] },
    });
    const plant = evaluateTagEffects(['base:plant'], 'environment.tick', {
      environment: { element: 'nature', condition: 'fertile' },
    });

    expect(
      mineral.some(
        (effect) =>
          effect.type === 'damage_multiplier' &&
          typeof effect.value === 'number' &&
          effect.value > 1,
      ),
    ).toBe(true);
    expect(plant.some((effect) => effect.type === 'regeneration')).toBe(true);
  });

  it('validates duplicate IDs, unnamespaced IDs, invalid rules, and unknown lookups', () => {
    expect(() => loadTagRegistry([BASE_ENEMY_TAGS[0], BASE_ENEMY_TAGS[0]])).toThrow(
      'Duplicate enemy tag id',
    );
    const firstTag = BASE_ENEMY_TAGS[0] as Record<string, unknown>;
    expect(() => loadTagRegistry([{ ...firstTag, id: 'undead' }])).toThrow(
      'Enemy tag id must include a namespace',
    );
    expect(() =>
      loadTagRegistry([
        {
          ...firstTag,
          modifiers: [
            {
              id: '',
              event: '',
              conditions: [],
              interactionId: '',
              potency: -1,
              priority: 0,
              effect: { type: 'unknown' },
            },
          ],
        },
      ]),
    ).toThrow('Invalid enemy tag rule');
    expect(() => evaluateTagEffects(['missing:tag'], 'damage.incoming', {})).toThrow(
      'Unknown enemy tag',
    );
  });

  it('requires finite positive values for duration and potency multipliers', () => {
    const template = registry[0]!;
    const tagWithMultiplier = (type: string, value: unknown) => ({
      ...template,
      id: 'race:test-duration',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-duration:rule',
          event: 'status.incoming',
          interactionId: 'race:test-duration',
          conditions: [],
          effect: { type, value },
        },
      ],
    });

    for (const type of ['status_duration_multiplier', 'status_potency_multiplier']) {
      expect(loadTagRegistry([tagWithMultiplier(type, 0.5)])).toHaveLength(1);
      for (const invalidValue of [undefined, 0, Infinity]) {
        expect(() => loadTagRegistry([tagWithMultiplier(type, invalidValue)])).toThrow(
          'Invalid enemy tag rule',
        );
      }
    }
  });

  it('requires maximum HP regeneration effects to use a finite positive fraction', () => {
    const template = registry[0]!;
    const tagWithRegeneration = (value: unknown) => ({
      ...template,
      id: 'race:test-max-hp-regeneration',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-max-hp-regeneration:rule',
          event: 'environment.tick',
          interactionId: 'race:test-max-hp-regeneration',
          conditions: [],
          effect: { type: 'max_hp_regeneration', value },
        },
      ],
    });

    expect(loadTagRegistry([tagWithRegeneration(0.01)])).toHaveLength(1);
    for (const invalidValue of [undefined, '0.01', Infinity, 0]) {
      expect(() => loadTagRegistry([tagWithRegeneration(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });

  it('validates environment-applied status payloads and damage tick intervals', () => {
    const template = registry[0]!;
    const tagWithEnvironmentStatus = (value: unknown) => ({
      ...template,
      id: 'race:test-environment-status',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-environment-status:rule',
          event: 'environment.tick',
          interactionId: 'race:test-environment-status',
          conditions: [],
          effect: { type: 'environment_status', value },
        },
      ],
    });
    const status = { id: 'core:burn', category: 'dot', potency: 99, counter: 99 };

    expect(loadTagRegistry([tagWithEnvironmentStatus(status)])).toHaveLength(1);
    expect(
      loadTagRegistry([
        tagWithEnvironmentStatus({
          ...status,
          tickDamage: { amount: 1, channel: 'magical' },
          tickIntervalMs: 1_000,
        }),
      ]),
    ).toHaveLength(1);
    for (const invalidValue of [
      undefined,
      'core:burn',
      { ...status, tickDamage: { amount: 1, channel: 'fire' }, tickIntervalMs: 1_000 },
      { ...status, tickDamage: { amount: 1, channel: 'magical' } },
    ]) {
      expect(() => loadTagRegistry([tagWithEnvironmentStatus(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });

  it('requires persistent-status rules to name a status id', () => {
    const template = registry[0]!;
    const tagWithPersistence = (value: unknown) => ({
      ...template,
      id: 'race:test-persistence',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-persistence:rule',
          event: 'status.incoming',
          interactionId: 'race:test-persistence',
          conditions: [],
          effect: { type: 'status_persistence', value },
        },
      ],
    });

    expect(loadTagRegistry([tagWithPersistence('core:burn')])).toHaveLength(1);
    for (const invalidValue of [undefined, '', 2]) {
      expect(() => loadTagRegistry([tagWithPersistence(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });

  it('requires persistent-status rules to name a status id', () => {
    const template = registry[0]!;
    const tagWithPersistence = (value: unknown) => ({
      ...template,
      id: 'race:test-persistence',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-persistence:rule',
          event: 'status.incoming',
          interactionId: 'race:test-persistence',
          conditions: [],
          effect: { type: 'status_persistence', value },
        },
      ],
    });

    expect(loadTagRegistry([tagWithPersistence('core:burn')])).toHaveLength(1);
    for (const invalidValue of [undefined, '', 2]) {
      expect(() => loadTagRegistry([tagWithPersistence(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });

  it('validates action-forbidden rules for one or many action kinds', () => {
    const template = registry[0]!;
    const tagWithForbiddenActions = (value: unknown) => ({
      ...template,
      id: 'race:test-action-ban',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-action-ban:rule',
          event: 'action.select',
          interactionId: 'race:test-action-ban',
          conditions: [],
          effect: { type: 'action_forbidden', value },
        },
      ],
    });

    expect(loadTagRegistry([tagWithForbiddenActions('attack')])).toHaveLength(1);
    expect(loadTagRegistry([tagWithForbiddenActions(['attack', 'ranged'])])).toHaveLength(1);
    for (const invalidValue of [undefined, '', [], ['attack', '']]) {
      expect(() => loadTagRegistry([tagWithForbiddenActions(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });

  it('validates support reaction status payloads', () => {
    const template = registry[0]!;
    const tagWithSupportEffect = (value: unknown) => ({
      ...template,
      id: 'race:test-support',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'race:test-support:rule',
          event: 'support.completed',
          interactionId: 'race:test-support',
          conditions: [],
          effect: { type: 'on_support_effect', value },
        },
      ],
    });

    expect(
      loadTagRegistry([
        tagWithSupportEffect({ id: 'core:blessing', category: 'buff', potency: 4, counter: 1 }),
      ]),
    ).toHaveLength(1);
    for (const invalidValue of [undefined, 'core:blessing']) {
      expect(() => loadTagRegistry([tagWithSupportEffect(invalidValue)])).toThrow(
        'Invalid enemy tag rule',
      );
    }
  });
});

describe('every base tag rule is executable', () => {
  for (const tag of registry as EnemyTagDefinition[]) {
    describe(tag.id, () => {
      for (const rule of tag.modifiers) {
        it(`executes ${rule.id} on ${rule.event}`, () => {
          const effects = evaluateTagEffects(
            [tag.id],
            rule.event,
            matchingContext(rule.conditions),
          );
          expect(effects.some((effect) => effect.ruleId === rule.id)).toBe(true);
        });
      }
    });
  }
});

describe('extensible tag condition and precedence contracts', () => {
  const template = registry[0]!;
  const matches = (condition: TagCondition, context: Record<string, unknown>): boolean => {
    const tag = {
      ...template,
      id: 'test:condition',
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: 'test:rule',
          event: 'test.evaluate',
          interactionId: 'test:condition',
          conditions: [condition],
        },
      ],
    } as EnemyTagDefinition;
    return evaluateTagEffects([tag.id], 'test.evaluate', context, [tag]).length === 1;
  };

  it('evaluates equality, collection, truthiness, and numeric conditions for matching and nonmatching inputs', () => {
    expect(matches({ path: 'a.b', op: 'eq', value: 3 }, { a: { b: 3 } })).toBe(true);
    expect(matches({ path: 'a.b', op: 'eq', value: 4 }, { a: { b: 3 } })).toBe(false);
    expect(matches({ path: 'a.b', op: 'neq', value: 4 }, { a: { b: 3 } })).toBe(true);
    expect(matches({ path: 'a.b', op: 'neq', value: 3 }, { a: { b: 3 } })).toBe(false);
    expect(matches({ path: 'a.b', op: 'eq_field', value: 'a.c' }, { a: { b: 3, c: 3 } })).toBe(
      true,
    );
    expect(matches({ path: 'a.b', op: 'eq_field', value: 'a.c' }, { a: { b: 3, c: 4 } })).toBe(
      false,
    );
    expect(matches({ path: 'a.b', op: 'eq_field' }, { a: {} })).toBe(true);
    expect(matches({ path: 'items', op: 'includes', value: 'x' }, { items: ['x'] })).toBe(true);
    expect(matches({ path: 'items', op: 'includes', value: 'x' }, { items: 'x' })).toBe(false);
    expect(
      matches({ path: 'items', op: 'includes_id', value: 'x' }, { items: [{ id: 'x' }] }),
    ).toBe(true);
    expect(
      matches(
        { path: 'items', op: 'includes_id', value: 'x' },
        { items: [{ id: 'y' }, { label: 'x' }, null, 'x'] },
      ),
    ).toBe(false);
    expect(matches({ path: 'items', op: 'includes_id', value: 'x' }, { items: {} })).toBe(false);
    expect(matches({ path: 'items', op: 'not_includes', value: 'x' }, { items: ['x'] })).toBe(
      false,
    );
    expect(matches({ path: 'items', op: 'not_includes', value: 'x' }, { items: null })).toBe(true);
    expect(
      matches({ path: 'items', op: 'includes_any', value: ['x', 'y'] }, { items: ['y'] }),
    ).toBe(true);
    expect(matches({ path: 'items', op: 'includes_any', value: ['x'] }, { items: ['z'] })).toBe(
      false,
    );
    expect(matches({ path: 'items', op: 'includes_any', value: 'x' }, { items: ['x'] })).toBe(
      false,
    );
    expect(matches({ path: 'items', op: 'not_includes_any', value: ['x'] }, { items: ['z'] })).toBe(
      true,
    );
    expect(matches({ path: 'items', op: 'not_includes_any', value: ['x'] }, { items: ['x'] })).toBe(
      false,
    );
    expect(matches({ path: 'items', op: 'not_includes_any', value: 'x' }, { items: ['x'] })).toBe(
      true,
    );
    expect(
      matches({ path: 'items', op: 'not_includes_id', value: 'x' }, { items: [{ id: 'x' }] }),
    ).toBe(false);
    expect(
      matches({ path: 'items', op: 'not_includes_id', value: 'x' }, { items: [{ id: 'y' }, null] }),
    ).toBe(true);
    expect(matches({ path: 'items', op: 'not_includes_id', value: 'x' }, { items: {} })).toBe(true);
    expect(matches({ path: 'flag', op: 'truthy' }, { flag: true })).toBe(true);
    expect(matches({ path: 'flag', op: 'truthy' }, {})).toBe(false);
    expect(matches({ path: 'flag', op: 'not_truthy' }, {})).toBe(true);
    expect(matches({ path: 'flag', op: 'not_truthy' }, { flag: true })).toBe(false);
    expect(matches({ path: 'n', op: 'lte', value: 2 }, { n: 2 })).toBe(true);
    expect(matches({ path: 'n', op: 'lte', value: 2 }, { n: 3 })).toBe(false);
    expect(matches({ path: 'n', op: 'lte', value: 2 }, { n: '2' })).toBe(false);
    expect(matches({ path: 'n', op: 'gte', value: 2 }, { n: 2 })).toBe(true);
    expect(matches({ path: 'n', op: 'gte', value: 2 }, { n: 1 })).toBe(false);
    expect(matches({ path: 'n', op: 'gte', value: 2 }, { n: null })).toBe(false);
    expect(matches({ path: 'n', op: 'gt', value: 2 }, { n: 3 })).toBe(true);
    expect(matches({ path: 'n', op: 'gt', value: 2 }, { n: 2 })).toBe(false);
    expect(matches({ path: 'n', op: 'gt', value: 2 }, { n: '3' })).toBe(false);
    expect(matches({ path: 'n', op: 'lt', value: 2 }, { n: 1 })).toBe(true);
    expect(matches({ path: 'n', op: 'lt', value: 2 }, { n: 2 })).toBe(false);
    expect(matches({ path: 'n', op: 'lt', value: 2 }, { n: null })).toBe(false);
    expect(matches({ path: 'a.b', op: 'eq', value: undefined }, { a: null })).toBe(true);
  });

  it('selects duplicate interactions by potency, then priority, then stable id order', () => {
    const competing = (
      id: string,
      ruleId: string,
      potency: number,
      priority: number,
    ): EnemyTagDefinition => ({
      ...template,
      id,
      modifiers: [
        {
          ...template.modifiers[0]!,
          id: ruleId,
          event: 'test.precedence',
          conditions: [],
          interactionId: 'shared',
          potency,
          priority,
          effect: { type: 'hazard_awareness', winner: ruleId },
        },
      ],
    });
    const weaker = competing('test:a', 'test:weaker', 1, 99);
    const stronger = competing('test:b', 'test:stronger', 2, 0);
    expect(
      evaluateTagEffects([weaker.id, stronger.id], 'test.precedence', {}, [weaker, stronger])[0]
        ?.ruleId,
    ).toBe('test:stronger');
    const lowerPriority = competing('test:a', 'test:lower-priority', 2, 1);
    const higherPriority = competing('test:b', 'test:higher-priority', 2, 2);
    expect(
      evaluateTagEffects([lowerPriority.id, higherPriority.id], 'test.precedence', {}, [
        lowerPriority,
        higherPriority,
      ])[0]?.ruleId,
    ).toBe('test:higher-priority');
    const lexicalA = competing('test:a', 'test:a-rule', 2, 2);
    const lexicalB = competing('test:b', 'test:b-rule', 2, 2);
    expect(
      evaluateTagEffects([lexicalB.id, lexicalA.id], 'test.precedence', {}, [lexicalB, lexicalA])[0]
        ?.ruleId,
    ).toBe('test:a-rule');
    const sortedA = competing('test:a', 'test:a-rule', 2, 2);
    const sortedB = {
      ...competing('test:b', 'test:b-rule', 2, 2),
      modifiers: [
        {
          ...competing('test:b', 'test:b-rule', 2, 2).modifiers[0]!,
          interactionId: 'other-interaction',
        },
      ],
    };
    expect(
      evaluateTagEffects([sortedA.id, sortedB.id], 'test.precedence', {}, [sortedA, sortedB]).map(
        (effect) => effect.interactionId,
      ),
    ).toEqual(['other-interaction', 'shared']);
    expect(() => loadTagRegistry([{}])).toThrow('Enemy tag id must include a namespace: <unknown>');
  });
});
