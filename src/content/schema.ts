import { z } from 'zod';
import { CombatSummonSpecSchema } from '../combat/schema';

const id = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const baseRecord = { id, name: z.string().trim().min(1), description: z.string() };

const originSchema = z.object({
  kind: z.enum(['weapon', 'ability', 'item', 'class', 'race', 'effect', 'node', 'mod']),
  id,
});
const damageModifierSchema = z.object({
  id,
  interactionId: id.optional(),
  operation: z.enum(['add', 'multiply']),
  value: z.number().finite(),
  potency: z.number().finite().nonnegative(),
  origin: originSchema,
});
const damageSchema = z.object({
  amount: z.number().int().nonnegative().safe(),
  channel: z.enum(['physical', 'magical', 'true']),
  subtype: z.enum(['cutting', 'piercing', 'crushing', 'other']).optional(),
  element: z.string().optional(),
  properties: z.array(z.string()),
  origin: originSchema,
  modifiers: z.array(damageModifierSchema).optional(),
});
const appliedEffectSchema = z
  .object({
    id,
    category: z.string(),
    potency: z.number().finite().nonnegative(),
    counter: z.number().int().nonnegative().safe(),
    source: originSchema.optional(),
    damageMultiplier: z.number().finite().optional(),
    damageChannel: z.enum(['physical', 'magical', 'true']).optional(),
    expiresAt: z.number().int().safe().optional(),
    tickDamage: z
      .object({
        amount: z.number().finite().nonnegative(),
        channel: z.enum(['physical', 'magical', 'true']),
        subtype: z.enum(['cutting', 'piercing', 'crushing', 'other']).optional(),
        element: z.string().optional(),
        properties: z.array(z.string()).optional(),
      })
      .optional(),
    tickIntervalMs: z.number().int().positive().safe().optional(),
    nextTickAt: z.number().int().nonnegative().safe().optional(),
    sourceActorId: id.optional(),
  })
  .passthrough();
const combatActionSchema = z.object({
  id,
  name: z.string().trim().min(1),
  kind: z.enum([
    'attack',
    'magic',
    'ranged',
    'area',
    'heal',
    'guard',
    'move',
    'summon',
    'support',
    'intercept',
    'combo',
  ]),
  target: z.enum(['enemy', 'ally', 'self', 'lowest_enemy_hp', 'lowest_ally_hp']),
  intervalMs: z.number().int().positive().safe(),
  accuracy: z.number().finite().min(0).max(1),
  damage: damageSchema.optional(),
  healing: z.number().int().nonnegative().safe().optional(),
  cost: z.object({ resource: id, amount: z.number().int().nonnegative().safe() }).optional(),
  effects: z.array(appliedEffectSchema).optional(),
  properties: z.array(z.string()).optional(),
  removeEffects: z.array(id).optional(),
  movement: z
    .object({
      kind: z.enum(['advance', 'retreat', 'push', 'pull', 'burrow', 'emerge']),
      distance: z.number().finite().nonnegative(),
    })
    .optional(),
  summon: CombatSummonSpecSchema.optional(),
});
const barsSchema = z.object({
  current: z.number().int().nonnegative().safe(),
  maximum: z.number().int().nonnegative().safe(),
});
const policySchema = z.object({
  id,
  rules: z.array(
    z.object({
      actionId: id,
      priority: z.number().finite(),
      conditions: z
        .array(
          z.object({
            path: z.string(),
            operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']),
            value: z.union([z.number(), z.string(), z.boolean()]),
          }),
        )
        .optional(),
    }),
  ),
});

export const EnemyTagRecordSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('enemy_tag'),
    category: z.enum(['nature', 'anatomy', 'affinity', 'movement', 'behavior']),
    origin: z.string().trim().min(1),
    activationConditions: z.array(z.string()),
    eventsObserved: z.array(z.string()),
    modifiers: z.array(
      z.object({
        id,
        event: z.string(),
        conditions: z.array(
          z.object({ path: z.string(), op: z.string(), value: z.unknown().optional() }),
        ),
        interactionId: id,
        potency: z.number().finite().nonnegative(),
        priority: z.number().finite(),
        effect: z.object({ type: z.string() }).passthrough(),
      }),
    ),
    interactions: z.array(z.object({ id: z.string(), counterplay: z.string() })),
    requirements: z.array(z.string()),
    properties: z.array(z.string()),
  })
  .passthrough();

const enemySchema = z
  .object({
    ...baseRecord,
    kind: z.literal('enemy'),
    tags: z.array(id),
    lootTableId: id.optional(),
    experience: z.number().int().nonnegative().safe(),
    attributes: z
      .object({
        vigor: z.number().finite(),
        resistance: z.number().finite(),
        speed: z.number().finite(),
        dexterity: z.number().finite(),
        precision: z.number().finite(),
        strength: z.number().finite(),
      })
      .catchall(z.number().finite()),
    hp: barsSchema,
    tenacity: barsSchema,
    energy: z.record(z.string(), z.number().finite()),
    equipment: z.array(z.object({ id, properties: z.array(z.string()).optional() })),
    actions: z.array(combatActionSchema),
    effects: z.array(appliedEffectSchema),
    policy: policySchema,
    actionPriority: z.array(id),
    mitigation: z.object({
      physical: z.number().finite().min(0).max(1),
      magical: z.number().finite().min(0).max(1),
    }),
    evasion: z
      .object({
        chance: z.number().finite().min(0).max(1),
        guaranteed: z.number().int().nonnegative().safe(),
      })
      .optional(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    affinityElement: z.string().optional(),
    movementState: z.string().optional(),
    variantId: id.optional(),
    elite: z.boolean().optional(),
    boss: z.boolean().optional(),
  })
  .passthrough();

const lootEntrySchema = z.object({
  itemId: id,
  quantity: z.number().int().positive().safe(),
  chance: z.number().finite().min(0).max(1).optional(),
  weight: z.number().int().positive().safe().optional(),
});
const lootConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tag'), value: id }),
  z.object({ kind: z.literal('enemy_id'), value: id }),
  z.object({ kind: z.literal('death_cause'), value: z.string() }),
  z.object({ kind: z.literal('activity_kind'), value: z.enum(['quest', 'dungeon', 'raid']) }),
  z.object({ kind: z.literal('environment'), key: z.string(), value: z.string() }),
]);
const lootTableSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('loot_table'),
    guaranteed: z.array(lootEntrySchema).optional(),
    independent: z.array(lootEntrySchema).optional(),
    exclusive: z
      .array(
        z.object({
          id,
          rolls: z.number().int().nonnegative().safe(),
          entries: z.array(lootEntrySchema).min(1),
        }),
      )
      .optional(),
    conditional: z
      .array(
        z.object({
          id,
          when: z.array(lootConditionSchema),
          drops: z.array(lootEntrySchema),
          unlockNodeIds: z.array(id).optional(),
        }),
      )
      .optional(),
    unlockNodeIds: z.array(id).optional(),
  })
  .passthrough();
const expeditionSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('expedition'),
    activityKind: z.enum(['quest', 'dungeon', 'raid']),
    spawnIntervalMs: z.number().int().positive().safe(),
    deathRewardRetention: z.number().finite().min(0).max(1),
    environment: z
      .object({
        type: z.string().optional(),
        condition: z.string().optional(),
        timeOfDay: z.string().optional(),
        hazard: z.string().optional(),
        elementOpposites: z.record(z.string(), z.array(z.string())).optional(),
      })
      .passthrough(),
    encounters: z
      .array(
        z.object({
          id,
          enemyId: id,
          weight: z.number().int().positive().safe(),
          count: z.number().int().positive().safe().optional(),
          variantId: id.optional(),
        }),
      )
      .min(1),
    nodeUnlocks: z.array(id).optional(),
  })
  .passthrough();
const recipeSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('recipe'),
    inputs: z.record(id, z.number().int().positive().safe()),
    resultItemId: id,
    resultQuantity: z.number().int().positive().safe().default(1),
    skillId: id.optional(),
    requiredSkillLevel: z.number().int().positive().safe().optional(),
    requiredLevel: z.number().int().positive().safe().optional(),
    experience: z.number().int().nonnegative().safe().optional(),
    station: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const RegionSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('region'),
    terrain: z.array(z.string().trim().min(1)),
    climate: z.array(z.string().trim().min(1)),
    localities: z.array(z.string().trim().min(1)),
    materials: z.array(id),
    enemies: z.array(id),
    expeditionIds: z.array(id),
    activityIds: z.array(id),
    unlockRequirements: z
      .object({
        level: z.number().int().positive().safe().optional(),
        regionIds: z.array(id).optional(),
      })
      .optional(),
  })
  .passthrough();

const shopEntrySchema = z.object({
  itemId: id,
  currency: z.string().trim().min(1),
  price: z.number().int().nonnegative().safe(),
  sellPrice: z.number().int().nonnegative().safe().optional(),
  stock: z.number().int().min(-1).safe().optional(),
  requiredLevel: z.number().int().positive().safe().optional(),
  requiredSkill: id.optional(),
  requiredSkillLevel: z.number().int().positive().safe().optional(),
});
export const ShopSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('shop'),
    cadence: z.enum(['permanent', 'daily', 'weekly']),
    entries: z.array(shopEntrySchema),
    regionId: id.optional(),
  })
  .passthrough();

export const EnergySchema = z
  .object({
    ...baseRecord,
    kind: z.literal('energy'),
    origin: z.string().trim().min(1),
    resources: z.array(id),
    progression: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export const SystemSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('system'),
    systemType: z.string().trim().min(1),
    entries: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

const racialCombatTagSchema = EnemyTagRecordSchema.omit({ kind: true });
export const RaceSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('race'),
    lore: z.string().optional(),
    advantages: z.array(z.string()).optional(),
    disadvantages: z.array(z.string()).optional(),
    combatTags: z.array(id).optional(),
    combatTag: racialCombatTagSchema.optional(),
    combatActions: z.array(combatActionSchema).optional(),
    combatStartEffects: z.array(appliedEffectSchema).optional(),
    activityBonuses: z
      .array(z.object({ skillId: id, yieldMultiplier: z.number().finite().positive() }))
      .optional(),
  })
  .passthrough();
export const ClassSchema = z.object({ ...baseRecord, kind: z.literal('class') }).passthrough();
export const ItemSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('item'),
    stackable: z.boolean(),
    slot: z
      .enum(['head', 'chest', 'legs', 'hands', 'feet', 'primary', 'secondary', 'accessory'])
      .optional(),
    properties: z.array(z.string()).optional(),
    combat: z
      .object({
        damage: damageSchema.optional(),
        mitigation: z
          .object({ physical: z.number().finite(), magical: z.number().finite() })
          .optional(),
        modifiers: z.array(damageModifierSchema).optional(),
        speed: z.number().finite().optional(),
        cost: z.object({ resource: id, amount: z.number().int().nonnegative().safe() }).optional(),
        energyBonus: z.record(id, z.number().finite()).optional(),
      })
      .passthrough()
      .optional(),
    materialProfile: z
      .object({
        properties: z.array(z.string()),
        weaponProperties: z.array(z.string()),
        armorProperties: z.array(z.string()),
        combatEffects: z.array(z.record(z.string(), z.unknown())),
      })
      .passthrough()
      .optional(),
    consumable: z
      .discriminatedUnion('effect', [
        z.object({ effect: z.literal('heal'), amount: z.number().int().positive().safe() }),
        z.object({
          effect: z.literal('restore-resource'),
          resource: id,
          amount: z.number().int().positive().safe(),
        }),
      ])
      .optional(),
  })
  .passthrough();
export const ActivitySchema = z
  .object({
    ...baseRecord,
    kind: z.literal('activity'),
    rewardId: id,
    category: z.string().trim().min(1),
    expeditionId: id.optional(),
    regionId: id.optional(),
    skillId: id.optional(),
    requiredLevel: z.number().int().positive().safe().optional(),
    requiredSkillLevel: z.number().int().positive().safe().optional(),
    cycleDurationMs: z.number().int().positive().safe().optional(),
    outputItemId: id.optional(),
    outputQuantity: z.number().int().positive().safe().optional(),
    skillExperience: z.number().int().nonnegative().safe().optional(),
    activityExperience: z.number().int().nonnegative().safe().optional(),
    fragmentReward: z.number().int().nonnegative().safe().optional(),
    trainingEffect: z
      .object({
        attributeId: z.enum([
          'physical:vigor',
          'physical:resistance',
          'physical:speed',
          'physical:dexterity',
          'physical:precision',
          'physical:strength',
          'energy:chi',
          'energy:mana',
          'energy:spirit',
        ]),
        amount: z.number().int().positive().safe(),
      })
      .optional(),
  })
  .passthrough();
export const RewardSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('reward'),
    experience: z.number().int().nonnegative().safe(),
    items: z.array(z.object({ itemId: id, quantity: z.number().int().positive().safe() })),
  })
  .passthrough();
export const SkillSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('skill'),
    activityIds: z.array(id),
    category: z.string().trim().min(1).optional(),
    experiencePerLevel: z.number().int().positive().safe().optional(),
    milestones: z
      .array(
        z.object({
          level: z.number().int().positive().safe(),
          name: z.string(),
          effects: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .optional(),
  })
  .passthrough();
export const EffectSchema = z
  .object({ ...baseRecord, kind: z.literal('effect'), payload: z.record(z.string(), z.unknown()) })
  .passthrough();
export const MissionSchema = z
  .object({
    ...baseRecord,
    kind: z.literal('mission'),
    cadence: z.enum(['main', 'secondary', 'daily', 'weekly']),
    eventType: z.enum([
      'session.completed',
      'expedition.completed',
      'experience.gained',
      'item.acquired',
      'item.consumed',
      'activity.completed',
      'skill.level_increased',
      'attribute.increased',
      'attribute.points_awarded',
      'enemy.defeated',
      'quest.completed',
      'currency.earned',
      'item.crafted',
      'region.unlocked',
      'implant.installed',
    ]),
    target: z.number().int().positive().safe(),
    reward: z.object({
      experience: z.number().int().nonnegative().safe().default(0),
      items: z.record(id, z.number().int().positive().safe()).default({}),
      currencies: z.record(id, z.number().int().nonnegative().safe()).default({}),
    }),
    criteria: z.record(z.string(), z.unknown()).optional(),
    requiredLevel: z.number().int().positive().safe().optional(),
    regionId: id.optional(),
    prerequisites: z.array(id).optional(),
  })
  .passthrough();

export const ContentRecordSchema = z.discriminatedUnion('kind', [
  RaceSchema,
  ClassSchema,
  ItemSchema,
  ActivitySchema,
  RewardSchema,
  SkillSchema,
  EffectSchema,
  MissionSchema,
  EnemyTagRecordSchema,
  enemySchema,
  lootTableSchema,
  expeditionSchema,
  recipeSchema,
  RegionSchema,
  ShopSchema,
  EnergySchema,
  SystemSchema,
]);

export const ContentPackSchema = z.object({
  manifest: z
    .object({
      id,
      name: z.string().trim().min(1),
      version: z.string().trim().min(1),
      author: z.string().trim().min(1).optional(),
      dependencies: z.array(id).optional(),
      compatibleWith: z.string().trim().min(1).optional(),
    })
    .passthrough(),
  records: z.array(ContentRecordSchema),
  nodes: z.array(z.unknown()).optional(),
  glyphs: z.array(z.unknown()).optional(),
  sigils: z.array(z.unknown()).optional(),
  rules: z
    .object({
      experiencePerLevel: z.number().int().positive().safe(),
      maxLevel: z.number().int().positive().safe().optional(),
      attributePointsPerLevel: z.number().int().positive().safe().optional(),
      combat: z
        .object({
          accuracy: z.number().finite().min(0).max(1),
          intervalMs: z.number().int().positive().safe(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),
});

export type ContentPack = z.infer<typeof ContentPackSchema>;
export type ContentRecord = z.infer<typeof ContentRecordSchema>;
export type RaceDefinition = z.infer<typeof RaceSchema>;
export type RegionDefinition = z.infer<typeof RegionSchema>;
export type ShopDefinition = z.infer<typeof ShopSchema>;
export type EnergyDefinition = z.infer<typeof EnergySchema>;
export type SystemDefinition = z.infer<typeof SystemSchema>;
export type ClassDefinition = z.infer<typeof ClassSchema>;
export type ItemDefinition = z.infer<typeof ItemSchema>;
export type ActivityDefinition = z.infer<typeof ActivitySchema>;
export type RewardDefinition = z.infer<typeof RewardSchema>;
export type SkillDefinition = z.infer<typeof SkillSchema>;
export type EffectDefinition = z.infer<typeof EffectSchema>;
export type MissionDefinition = z.infer<typeof MissionSchema>;
export type EnemyTagRecord = z.infer<typeof EnemyTagRecordSchema>;
export type EnemyDefinition = z.infer<typeof enemySchema>;
export type LootTableDefinition = z.infer<typeof lootTableSchema>;
export type ExpeditionDefinition = z.infer<typeof expeditionSchema>;
export type RecipeDefinition = z.infer<typeof recipeSchema>;
export type CombatDefaults = { accuracy: number; intervalMs: number };
