import type { SkillDefinition } from '../content/schema';
import type { Character } from './types';
import type { CombatAction } from '../combat/types';

interface CombatSkillBonuses {
  magicDamageBonus: number;
  archeryDamageBonus: number;
  targetingAccuracyBonus: number;
}

function validProgressLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function effectValue(effect: unknown, expectedType: string): number | undefined {
  if (typeof effect !== 'object' || effect === null) return undefined;
  const candidate = effect as { type?: unknown; value?: unknown };
  if (
    candidate.type !== expectedType ||
    typeof candidate.value !== 'number' ||
    !Number.isFinite(candidate.value) ||
    candidate.value < 0
  ) {
    return undefined;
  }
  return candidate.value;
}

function addBonus(total: number, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(total + value)) return total;
  return total + value;
}

function getCombatSkillBonuses(
  character: Character,
  skillDefinitions: SkillDefinition[],
): CombatSkillBonuses {
  let magicDamageBonus = 0;
  let archeryDamageBonus = 0;
  let targetingAccuracyBonus = 0;

  for (const skill of skillDefinitions) {
    const progress = character.skills[skill.id];
    if (!progress || !validProgressLevel(progress.level)) continue;
    for (const milestone of skill.milestones ?? []) {
      if (!validProgressLevel(milestone.level) || milestone.level > progress.level) continue;
      for (const effect of milestone.effects) {
        magicDamageBonus = addBonus(
          magicDamageBonus,
          effectValue(effect, 'magic_damage_bonus_percent'),
        );
        archeryDamageBonus = addBonus(
          archeryDamageBonus,
          effectValue(effect, 'archery_damage_bonus_percent'),
        );
        targetingAccuracyBonus = addBonus(
          targetingAccuracyBonus,
          effectValue(effect, 'targeting_accuracy_bonus'),
        );
      }
    }
  }

  return { magicDamageBonus, archeryDamageBonus, targetingAccuracyBonus };
}

export function applyCombatSkillEffects(
  action: CombatAction,
  bonuses: CombatSkillBonuses,
): CombatAction {
  const isMagical = action.damage?.channel === 'magical';
  const isPhysicalRanged = action.kind === 'ranged' && action.damage?.channel === 'physical';
  const isRanged = action.kind === 'ranged';
  const damageBonus = isMagical
    ? bonuses.magicDamageBonus
    : isPhysicalRanged
      ? bonuses.archeryDamageBonus
      : 0;
  const damageAmount =
    action.damage && damageBonus > 0
      ? Math.floor(action.damage.amount * (1 + damageBonus))
      : undefined;
  if (damageAmount !== undefined && !Number.isSafeInteger(damageAmount)) {
    throw new Error(`Combat skill effects exceed the safe damage range for ${action.id}.`);
  }
  return {
    ...action,
    accuracy:
      isRanged && bonuses.targetingAccuracyBonus > 0
        ? Math.min(1, action.accuracy + bonuses.targetingAccuracyBonus)
        : action.accuracy,
    ...(action.damage && damageAmount !== undefined
      ? { damage: { ...action.damage, amount: damageAmount } }
      : { ...(action.damage ? { damage: { ...action.damage } } : {}) }),
  };
}

export function getCombatSkillAction(
  character: Character,
  action: CombatAction,
  skillDefinitions: SkillDefinition[],
): CombatAction {
  return applyCombatSkillEffects(action, getCombatSkillBonuses(character, skillDefinitions));
}
