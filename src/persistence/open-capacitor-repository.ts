import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteConnection as SQLiteConnectionType,
} from '@capacitor-community/sqlite';
import { defineCustomElements } from 'jeep-sqlite/loader';
import { CapacitorSqliteDriver } from './capacitor-sqlite-driver';
import { SqliteGameRepository } from './sqlite-game-repository';

const DATABASE_NAME = 'eternity-realms';
const repositoryInitializations = new WeakMap<object, Map<string, Promise<SqliteGameRepository>>>();
const SQLITE_OPEN_RETRY_DELAYS = [80, 160, 320];

function isTransientLockError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error);
  return /database(?: table)? is locked|sqlite_busy|\bcode\s*5\b/i.test(message);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface CapacitorRepositoryOptions {
  platform?: string;
  connection?: SQLiteConnectionType;
  document?: Document;
  window?: Window;
}

export async function openCapacitorRepository(
  options: CapacitorRepositoryOptions = {},
): Promise<SqliteGameRepository> {
  const platform = options.platform ?? Capacitor.getPlatform();
  const connectionKey = options.connection ?? CapacitorSQLite;
  let platformInitializations = repositoryInitializations.get(connectionKey);
  if (!platformInitializations) {
    platformInitializations = new Map();
    repositoryInitializations.set(connectionKey, platformInitializations);
  }
  const existingInitialization = platformInitializations.get(platform);
  if (existingInitialization) {
    return existingInitialization;
  }

  const initialization = (async () => {
    const connection = options.connection ?? new SQLiteConnection(CapacitorSQLite);

    if (platform === 'web') {
      const browserWindow = options.window ?? window;
      const browserDocument = options.document ?? browserWindow.document;
      defineCustomElements(browserWindow);
      if (!browserDocument.querySelector('jeep-sqlite')) {
        browserDocument.body.append(browserDocument.createElement('jeep-sqlite'));
      }
      await browserWindow.customElements.whenDefined('jeep-sqlite');
      await connection.initWebStore();
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        const existing = await connection.isConnection(DATABASE_NAME, false);
        const database = existing.result
          ? await connection.retrieveConnection(DATABASE_NAME, false)
          : await connection.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false);
        const isOpen = await database.isDBOpen();
        if (!isOpen.result) {
          await database.open();
        }

        const saveWebStore =
          platform === 'web' ? () => connection.saveToStore(DATABASE_NAME) : undefined;
        const repository = new SqliteGameRepository(
          new CapacitorSqliteDriver(database, saveWebStore),
        );
        await repository.initialize();
        return repository;
      } catch (error) {
        const delay = SQLITE_OPEN_RETRY_DELAYS[attempt];
        if (delay === undefined || !isTransientLockError(error)) throw error;
        await wait(delay);
      }
    }
  })();

  platformInitializations.set(platform, initialization);
  void initialization.catch(() => platformInitializations.delete(platform));
  return initialization;
}
