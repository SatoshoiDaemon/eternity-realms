import type { ContentCatalog } from '../content/registry';
import type { ActivityDefinition, RegionDefinition } from '../content/schema';
import type { Character } from './types';
import { getEnergyAttributeAccessError } from './energy-rules';

export function getUnlockedRegionIds(
  character: Character,
  regions: Map<string, RegionDefinition>,
): string[] {
  const unlocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, region] of regions) {
      if (unlocked.has(id)) continue;
      const requirements = region.unlockRequirements;
      if ((requirements?.level ?? 1) > character.level) continue;
      if ((requirements?.regionIds ?? []).some((requiredId) => !unlocked.has(requiredId))) continue;
      unlocked.add(id);
      changed = true;
    }
  }
  return [...unlocked];
}

export function getActivityAccessError(
  character: Character,
  activity: ActivityDefinition,
  content: Pick<ContentCatalog, 'regions'>,
): string | undefined {
  const trainingAttributeError = activity.trainingEffect
    ? getEnergyAttributeAccessError(character, activity.trainingEffect.attributeId, 'train')
    : undefined;
  if (trainingAttributeError) return trainingAttributeError;
  if (activity.requiredLevel && character.level < activity.requiredLevel) {
    return `Activity requires character level ${activity.requiredLevel}.`;
  }
  if (activity.requiredSkillLevel) {
    const skillId = activity.skillId;
    if (!skillId) return 'Activity has a skill requirement but no associated skill.';
    const level = character.skills[skillId]?.level ?? 1;
    if (level < activity.requiredSkillLevel) {
      return `Activity requires ${skillId} level ${activity.requiredSkillLevel}.`;
    }
  }
  if (activity.regionId) {
    const region = content.regions.get(activity.regionId);
    if (!region) return `Activity references unknown region ${activity.regionId}.`;
    if (!getUnlockedRegionIds(character, content.regions).includes(region.id)) {
      return `Region ${region.name} is locked.`;
    }
  }
  return undefined;
}
