import type { CombatState } from '../combat/types';
import type { LootDrop } from '../combat/loot';

export interface PhysicalAttributes {
  vigor: number;
  resistance: number;
  speed: number;
  dexterity: number;
  precision: number;
  strength: number;
  [key: string]: number;
}

export interface Character {
  id: string;
  name: string;
  raceId: string;
  classId: string;
  level: number;
  experience: { current: number; total: number };
  attributes: { physical: PhysicalAttributes; energetic: Record<string, number> };
  energy: { affinity: string; affinities?: string[]; reserves: Record<string, number> };
  equipment: {
    head: string | null;
    chest: string | null;
    legs: string | null;
    hands: string | null;
    feet: string | null;
    primary: string | null;
    secondary: string | null;
    accessories: string[];
    [slot: string]: string | null | string[];
  };
  inventory: Record<string, number>;
  abilities: string[];
  /** Optional for backward compatibility with saves created before construction editing. */
  nodeLibrary?: NodeLibrary;
  skills: Record<
    string,
    { level: number; experience: number; extensions: Record<string, unknown> }
  >;
  activityState: 'idle' | 'active';
  extensions: Record<string, unknown>;
}

export interface SavedConstruction {
  id: string;
  graph: import('../nodes/graph').NodeGraph;
  equipped: boolean;
  updatedAt: number;
}

export interface NodeLibrary {
  schemaVersion: 1;
  unlockedNodeIds: string[];
  constructions: SavedConstruction[];
  /** User-selected order for equipped constructions; absent on older saves. */
  actionPriority?: string[];
}

export type SessionStatus = 'queued' | 'active' | 'completed' | 'cancelled';

export interface Session {
  id: string;
  activityId: string;
  durationMs: number;
  status: SessionStatus;
  createdAt: number;
  startedAt?: number;
  /** Highest elapsed wall-clock progress observed; absent in legacy saves. */
  elapsedMs?: number;
  /** Monotonic wall-clock watermark used to make clock rollback harmless. */
  lastObservedAt?: number;
  finishedAt?: number;
  rewardId?: string;
}

interface EventBase {
  id: string;
  occurredAt: number;
}

export type DomainEvent =
  | (EventBase & { type: 'session.started'; sessionId: string; activityId: string })
  | (EventBase & { type: 'session.completed'; sessionId: string; activityId: string })
  | (EventBase & { type: 'session.cancelled'; sessionId: string; activityId: string })
  | (EventBase & { type: 'reward.granted'; sessionId: string; rewardId: string })
  | (EventBase & { type: 'experience.gained'; amount: number })
  | (EventBase & { type: 'level.increased'; level: number })
  | (EventBase & { type: 'skill.level_increased'; skillId: string; level: number })
  | (EventBase & { type: 'attribute.points_awarded'; amount: number })
  | (EventBase & {
      type: 'attribute.increased';
      attributeId: string;
      amount: number;
      total: number;
    })
  | (EventBase & { type: 'currency.earned'; currency: string; amount: number })
  | (EventBase & { type: 'item.acquired'; itemId: string; quantity: number })
  | (EventBase & { type: 'item.consumed'; itemId: string; quantity: number })
  | (EventBase & {
      type: 'implant.installed';
      implantId: string;
      load: number;
      capacity: number;
      syndrome: 'none' | 'instability' | 'psychosis' | 'collapse';
    })
  | (EventBase & { type: 'resource.restored'; resource: string; amount: number })
  | (EventBase & { type: 'activity.completed'; activityId: string; sessionId: string })
  | (EventBase & { type: 'quest.completed'; expeditionId: string; sessionId: string })
  | (EventBase & { type: 'enemy.defeated'; enemyId: string; sessionId: string })
  | (EventBase & { type: 'region.unlocked'; regionId: string })
  | (EventBase & { type: 'item.crafted'; itemId: string; quantity: number })
  | (EventBase & {
      type: 'expedition.completed';
      sessionId: string;
      expeditionId: string;
      kills: number;
      deaths: number;
    })
  | (EventBase & { type: 'node.unlocked'; nodeId: string; sessionId: string })
  | (EventBase & {
      type: 'mission.reward_claimed';
      missionId: string;
      periodKey: string;
    });

export interface ExpeditionCombatRecord {
  id: string;
  sessionId: string;
  expeditionId: string;
  seed: number;
  kills: number;
  deaths: number;
  experience: number;
  drops: LootDrop[];
  unlockedNodeIds: string[];
  virtualDurationMs: number;
  combats: CombatState[];
  completedAt: number;
}

export interface GameState {
  schemaVersion: 1;
  revision: number;
  character: Character | null;
  sessions: Session[];
  /** Active session first, followed by queued sessions. */
  queue: string[];
  events: DomainEvent[];
  processedEventIds: string[];
  /** Added with the mission system; older saves hydrate as an empty list. */
  missionClaims?: string[];
  /** Added without changing schemaVersion; older saves hydrate as an empty list. */
  combatRecords?: ExpeditionCombatRecord[];
}
