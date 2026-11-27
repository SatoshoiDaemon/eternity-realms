import type { EnergyDefinition } from '../content/schema';
import type { Character } from './types';

export function getManaSpiritDamageBonus(
  character: Character,
  damageChannel: string | undefined,
  definition: EnergyDefinition | undefined,
): number {
  if (character.energy.affinity !== 'mana' || damageChannel !== 'magical' || !definition) {
    return 0;
  }
  const spiritStage = definition.progression.find((stage) => stage.stage === 'espírito');
  const damagePerTwoPoints = spiritStage?.damagePerTwoPoints;
  if (
    typeof damagePerTwoPoints !== 'number' ||
    !Number.isFinite(damagePerTwoPoints) ||
    damagePerTwoPoints < 0
  ) {
    return 0;
  }
  const spirit = character.attributes.energetic.spirit ?? 0;
  if (!Number.isFinite(spirit) || spirit <= 0) return 0;
  return Math.floor(spirit / 2) * damagePerTwoPoints;
}
