// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SqliteGameRepository } from './sqlite-game-repository';
import { enqueueSession, reconcileSessions } from '../domain/session-engine';
import { createInitialGameState } from '../domain/model';
import { createTestState, newTestSession, testCatalog } from '../test/fixtures';
import { SqlJsDriver } from '../test/sqljs-driver';

describe('SQLite game repository', () => {
  it('applies versioned migrations and can be initialized repeatedly', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);

    await repository.initialize();
    await repository.initialize();

    expect(
      await driver.query<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    expect(await repository.load()).toBeNull();
    driver.close();
  });

  it('commits the save and processed domain events in one transaction', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);
    await repository.initialize();

    const created = await repository.transact(() => createTestState());
    const started = await repository.transact((state) =>
      enqueueSession(state!, newTestSession('s1', 100), testCatalog, 0),
    );
    const completed = await repository.transact((state) =>
      reconcileSessions(state!, 100, testCatalog),
    );

    expect(created.revision).toBe(1);
    expect(started.revision).toBe(2);
    expect(completed.revision).toBe(3);
    expect(completed.character?.inventory['iron-ore']).toBe(2);
    expect((await repository.load())?.events).toEqual(completed.events);
    expect((await repository.loadEvents()).map((event) => event.id)).toEqual(
      completed.processedEventIds,
    );
    driver.close();
  });

  it('recovers a committed offline result after reopening without paying it twice', async () => {
    let driver = await SqlJsDriver.create();
    let repository = new SqliteGameRepository(driver);
    await repository.initialize();
    await repository.transact(() => createTestState());
    await repository.transact((state) =>
      enqueueSession(state!, newTestSession('s1', 100), testCatalog, 0),
    );
    await repository.transact((state) => reconcileSessions(state!, 100, testCatalog));
    const bytes = driver.export();
    driver.close();

    driver = await SqlJsDriver.create(bytes);
    repository = new SqliteGameRepository(driver);
    await repository.initialize();
    const afterReopen = await repository.transact((state) =>
      reconcileSessions(state!, 86_500_000, testCatalog),
    );

    expect(afterReopen.character?.inventory['iron-ore']).toBe(2);
    expect(afterReopen.character?.experience.total).toBe(120);
    expect(
      (await repository.loadEvents()).filter((event) => event.type === 'reward.granted'),
    ).toHaveLength(1);
    driver.close();
  });

  it('persists active elapsed checkpoints across SQLite reopen and clock rollback', async () => {
    let driver = await SqlJsDriver.create();
    let repository = new SqliteGameRepository(driver);
    await repository.initialize();
    await repository.transact(() => createTestState());
    await repository.transact((state) =>
      enqueueSession(state!, newTestSession('rollback-db', 1_000), testCatalog, 100),
    );
    const checkpoint = await repository.transact((state) =>
      reconcileSessions(state!, 600, testCatalog),
    );
    expect(checkpoint.sessions[0]).toMatchObject({
      elapsedMs: 500,
      lastObservedAt: 600,
      status: 'active',
    });
    const bytes = driver.export();
    driver.close();

    driver = await SqlJsDriver.create(bytes);
    repository = new SqliteGameRepository(driver);
    await repository.initialize();
    const afterRollback = await repository.transact((state) =>
      reconcileSessions(state!, 250, testCatalog),
    );
    expect(afterRollback.sessions[0]).toMatchObject({
      elapsedMs: 500,
      lastObservedAt: 600,
      status: 'active',
    });
    expect(afterRollback.character?.inventory).toEqual({});
    const completed = await repository.transact((state) =>
      reconcileSessions(state!, 1_100, testCatalog),
    );
    expect(completed.sessions[0]?.status).toBe('completed');
    expect(completed.character?.inventory['iron-ore']).toBe(2);
    const completedBytes = driver.export();
    driver.close();

    driver = await SqlJsDriver.create(completedBytes);
    repository = new SqliteGameRepository(driver);
    await repository.initialize();
    const afterSecondReopen = await repository.transact((state) =>
      reconcileSessions(state!, 0, testCatalog),
    );
    expect(afterSecondReopen.sessions[0]?.status).toBe('completed');
    expect(afterSecondReopen.character?.inventory['iron-ore']).toBe(2);
    expect(
      (await repository.loadEvents()).filter((event) => event.type === 'reward.granted'),
    ).toHaveLength(1);
    driver.close();
  });

  it('hydrates pre-combat saves with an empty combat history', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);
    await repository.initialize();
    const legacy = { ...createTestState() } as Record<string, unknown>;
    delete legacy.combatRecords;
    await driver.run(
      "INSERT INTO game_state (id, revision, payload, updated_at) VALUES ('main', 0, ?, 0)",
      [JSON.stringify(legacy)],
    );

    expect(await repository.load()).toMatchObject({ combatRecords: [] });
    driver.close();
  });

  it('rolls back state and event writes when the transaction callback fails', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);
    await repository.initialize();
    const before = await repository.transact(() => createInitialGameState());

    await expect(
      repository.transact(() => {
        throw new Error('simulated interruption');
      }),
    ).rejects.toThrow('simulated interruption');

    expect(await repository.load()).toEqual(before);
    expect(await repository.loadEvents()).toEqual([]);
    driver.close();
  });

  it('rejects saves with malformed serialized data and schema versions newer than the app', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);
    await repository.initialize();
    await driver.run(
      "INSERT INTO game_state (id, revision, payload, updated_at) VALUES ('main', 0, '{', 0)",
    );
    await expect(repository.load()).rejects.toThrow('Saved game data is invalid.');
    await driver.run('INSERT INTO schema_migrations (version) VALUES (?)', [999]);
    await expect(repository.initialize()).rejects.toThrow(
      'Save data was created by a newer game version.',
    );
    driver.close();
  });

  it('rejects non-text saves, invalid save schemas, unsupported writes, and invalid event history', async () => {
    const driver = await SqlJsDriver.create();
    const repository = new SqliteGameRepository(driver);
    await repository.initialize();
    await driver.execute(
      "INSERT INTO game_state (id, revision, payload, updated_at) VALUES ('main', 0, X'00', 0)",
    );
    await expect(repository.load()).rejects.toThrow('Saved game data is invalid.');
    await driver.run("UPDATE game_state SET payload = '{}' WHERE id = 'main'");
    await expect(repository.load()).rejects.toThrow('Saved game data is invalid.');
    await driver.run("UPDATE game_state SET payload = 'null' WHERE id = 'main'");
    await expect(repository.load()).rejects.toThrow('Saved game data is invalid.');
    await driver.run("UPDATE game_state SET payload = ? WHERE id = 'main'", [
      JSON.stringify(createTestState()),
    ]);

    await expect(
      repository.transact(() => ({ ...createTestState(), schemaVersion: 2 as 1 })),
    ).rejects.toThrow('Cannot write a save with an unsupported schema version.');
    await expect(
      repository.transact(() =>
        Object.assign(createInitialGameState(), { toJSON: () => undefined }),
      ),
    ).rejects.toThrow('Game state could not be serialized.');
    await driver.execute(
      "INSERT INTO domain_events (event_id, payload, occurred_at) VALUES ('bad', '{', 0)",
    );
    await expect(repository.loadEvents()).rejects.toThrow('Saved event history is invalid.');
    driver.close();
  });
});
