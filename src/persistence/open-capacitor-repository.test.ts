import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import type { SQLiteDBConnection, SQLiteConnection } from '@capacitor-community/sqlite';
import { openCapacitorRepository } from './open-capacitor-repository';

const defineCustomElements = vi.hoisted(() => vi.fn());
const defaultSqlite = vi.hoisted(() => {
  const database = {
    isDBOpen: vi.fn(async () => ({ result: true })),
    open: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({})),
    run: vi.fn(async () => ({})),
    query: vi.fn(async () => ({ values: [] })),
    beginTransaction: vi.fn(async () => ({})),
    commitTransaction: vi.fn(async () => ({})),
    rollbackTransaction: vi.fn(async () => ({})),
  };
  const plugin = {
    initWebStore: vi.fn(async () => undefined),
    saveToStore: vi.fn(async () => undefined),
    isConnection: vi.fn(async () => ({ result: true })),
    retrieveConnection: vi.fn(async () => database),
    createConnection: vi.fn(async () => database),
  };
  return { database, plugin, constructor: vi.fn() };
});
vi.mock('jeep-sqlite/loader', () => ({ defineCustomElements }));
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: defaultSqlite.plugin,
  SQLiteConnection: class {
    constructor(plugin: unknown) {
      defaultSqlite.constructor(plugin);
    }
    initWebStore() {
      return defaultSqlite.plugin.initWebStore();
    }
    saveToStore(...args: Parameters<typeof defaultSqlite.plugin.saveToStore>) {
      return defaultSqlite.plugin.saveToStore(...args);
    }
    isConnection(...args: Parameters<typeof defaultSqlite.plugin.isConnection>) {
      return defaultSqlite.plugin.isConnection(...args);
    }
    retrieveConnection(...args: Parameters<typeof defaultSqlite.plugin.retrieveConnection>) {
      return defaultSqlite.plugin.retrieveConnection(...args);
    }
    createConnection(...args: Parameters<typeof defaultSqlite.plugin.createConnection>) {
      return defaultSqlite.plugin.createConnection(...args);
    }
  },
}));

function createDb(isOpen = false) {
  return {
    isDBOpen: vi.fn(async () => ({ result: isOpen })),
    open: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({})),
    run: vi.fn(async () => ({})),
    query: vi.fn(async () => ({ values: [] })),
    beginTransaction: vi.fn(async () => ({})),
    commitTransaction: vi.fn(async () => ({})),
    rollbackTransaction: vi.fn(async () => ({})),
  } as unknown as SQLiteDBConnection;
}

function createConnection(db: SQLiteDBConnection, connected = false) {
  return {
    initWebStore: vi.fn(async () => undefined),
    saveToStore: vi.fn(async () => undefined),
    isConnection: vi.fn(async () => ({ result: connected })),
    retrieveConnection: vi.fn(async () => db),
    createConnection: vi.fn(async () => db),
  } as unknown as SQLiteConnection;
}

describe('Capacitor SQLite bootstrap', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    defineCustomElements.mockClear();
    defaultSqlite.constructor.mockClear();
  });

  it('sets up the web store, registers jeep-sqlite, opens SQLite, and initializes migrations', async () => {
    const db = createDb();
    const connection = createConnection(db);
    const whenDefined = vi
      .spyOn(window.customElements, 'whenDefined')
      .mockResolvedValue(class extends HTMLElement {});
    const repository = await openCapacitorRepository({
      platform: 'web',
      connection,
      document,
      window,
    });

    expect(defineCustomElements).toHaveBeenCalledWith(window);
    expect(document.querySelector('jeep-sqlite')).toBeInTheDocument();
    expect(whenDefined).toHaveBeenCalledWith('jeep-sqlite');
    expect(connection.initWebStore).toHaveBeenCalledOnce();
    expect(connection.createConnection).toHaveBeenCalledWith(
      'eternity-realms',
      false,
      'no-encryption',
      1,
      false,
    );
    expect(db.open).toHaveBeenCalledOnce();
    expect(await repository.load()).toBeNull();
  });

  it('reuses existing native connections and does not install web storage', async () => {
    document.body.innerHTML = '<jeep-sqlite></jeep-sqlite>';
    const db = createDb(true);
    const connection = createConnection(db, true);

    await openCapacitorRepository({ platform: 'android', connection, document, window });

    expect(connection.initWebStore).not.toHaveBeenCalled();
    expect(connection.retrieveConnection).toHaveBeenCalledWith('eternity-realms', false);
    expect(connection.createConnection).not.toHaveBeenCalled();
    expect(db.open).not.toHaveBeenCalled();
    expect(defineCustomElements).not.toHaveBeenCalled();
  });

  it('shares concurrent native database opens and migration initialization', async () => {
    const db = createDb();
    const connection = createConnection(db);
    let finishConnectionCheck!: (result: { result: boolean }) => void;
    vi.mocked(connection.isConnection).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConnectionCheck = resolve;
        }),
    );

    const first = openCapacitorRepository({ platform: 'android', connection, document, window });
    const second = openCapacitorRepository({ platform: 'android', connection, document, window });
    expect(connection.isConnection).toHaveBeenCalledOnce();
    finishConnectionCheck({ result: false });
    const [firstRepository, secondRepository] = await Promise.all([first, second]);

    expect(firstRepository).toBe(secondRepository);
    expect(connection.createConnection).toHaveBeenCalledOnce();
    expect(db.open).toHaveBeenCalledOnce();
  });

  it('does not append a duplicate jeep-sqlite element and propagates connection failures', async () => {
    document.body.innerHTML = '<jeep-sqlite></jeep-sqlite>';
    const db = createDb();
    const connection = createConnection(db);
    vi.spyOn(window.customElements, 'whenDefined').mockResolvedValue(class extends HTMLElement {});

    await openCapacitorRepository({ platform: 'web', connection, document, window });
    expect(document.querySelectorAll('jeep-sqlite')).toHaveLength(1);

    const failure = createConnection(db);
    vi.mocked(failure.createConnection).mockRejectedValueOnce(new Error('SQLite unavailable.'));
    await expect(
      openCapacitorRepository({ platform: 'ios', connection: failure, document, window }),
    ).rejects.toThrow('SQLite unavailable.');
    await expect(
      openCapacitorRepository({ platform: 'ios', connection: failure, document, window }),
    ).resolves.toBeDefined();
    expect(failure.createConnection).toHaveBeenCalledTimes(2);
  });

  it('uses Capacitor defaults when platform and connection are not supplied', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    const repository = await openCapacitorRepository();

    expect(defaultSqlite.constructor).toHaveBeenCalledWith(defaultSqlite.plugin);
    expect(defaultSqlite.plugin.isConnection).toHaveBeenCalledWith('eternity-realms', false);
    expect(await repository.load()).toBeNull();
  });

  it('uses window and document defaults for web startup', async () => {
    document.body.replaceChildren(document.createElement('jeep-sqlite'));
    vi.spyOn(window.customElements, 'whenDefined').mockResolvedValue(class extends HTMLElement {});

    await openCapacitorRepository({
      platform: 'web',
      connection: createConnection(createDb(true)),
    });

    expect(defineCustomElements).toHaveBeenCalledWith(window);
    expect(document.querySelectorAll('jeep-sqlite')).toHaveLength(1);
  });
});
