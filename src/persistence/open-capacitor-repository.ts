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

  const existing = await connection.isConnection(DATABASE_NAME, false);
  const database = existing.result
    ? await connection.retrieveConnection(DATABASE_NAME, false)
    : await connection.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false);
  const isOpen = await database.isDBOpen();
  if (!isOpen.result) {
    await database.open();
  }

  const saveWebStore = platform === 'web' ? () => connection.saveToStore(DATABASE_NAME) : undefined;
  const repository = new SqliteGameRepository(new CapacitorSqliteDriver(database, saveWebStore));
  await repository.initialize();
  return repository;
}
