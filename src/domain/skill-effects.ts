import type { SkillDefinition } from '../content/schema';
import type { Character } from './types';

export function getSkillEffectBonus(
  character: Character,
  definition: SkillDefinition | undefined,
  effectType: string,
): number {
  if (!definition || !effectType) return 0;
  const progress = character.skills[definition.id];
  if (!progress || !Number.isSafeInteger(progress.level) || progress.level < 1) return 0;

  let bonus = 0;
  for (const milestone of definition.milestones ?? []) {
    if (
      !Number.isSafeInteger(milestone.level) ||
      milestone.level < 1 ||
      milestone.level > progress.level
    ) {
      continue;
    }
    for (const effect of milestone.effects) {
      if (typeof effect !== 'object' || effect === null) continue;
      const candidate = effect as { type?: unknown; value?: unknown };
      if (
        candidate.type !== effectType ||
        typeof candidate.value !== 'number' ||
        !Number.isFinite(candidate.value) ||
        candidate.value < 0
      ) {
        continue;
      }
      const total = bonus + candidate.value;
      if (Number.isFinite(total)) bonus = total;
    }
  }
  return bonus;
}
