import manifest from '../../content/core/manifest.json';
import races from '../../content/core/races.json';
import classes from '../../content/core/classes.json';
import items from '../../content/core/items.json';
import activities from '../../content/core/activities.json';
import rewards from '../../content/core/rewards.json';
import skills from '../../content/core/skills.json';
import effects from '../../content/core/effects.json';
import rules from '../../content/core/rules.json';
import {
  ContentPackSchema,
  type ActivityDefinition,
  type ClassDefinition,
  type ContentRecord,
  type EffectDefinition,
  type ItemDefinition,
  type RaceDefinition,
  type RewardDefinition,
  type SkillDefinition,
} from './schema';

export interface ContentCatalog {
  races: Map<string, RaceDefinition>;
  classes: Map<string, ClassDefinition>;
  items: Map<string, ItemDefinition>;
  activities: Map<string, ActivityDefinition>;
  rewards: Map<string, RewardDefinition>;
  skills: Map<string, SkillDefinition>;
  effects: Map<string, EffectDefinition>;
  rules: { experiencePerLevel: number };
  packIds: string[];
}

function indexOfKind<T extends ContentRecord['kind']>(records: ContentRecord[], kind: T) {
  return new Map(
    records
      .filter((record) => record.kind === kind)
      .map((record) => [record.id, record as Extract<ContentRecord, { kind: T }>]),
  );
}

export function loadContentPacks(inputs: unknown[]): ContentCatalog {
  const packs = inputs.map((input) => ContentPackSchema.parse(input));
  const packIds = new Set<string>();
  const records: ContentRecord[] = [];
  const rules = { experiencePerLevel: 100 };

  for (const pack of packs) {
    if (packIds.has(pack.manifest.id)) {
      throw new Error(`Duplicate content pack id: ${pack.manifest.id}`);
    }
    packIds.add(pack.manifest.id);
    const recordIds = new Set<string>();
    for (const record of pack.records) {
      if (recordIds.has(record.id)) {
        throw new Error(`Duplicate content id in pack: ${record.id}`);
      }
      recordIds.add(record.id);
      records.push(record);
    }
    if (pack.rules) {
      rules.experiencePerLevel = pack.rules.experiencePerLevel;
    }
  }

  const races = indexOfKind(records, 'race');
  const classRecords = indexOfKind(records, 'class');
  const itemRecords = indexOfKind(records, 'item');
  const activityRecords = indexOfKind(records, 'activity');
  const rewardRecords = indexOfKind(records, 'reward');
  const skillRecords = indexOfKind(records, 'skill');
  const effectRecords = indexOfKind(records, 'effect');

  for (const activity of activityRecords.values()) {
    if (!rewardRecords.has(activity.rewardId)) {
      throw new Error(
        `Activity "${activity.id}" references missing reward "${activity.rewardId}".`,
      );
    }
  }
  for (const reward of rewardRecords.values()) {
    for (const item of reward.items) {
      if (!itemRecords.has(item.itemId)) {
        throw new Error(`Reward "${reward.id}" references missing item "${item.itemId}".`);
      }
    }
  }
  for (const skill of skillRecords.values()) {
    for (const activityId of skill.activityIds) {
      if (!activityRecords.has(activityId)) {
        throw new Error(`Skill "${skill.id}" references missing activity "${activityId}".`);
      }
    }
  }

  return {
    races,
    classes: classRecords,
    items: itemRecords,
    activities: activityRecords,
    rewards: rewardRecords,
    skills: skillRecords,
    effects: effectRecords,
    rules,
    packIds: [...packIds],
  };
}

export function loadOfficialContent(): ContentCatalog {
  return loadContentPacks([
    {
      manifest,
      records: [...races, ...classes, ...items, ...activities, ...rewards, ...skills, ...effects],
      rules,
    },
  ]);
}
