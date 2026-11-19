import type { GameState } from '../domain/types';
import { createSaveFile, parseSaveFile, type ParsedSaveFile } from '../persistence/save-format';
import type { BackupSummary } from './SettingsScreen';
import type { StoragePort } from './device-settings';

export const LOCAL_BACKUPS_KEY = 'eternity-realms:backups:v1';

interface LocalBackup {
  id: string;
  createdAt: number;
  characterName: string;
  payload: string;
}

function readBackups(storage: StoragePort): LocalBackup[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(LOCAL_BACKUPS_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(
      (entry): entry is LocalBackup =>
        typeof entry === 'object' &&
        entry !== null &&
        'id' in entry &&
        typeof entry.id === 'string' &&
        'createdAt' in entry &&
        typeof entry.createdAt === 'number' &&
        'characterName' in entry &&
        typeof entry.characterName === 'string' &&
        'payload' in entry &&
        typeof entry.payload === 'string',
    );
  } catch {
    return [];
  }
}

export function listLocalBackups(storage: StoragePort): BackupSummary[] {
  return readBackups(storage)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(({ id, createdAt, characterName }) => ({
      id,
      createdAt,
      characterName,
      automatic: false,
    }));
}

export function createLocalBackup(
  storage: StoragePort,
  state: GameState,
  now: number,
  retention = 7,
  modDependencies: string[] = [],
): BackupSummary {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('O horário do backup é inválido.');
  const id = `manual-${now}`;
  const backup: LocalBackup = {
    id,
    createdAt: now,
    characterName: state.character?.name ?? 'Sem personagem',
    payload: createSaveFile(state, {
      applicationVersion: '0.1.0',
      databaseVersion: 2,
      exportedAt: now,
      modDependencies,
    }),
  };
  const next = [backup, ...readBackups(storage).filter((entry) => entry.id !== id)]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(1, Math.min(30, Math.trunc(retention))));
  storage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(next));
  return { id, createdAt: now, characterName: backup.characterName, automatic: false };
}

export function restoreLocalBackup(storage: StoragePort, id: string): ParsedSaveFile | null {
  const backup = readBackups(storage).find((entry) => entry.id === id);
  return backup ? parseSaveFile(backup.payload) : null;
}
