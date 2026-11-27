import type { EnergyDefinition } from '../content/schema';
import type { Character } from './types';

export interface UnaffiliatedEffects {
  damageReduction: number;
  physicalAttributeBonus: number;
  trainingGainMultiplier: number;
  directEnergyEffectMultiplier: number;
  forbiddenAttributes: string[];
}

const NO_UNAFFILIATED_EFFECTS: UnaffiliatedEffects = {
  damageReduction: 0,
  physicalAttributeBonus: 0,
  trainingGainMultiplier: 1,
  directEnergyEffectMultiplier: 1,
  forbiddenAttributes: [],
};

function finiteNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getUnaffiliatedEffects(
  character: Character,
  definition: EnergyDefinition | undefined,
): UnaffiliatedEffects {
  if (character.energy.affinity !== 'unaffiliated' || !definition) {
    return { ...NO_UNAFFILIATED_EFFECTS, forbiddenAttributes: [] };
  }
  const stageId = character.energy.unaffiliatedStage ?? 'incomplete';
  const stage = definition.progression.find((entry) => entry.stage === stageId);
  if (!stage) return { ...NO_UNAFFILIATED_EFFECTS, forbiddenAttributes: [] };
  const forbiddenAttributes = Array.isArray(stage.forbiddenAttributes)
    ? stage.forbiddenAttributes.filter(
        (attribute): attribute is string => typeof attribute === 'string',
      )
    : [];
  return {
    damageReduction: finiteNumber(stage, 'damageReduction', 0),
    physicalAttributeBonus: finiteNumber(stage, 'physicalAttributeBonus', 0),
    trainingGainMultiplier: finiteNumber(stage, 'trainingGainMultiplier', 1),
    directEnergyEffectMultiplier: finiteNumber(stage, 'directEnergyEffectMultiplier', 1),
    forbiddenAttributes,
  };
}
