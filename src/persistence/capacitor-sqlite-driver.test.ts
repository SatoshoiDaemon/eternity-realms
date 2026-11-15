// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { CapacitorSqliteDriver } from './capacitor-sqlite-driver';

function createConnection() {
  return {
    execute: vi.fn(async () => ({})),
    run: vi.fn(async () => ({})),
    query: vi.fn(async () => ({ values: [{ value: 'saved' }] })),
    beginTransaction: vi.fn(async () => ({})),
    commitTransaction: vi.fn(async () => ({})),
    rollbackTransaction: vi.fn(async () => ({})),
  } as unknown as SQLiteDBConnection;
}

describe('Capacitor SQLite adapter', () => {
  it('uses parameterized plugin methods and returns query rows', async () => {
    const connection = createConnection();
    const driver = new CapacitorSqliteDriver(connection);

    await driver.execute('CREATE TABLE saves (id TEXT)');
    await driver.run('INSERT INTO saves VALUES (?)', ['main']);
    const rows = await driver.query<{ value: string }>('SELECT value FROM saves');

    expect(connection.execute).toHaveBeenCalledWith('CREATE TABLE saves (id TEXT)', false);
    expect(connection.run).toHaveBeenCalledWith('INSERT INTO saves VALUES (?)', ['main'], false);
    expect(rows).toEqual([{ value: 'saved' }]);
  });

  it('returns an empty array when the plugin has no query values', async () => {
    const connection = createConnection();
    vi.mocked(connection.query).mockResolvedValueOnce({ values: undefined });

    expect(await new CapacitorSqliteDriver(connection).query('SELECT 1')).toEqual([]);
  });

  it('commits successful work and rolls back failed work', async () => {
    const connection = createConnection();
    const driver = new CapacitorSqliteDriver(connection);
    await expect(driver.transaction(async () => 'done')).resolves.toBe('done');
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commitTransaction).toHaveBeenCalledTimes(1);

    await expect(
      driver.transaction(async () => {
        throw new Error('failed operation');
      }),
    ).rejects.toThrow('failed operation');
    expect(connection.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('flushes the committed web database and does not roll back a completed transaction on flush failure', async () => {
    const connection = createConnection();
    const flush = vi.fn(async () => undefined);
    const driver = new CapacitorSqliteDriver(connection, flush);
    await expect(driver.transaction(async () => 9)).resolves.toBe(9);
    expect(flush).toHaveBeenCalledOnce();

    flush.mockRejectedValueOnce(new Error('IndexedDB flush failed.'));
    await expect(driver.transaction(async () => 10)).rejects.toThrow('IndexedDB flush failed.');
    expect(connection.rollbackTransaction).not.toHaveBeenCalled();
  });
});
