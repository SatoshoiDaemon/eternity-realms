export type DamageChannel = 'physical' | 'magical' | 'true';
export type PhysicalDamageSubtype = 'cutting' | 'piercing' | 'crushing' | 'other';
export type CombatSide = 'party' | 'enemy' | string;

export interface CombatAttributes {
  vigor: number;
  resistance: number;
  speed: number;
  dexterity: number;
  precision: number;
  strength: number;
  [key: string]: number;
}

export interface CombatOrigin {
  kind: 'weapon' | 'ability' | 'item' | 'class' | 'race' | 'effect' | 'node' | 'mod';
  id: string;
}

export interface DamageModifier {
  id: string;
  interactionId?: string;
  operation: 'add' | 'multiply';
  value: number;
  potency: number;
  origin: CombatOrigin;
}

export interface CombatDamage {
  amount: number;
  channel: DamageChannel;
  subtype?: PhysicalDamageSubtype;
  element?: string;
  properties: string[];
  origin: CombatOrigin;
  modifiers?: DamageModifier[];
}

export interface CombatSummonSpec {
  id: string;
  name: string;
  speciesId: string;
  tags: string[];
  attributes: CombatAttributes;
  hp: { current: number; maximum: number };
  tenacity: { current: number; maximum: number };
  energy: Record<string, number>;
  damage: CombatDamage;
  intervalMs: number;
  accuracy: number;
  mitigation: { physical: number; magical: number };
  positionOffset: { x: number; y: number };
}

export interface AppliedCombatEffect {
  id: string;
  category: string;
  potency: number;
  counter: number;
  source?: CombatOrigin;
  damageMultiplier?: number;
  damageChannel?: DamageChannel;
  expiresAt?: number;
  tickDamage?: {
    amount: number;
    channel: DamageChannel;
    subtype?: PhysicalDamageSubtype;
    element?: string;
    properties?: string[];
  };
  tickIntervalMs?: number;
  nextTickAt?: number;
  sourceActorId?: string;
}

export interface ResourceCost {
  resource: string;
  amount: number;
}

export type CombatActionKind =
  | 'attack'
  | 'magic'
  | 'ranged'
  | 'area'
  | 'heal'
  | 'guard'
  | 'move'
  | 'summon'
  | 'support'
  | 'intercept'
  | 'combo';

export interface CombatAction {
  id: string;
  name: string;
  kind: CombatActionKind;
  target: 'enemy' | 'ally' | 'self' | 'lowest_enemy_hp' | 'lowest_ally_hp';
  intervalMs: number;
  accuracy: number;
  damage?: CombatDamage;
  summon?: CombatSummonSpec;
  healing?: number;
  cost?: ResourceCost;
  effects?: AppliedCombatEffect[];
  removeEffects?: string[];
  properties?: string[];
  movement?: {
    kind: 'advance' | 'retreat' | 'push' | 'pull' | 'burrow' | 'emerge';
    distance: number;
  };
}

export interface CombatPolicyCondition {
  path: string;
  operator: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
  value: number | string | boolean;
}

export interface CombatPolicyRule {
  actionId: string;
  priority: number;
  conditions?: CombatPolicyCondition[];
}

export interface CombatPolicy {
  id: string;
  rules: CombatPolicyRule[];
}

export interface CombatActor {
  id: string;
  name: string;
  speciesId: string;
  tags: string[];
  side: CombatSide;
  attributes: CombatAttributes;
  hp: { current: number; maximum: number };
  tenacity: { current: number; maximum: number };
  energy: Record<string, number>;
  equipment: Array<{ id: string; properties?: string[] }>;
  actions: CombatAction[];
  effects: AppliedCombatEffect[];
  policy: CombatPolicy;
  actionPriority: string[];
  mitigation: { physical: number; magical: number };
  /** Universal multiplicative mitigation, including true damage. */
  damageReduction?: number;
  evasion?: { chance: number; guaranteed: number };
  guarantees?: { hits: number; semiHits: number; evasions: number };
  position: { x: number; y: number };
  affinityElement?: string;
  /** All selected elemental affinities; affinityElement remains the primary legacy field. */
  affinityElements?: string[];
  movementState?: string;
  lastDamageChannel?: DamageChannel;
  actionsTaken?: number;
  revealed?: boolean;
  summonCount?: number;
  summonedBy?: string;
  /** Flat HP restored on each resolved actor turn by a persistent regeneration source. */
  regenerationPerAction?: number;
  /** The soul anchor can prevent one lethal event; its use permanently breaks it. */
  soulAnchorAvailable?: boolean;
  soulAnchorUsed?: boolean;
  state: 'ready' | 'alive' | 'dead';
  nextEventAt: number;
  lootTableId?: string;
}

export interface CombatResourceChange {
  actorId: string;
  resource: string;
  before: number;
  after: number;
}

export interface CombatLogEntry {
  id: string;
  timeMs: number;
  kind: 'attack' | 'heal' | 'summon' | 'action_skipped' | 'death';
  actorId: string;
  targetId?: string;
  actionId?: string;
  hit: boolean;
  evaded: boolean;
  blocked: boolean;
  damageInitial: number;
  damageFinal: number;
  modifiers: Array<{ id: string; source: string; stage: string; value: number }>;
  tagInteractions: Array<{ tagId: string; ruleId: string; interactionId: string; reason: string }>;
  hpChange?: { before: number; after: number };
  actorHpChange?: { before: number; after: number };
  tenacityChange?: { before: number; after: number };
  resourceChanges: CombatResourceChange[];
  effectsApplied: string[];
  killed: boolean;
  message: string;
}

export interface CombatEnvironment {
  type?: string;
  condition?: string;
  timeOfDay?: string;
  hazard?: string;
  elementOpposites?: Record<string, string[]>;
}

export interface CombatState {
  id: string;
  seed: number;
  rngState: number;
  nowMs: number;
  actors: CombatActor[];
  /** Optional content snapshot keeps mod-defined tag behaviors executable during offline resumption. */
  tagRegistry?: import('./tag-registry').EnemyTagDefinition[];
  log: CombatLogEntry[];
  nextEventNumber: number;
  environment: CombatEnvironment;
  winner?: CombatSide;
}
