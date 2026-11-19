import { z } from 'zod';
import type { GameState } from '../domain/types';

export const SAVE_FORMAT_VERSION = 1;
export const CURRENT_DATABASE_VERSION = 2;

const safeEpoch = z.number().int().safe();
const SessionSchema = z
  .object({
    id: z.string().min(1),
    activityId: z.string().min(1),
    durationMs: z.number().int().positive().safe(),
    status: z.enum(['queued', 'active', 'completed', 'cancelled']),
    createdAt: safeEpoch,
    startedAt: safeEpoch.optional(),
    elapsedMs: z.number().int().nonnegative().safe().optional(),
    lastObservedAt: safeEpoch.optional(),
    finishedAt: safeEpoch.optional(),
    rewardId: z.string().optional(),
  })
  .passthrough();

const CharacterSaveSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    level: z.number().int().positive().safe(),
    experience: z.object({
      current: z.number().int().nonnegative().safe(),
      total: z.number().int().nonnegative().safe(),
    }),
    inventory: z.record(z.string(), z.number().int().nonnegative().safe()),
  })
  .passthrough();

const GameStateSaveSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative().safe(),
    character: CharacterSaveSchema.nullable(),
    sessions: z.array(SessionSchema),
    queue: z.array(z.string()),
    events: z.array(
      z
        .object({ id: z.string().min(1), occurredAt: safeEpoch, type: z.string().min(1) })
        .passthrough(),
    ),
    processedEventIds: z.array(z.string()),
    missionClaims: z.array(z.string()).default([]),
    combatRecords: z.array(z.unknown()).default([]),
  })
  .passthrough();

const SaveEnvelopeSchema = z.object({
  formatVersion: z.number().int().nonnegative().safe(),
  applicationVersion: z.string().min(1),
  databaseVersion: z.number().int().nonnegative().safe(),
  exportedAt: safeEpoch,
  modDependencies: z.array(z.string()),
  gameState: z.unknown(),
});

export interface SaveFileMetadata {
  applicationVersion: string;
  databaseVersion: number;
  exportedAt: number;
  modDependencies: string[];
}

export interface ParsedSaveFile {
  gameState: GameState;
  metadata: SaveFileMetadata;
  migratedFrom: number;
}

export function createSaveFile(gameState: GameState, metadata: SaveFileMetadata): string {
  const validatedState = GameStateSaveSchema.parse(gameState) as unknown as GameState;
  const envelope = {
    formatVersion: SAVE_FORMAT_VERSION,
    ...metadata,
    modDependencies: [...new Set(metadata.modDependencies)],
    gameState: validatedState,
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseSaveFile(source: string): ParsedSaveFile {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new Error('O arquivo de save não contém JSON válido.');
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('O arquivo de save não corresponde ao formato esperado.');
  }

  if ('formatVersion' in input || 'gameState' in input) {
    const envelope = SaveEnvelopeSchema.safeParse(input);
    if (!envelope.success) throw new Error('Os metadados do save estão inválidos.');
    if (envelope.data.formatVersion !== SAVE_FORMAT_VERSION) {
      throw new Error(`Formato de save incompatível: ${envelope.data.formatVersion}.`);
    }
    if (envelope.data.databaseVersion > CURRENT_DATABASE_VERSION) {
      throw new Error(
        `Save criado por uma versão de banco mais recente: ${envelope.data.databaseVersion}.`,
      );
    }
    const gameState = GameStateSaveSchema.safeParse(envelope.data.gameState);
    if (!gameState.success)
      throw new Error('A integridade dos dados do save não pôde ser validada.');
    return {
      gameState: gameState.data as unknown as GameState,
      metadata: {
        applicationVersion: envelope.data.applicationVersion,
        databaseVersion: envelope.data.databaseVersion,
        exportedAt: envelope.data.exportedAt,
        modDependencies: envelope.data.modDependencies,
      },
      migratedFrom: SAVE_FORMAT_VERSION,
    };
  }

  const legacy = GameStateSaveSchema.safeParse(input);
  if (!legacy.success) throw new Error('A integridade dos dados do save não pôde ser validada.');
  return {
    gameState: legacy.data as unknown as GameState,
    metadata: {
      applicationVersion: 'desconhecida',
      databaseVersion: 0,
      exportedAt: 0,
      modDependencies: [],
    },
    migratedFrom: 0,
  };
}
