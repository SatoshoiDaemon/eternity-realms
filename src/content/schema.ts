import { z } from 'zod';

const id = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
const baseRecord = { id, name: z.string().trim().min(1), description: z.string() };

export const RaceSchema = z.object({ ...baseRecord, kind: z.literal('race') }).passthrough();
export const ClassSchema = z.object({ ...baseRecord, kind: z.literal('class') }).passthrough();
export const ItemSchema = z
  .object({ ...baseRecord, kind: z.literal('item'), stackable: z.boolean() })
  .passthrough();
export const ActivitySchema = z
  .object({
    ...baseRecord,
    kind: z.literal('activity'),
    rewardId: id,
    category: z.string().trim().min(1),
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
  .object({ ...baseRecord, kind: z.literal('skill'), activityIds: z.array(id) })
  .passthrough();
export const EffectSchema = z
  .object({ ...baseRecord, kind: z.literal('effect'), payload: z.record(z.string(), z.unknown()) })
  .passthrough();

export const ContentRecordSchema = z.discriminatedUnion('kind', [
  RaceSchema,
  ClassSchema,
  ItemSchema,
  ActivitySchema,
  RewardSchema,
  SkillSchema,
  EffectSchema,
]);

export const ContentPackSchema = z.object({
  manifest: z
    .object({ id, name: z.string().trim().min(1), version: z.string().trim().min(1) })
    .passthrough(),
  records: z.array(ContentRecordSchema),
  rules: z
    .object({ experiencePerLevel: z.number().int().positive().safe() })
    .passthrough()
    .optional(),
});

export type ContentPack = z.infer<typeof ContentPackSchema>;
export type ContentRecord = z.infer<typeof ContentRecordSchema>;
export type RaceDefinition = z.infer<typeof RaceSchema>;
export type ClassDefinition = z.infer<typeof ClassSchema>;
export type ItemDefinition = z.infer<typeof ItemSchema>;
export type ActivityDefinition = z.infer<typeof ActivitySchema>;
export type RewardDefinition = z.infer<typeof RewardSchema>;
export type SkillDefinition = z.infer<typeof SkillSchema>;
export type EffectDefinition = z.infer<typeof EffectSchema>;
