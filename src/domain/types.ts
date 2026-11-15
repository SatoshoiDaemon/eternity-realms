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
  skills: Record<
    string,
    { level: number; experience: number; extensions: Record<string, unknown> }
  >;
  activityState: 'idle' | 'active';
  extensions: Record<string, unknown>;
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
  | (EventBase & { type: 'item.acquired'; itemId: string; quantity: number });

export interface GameState {
  schemaVersion: 1;
  revision: number;
  character: Character | null;
  sessions: Session[];
  /** Active session first, followed by queued sessions. */
  queue: string[];
  events: DomainEvent[];
  processedEventIds: string[];
}
