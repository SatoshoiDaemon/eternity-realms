import manifest from '../../content/core/manifest.json';
import races from '../../content/core/races.json';
import classes from '../../content/core/classes.json';
import items from '../../content/core/items.json';
import activities from '../../content/core/activities.json';
import rewards from '../../content/core/rewards.json';
import skills from '../../content/core/skills.json';
import missionsContent from '../../content/core/missions.json';
import effects from '../../content/core/effects.json';
import rules from '../../content/core/rules.json';
import enemiesContent from '../../content/core/enemies.json';
import expeditionsContent from '../../content/core/expeditions.json';
import lootTablesContent from '../../content/core/loot-tables.json';
import recipesContent from '../../content/core/recipes.json';
import nodesContent from '../../content/core/nodes.json';
import glyphsContent from '../../content/core/glyphs.json';
import sigilsContent from '../../content/core/sigils.json';
import regionsContent from '../../content/core/regions.json';
import shopsContent from '../../content/core/shops.json';
import energiesContent from '../../content/core/energies.json';
import systemsContent from '../../content/core/systems.json';
import {
  ContentPackSchema,
  type ActivityDefinition,
  type ClassDefinition,
  type ContentRecord,
  type EffectDefinition,
  type MissionDefinition,
  type ItemDefinition,
  type RaceDefinition,
  type RewardDefinition,
  type SkillDefinition,
  type EnemyDefinition,
  type ExpeditionDefinition,
  type LootTableDefinition,
  type RecipeDefinition,
  type EnemyTagRecord,
  type CombatDefaults,
  type RegionDefinition,
  type ShopDefinition,
  type EnergyDefinition,
  type SystemDefinition,
} from './schema';
import { BASE_ENEMY_TAGS, loadTagRegistry, type EnemyTagDefinition } from '../combat/tag-registry';
import {
  loadGlyphs,
  loadNodeRegistry,
  loadSigils,
  type GlyphDefinition,
  type NodeDefinition,
  type SigilDefinition,
} from '../nodes/graph';

export interface ContentCatalog {
  races: Map<string, RaceDefinition>;
  classes: Map<string, ClassDefinition>;
  items: Map<string, ItemDefinition>;
  activities: Map<string, ActivityDefinition>;
  rewards: Map<string, RewardDefinition>;
  skills: Map<string, SkillDefinition>;
  missions: Map<string, MissionDefinition>;
  effects: Map<string, EffectDefinition>;
  enemyTags: Map<string, EnemyTagDefinition>;
  enemies: Map<string, EnemyDefinition>;
  expeditions: Map<string, ExpeditionDefinition>;
  lootTables: Map<string, LootTableDefinition>;
  recipes: Map<string, RecipeDefinition>;
  regions: Map<string, RegionDefinition>;
  shops: Map<string, ShopDefinition>;
  energies: Map<string, EnergyDefinition>;
  systems: Map<string, SystemDefinition>;
  nodes: NodeDefinition[];
  glyphs: GlyphDefinition[];
  sigils: SigilDefinition[];
  rules: {
    experiencePerLevel: number;
    maxLevel: number;
    attributePointsPerLevel: number;
    combat: CombatDefaults;
  };
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
  const rules = {
    experiencePerLevel: 100,
    maxLevel: 1_000,
    attributePointsPerLevel: 8,
    combat: { accuracy: 0.9, intervalMs: 1_000 },
  };

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
      rules.maxLevel = pack.rules.maxLevel ?? rules.maxLevel;
      rules.attributePointsPerLevel =
        pack.rules.attributePointsPerLevel ?? rules.attributePointsPerLevel;
      if (pack.rules.combat) {
        rules.combat = { ...pack.rules.combat };
      }
    }
  }

  const races = indexOfKind(records, 'race');
  const classRecords = indexOfKind(records, 'class');
  const itemRecords = indexOfKind(records, 'item');
  const activityRecords = indexOfKind(records, 'activity');
  const rewardRecords = indexOfKind(records, 'reward');
  const skillRecords = indexOfKind(records, 'skill');
  const missions = indexOfKind(records, 'mission');
  const effectRecords = indexOfKind(records, 'effect');
  const enemies = indexOfKind(records, 'enemy');
  const expeditions = indexOfKind(records, 'expedition');
  const lootTables = indexOfKind(records, 'loot_table');
  const recipes = indexOfKind(records, 'recipe');
  const regions = indexOfKind(records, 'region');
  const shops = indexOfKind(records, 'shop');
  const energies = indexOfKind(records, 'energy');
  const systems = indexOfKind(records, 'system');
  const suppliedTags = records.filter(
    (record): record is EnemyTagRecord => record.kind === 'enemy_tag',
  );
  const mergedTags = new Map<string, unknown>(
    BASE_ENEMY_TAGS.map((tag) => [(tag as { id: string }).id, tag]),
  );
  for (const race of races.values()) {
    if (race.combatTag) {
      mergedTags.set(race.combatTag.id, {
        ...race.combatTag,
        kind: 'enemy_tag',
        origin: `official-race:${race.id}`,
      });
    }
  }
  for (const tag of suppliedTags) {
    mergedTags.set(tag.id, tag);
  }
  const enemyTags = new Map(loadTagRegistry([...mergedTags.values()]).map((tag) => [tag.id, tag]));
  const mergeDefinitions = (base: unknown[], additions: unknown[]): unknown[] => {
    const definitions = new Map<string, unknown>();
    for (const candidate of [...base, ...additions]) {
      const id =
        typeof candidate === 'object' && candidate !== null && 'id' in candidate
          ? String(candidate.id)
          : '<unknown>';
      definitions.set(id, candidate);
    }
    return [...definitions.values()];
  };
  const nodes = loadNodeRegistry(
    mergeDefinitions(
      nodesContent,
      packs.flatMap((pack) => pack.nodes ?? []),
    ),
  );
  const glyphs: GlyphDefinition[] = loadGlyphs(
    mergeDefinitions(
      glyphsContent,
      packs.flatMap((pack) => pack.glyphs ?? []),
    ),
  );
  const sigils = loadSigils(
    mergeDefinitions(
      sigilsContent,
      packs.flatMap((pack) => pack.sigils ?? []),
    ),
  );

  for (const activity of activityRecords.values()) {
    if (!rewardRecords.has(activity.rewardId)) {
      throw new Error(
        `Activity "${activity.id}" references missing reward "${activity.rewardId}".`,
      );
    }
    if (activity.expeditionId && !expeditions.has(activity.expeditionId)) {
      throw new Error(
        `Activity "${activity.id}" references missing expedition "${activity.expeditionId}".`,
      );
    }
  }
  for (const enemy of enemies.values()) {
    if (enemy.lootTableId && !lootTables.has(enemy.lootTableId)) {
      throw new Error(`Enemy "${enemy.id}" references missing loot table "${enemy.lootTableId}".`);
    }
    for (const tagId of enemy.tags) {
      if (!enemyTags.has(tagId)) {
        throw new Error(`Enemy "${enemy.id}" references missing tag "${tagId}".`);
      }
    }
  }
  for (const expedition of expeditions.values()) {
    for (const encounter of expedition.encounters) {
      if (!enemies.has(encounter.enemyId)) {
        throw new Error(
          `Expedition "${expedition.id}" references missing enemy "${encounter.enemyId}".`,
        );
      }
    }
  }
  for (const recipe of recipes.values()) {
    if (!itemRecords.has(recipe.resultItemId)) {
      throw new Error(
        `Recipe "${recipe.id}" references missing result item "${recipe.resultItemId}".`,
      );
    }
    for (const itemId of Object.keys(recipe.inputs)) {
      if (!itemRecords.has(itemId)) {
        throw new Error(`Recipe "${recipe.id}" references missing input item "${itemId}".`);
      }
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
  for (const race of races.values()) {
    for (const tagId of race.combatTags ?? []) {
      if (!enemyTags.has(tagId)) {
        throw new Error(`Race "${race.id}" references missing combat tag "${tagId}".`);
      }
    }
    for (const bonus of race.activityBonuses ?? []) {
      if (!skillRecords.has(bonus.skillId)) {
        throw new Error(`Race "${race.id}" references missing skill "${bonus.skillId}".`);
      }
    }
  }
  for (const activity of activityRecords.values()) {
    if (activity.skillId && !skillRecords.has(activity.skillId)) {
      throw new Error(`Activity "${activity.id}" references missing skill "${activity.skillId}".`);
    }
    if (activity.regionId && !regions.has(activity.regionId)) {
      throw new Error(
        `Activity "${activity.id}" references missing region "${activity.regionId}".`,
      );
    }
    if (activity.outputItemId && !itemRecords.has(activity.outputItemId)) {
      throw new Error(
        `Activity "${activity.id}" references missing output item "${activity.outputItemId}".`,
      );
    }
  }
  for (const region of regions.values()) {
    for (const itemId of region.materials) {
      if (!itemRecords.has(itemId)) {
        throw new Error(`Region "${region.id}" references missing material "${itemId}".`);
      }
    }
    for (const enemyId of region.enemies) {
      if (!enemies.has(enemyId)) {
        throw new Error(`Region "${region.id}" references missing enemy "${enemyId}".`);
      }
    }
    for (const expeditionId of region.expeditionIds) {
      if (!expeditions.has(expeditionId)) {
        throw new Error(`Region "${region.id}" references missing expedition "${expeditionId}".`);
      }
    }
    for (const activityId of region.activityIds) {
      if (!activityRecords.has(activityId)) {
        throw new Error(`Region "${region.id}" references missing activity "${activityId}".`);
      }
    }
    for (const regionId of region.unlockRequirements?.regionIds ?? []) {
      if (!regions.has(regionId)) {
        throw new Error(`Region "${region.id}" requires missing region "${regionId}".`);
      }
    }
  }
  for (const shop of shops.values()) {
    for (const entry of shop.entries) {
      if (!itemRecords.has(entry.itemId)) {
        throw new Error(`Shop "${shop.id}" references missing item "${entry.itemId}".`);
      }
      if (entry.requiredSkill && !skillRecords.has(entry.requiredSkill)) {
        throw new Error(`Shop "${shop.id}" references missing skill "${entry.requiredSkill}".`);
      }
    }
    if (shop.regionId && !regions.has(shop.regionId)) {
      throw new Error(`Shop "${shop.id}" references missing region "${shop.regionId}".`);
    }
  }
  for (const system of systems.values()) {
    if (system.systemType !== 'alchemy') continue;
    for (const entry of system.entries) {
      if (typeof entry.id !== 'string' || !entry.id.startsWith('implant-')) continue;
      if (typeof entry.deviceItemId !== 'string' || !itemRecords.has(entry.deviceItemId)) {
        throw new Error(
          `Alchemical implant "${entry.id}" references missing device "${String(entry.deviceItemId)}".`,
        );
      }
      if (
        typeof entry.installationCostFragments !== 'number' ||
        !Number.isSafeInteger(entry.installationCostFragments) ||
        entry.installationCostFragments < 0
      ) {
        throw new Error(`Alchemical implant "${entry.id}" has an invalid surgery cost.`);
      }
    }
  }
  for (const mission of missions.values()) {
    for (const itemId of Object.keys(mission.reward.items)) {
      if (!itemRecords.has(itemId)) {
        throw new Error(`Mission "${mission.id}" references missing reward item "${itemId}".`);
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
    missions,
    effects: effectRecords,
    enemyTags,
    enemies,
    expeditions,
    lootTables,
    recipes,
    regions,
    shops,
    energies,
    systems,
    nodes,
    glyphs,
    sigils,
    rules,
    packIds: [...packIds],
  };
}

export function loadOfficialContent(additionalPacks: unknown[] = []): ContentCatalog {
  return loadContentPacks([
    {
      manifest,
      records: [
        ...races,
        ...classes,
        ...items,
        ...activities,
        ...rewards,
        ...skills,
        ...missionsContent,
        ...effects,
        ...enemiesContent,
        ...expeditionsContent,
        ...lootTablesContent,
        ...recipesContent,
        ...regionsContent,
        ...shopsContent,
        ...energiesContent,
        ...systemsContent,
      ],
      rules,
    },
    ...additionalPacks,
  ]);
}
