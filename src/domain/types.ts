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
  energy: { affinity: string; reserves: Record<string, number> };
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
  | (EventBase & { type: 'item.acquired'; itemId: string; quantity: number })
  | (EventBase & {
      type: 'expedition.completed';
      sessionId: string;
      expeditionId: string;
      kills: number;
      deaths: number;
    })
  | (EventBase & { type: 'node.unlocked'; nodeId: string; sessionId: string });

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
  /** Added without changing schemaVersion; older saves hydrate as an empty list. */
  combatRecords?: ExpeditionCombatRecord[];
}
