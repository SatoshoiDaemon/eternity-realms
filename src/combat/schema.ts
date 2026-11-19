import { z } from 'zod';

const originSchema = z.object({
  kind: z.enum(['weapon', 'ability', 'item', 'class', 'race', 'effect', 'node', 'mod']),
  id: z.string().trim().min(1),
});

const damageSchema = z.object({
  amount: z.number().int().nonnegative().safe(),
  channel: z.enum(['physical', 'magical', 'true']),
  subtype: z.enum(['cutting', 'piercing', 'crushing', 'other']).optional(),
  element: z.string().optional(),
  properties: z.array(z.string()),
  origin: originSchema,
  modifiers: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        interactionId: z.string().trim().min(1).optional(),
        operation: z.enum(['add', 'multiply']),
        value: z.number().finite(),
        potency: z.number().finite().nonnegative(),
        origin: originSchema,
      }),
    )
    .optional(),
});

const combatBarsSchema = z.object({
  current: z.number().int().nonnegative().safe(),
  maximum: z.number().int().positive().safe(),
});

export const CombatSummonSpecSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    speciesId: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)),
    attributes: z
      .object({
        vigor: z.number().finite(),
        resistance: z.number().finite(),
        speed: z.number().int().positive().safe(),
        dexterity: z.number().finite(),
        precision: z.number().finite(),
        strength: z.number().finite(),
      })
      .catchall(z.number().finite()),
    hp: combatBarsSchema,
    tenacity: z.object({
      current: z.number().int().nonnegative().safe(),
      maximum: z.number().int().nonnegative().safe(),
    }),
    energy: z.record(z.string(), z.number().finite()),
    damage: damageSchema,
    intervalMs: z.number().int().positive().safe(),
    accuracy: z.number().finite().min(0).max(1),
    mitigation: z.object({
      physical: z.number().finite().min(0).max(1),
      magical: z.number().finite().min(0).max(1),
    }),
    positionOffset: z.object({ x: z.number().finite(), y: z.number().finite() }),
  })
  .passthrough();
