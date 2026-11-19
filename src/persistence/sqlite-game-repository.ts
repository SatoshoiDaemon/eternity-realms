import type { DomainEvent, GameState } from '../domain/types';

export type SqliteValue = string | number | null;

export interface SqliteDriver {
  execute(sql: string): Promise<void>;
  run(sql: string, values?: SqliteValue[]): Promise<void>;
  query<T>(sql: string, values?: SqliteValue[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

interface Migration {
  version: number;
  statements: string[];
}

const migrations: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE game_state (
        id TEXT PRIMARY KEY CHECK (id = 'main'),
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
      )`,
      'CREATE INDEX domain_events_occurred_at ON domain_events (occurred_at)',
    ],
  },
];

function parseGameState(payload: unknown): GameState {
  try {
    if (typeof payload !== 'string') {
      throw new Error('Save payload is not text.');
    }
    const parsed: unknown = JSON.parse(payload);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('schemaVersion' in parsed) ||
      parsed.schemaVersion !== 1 ||
      !('sessions' in parsed) ||
      !Array.isArray(parsed.sessions) ||
      !('queue' in parsed) ||
      !Array.isArray(parsed.queue) ||
      !('events' in parsed) ||
      !Array.isArray(parsed.events) ||
      !('processedEventIds' in parsed) ||
      !Array.isArray(parsed.processedEventIds) ||
      ('combatRecords' in parsed && !Array.isArray(parsed.combatRecords))
    ) {
      throw new Error('Save payload does not match the current schema.');
    }
    return { combatRecords: [], ...(parsed as GameState) };
  } catch {
    throw new Error('Saved game data is invalid.');
  }
}

export class SqliteGameRepository {
  constructor(
    private readonly driver: SqliteDriver,
    private readonly clock: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    await this.driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL)',
    );
    await this.driver.transaction(async () => {
      const rows = await this.driver.query<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version ASC',
      );
      const currentVersion = rows.reduce((highest, row) => Math.max(highest, row.version), 0);
      const latestVersion = migrations.at(-1)!.version;
      if (currentVersion > latestVersion) {
        throw new Error('Save data was created by a newer game version.');
      }
      for (const migration of migrations) {
        if (migration.version > currentVersion) {
          for (const statement of migration.statements) {
            await this.driver.execute(statement);
          }
          await this.driver.run('INSERT INTO schema_migrations (version) VALUES (?)', [
            migration.version,
          ]);
        }
      }
    });
  }

  async load(): Promise<GameState | null> {
    const rows = await this.driver.query<{ payload: unknown }>(
      "SELECT payload FROM game_state WHERE id = 'main' LIMIT 1",
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return parseGameState(row.payload);
  }

  async transact(reducer: (current: GameState | null) => GameState): Promise<GameState> {
    return this.driver.transaction(async () => {
      const current = await this.load();
      const reduced = reducer(current);
      if (reduced.schemaVersion !== 1) {
        throw new Error('Cannot write a save with an unsupported schema version.');
      }
      const next: GameState = { ...reduced, revision: (current?.revision ?? 0) + 1 };
      const payload = JSON.stringify(next);
      if (payload === undefined) {
        throw new Error('Game state could not be serialized.');
      }
      await this.driver.run(
        `INSERT INTO game_state (id, revision, payload, updated_at)
         VALUES ('main', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`,
        [next.revision, payload, this.clock()],
      );
      for (const event of next.events) {
        await this.writeEvent(event);
      }
      return next;
    });
  }

  async loadEvents(): Promise<DomainEvent[]> {
    const rows = await this.driver.query<{ payload: string }>(
      'SELECT payload FROM domain_events ORDER BY rowid ASC',
    );
    try {
      return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
    } catch {
      throw new Error('Saved event history is invalid.');
    }
  }

  private async writeEvent(event: DomainEvent): Promise<void> {
    await this.driver.run(
      'INSERT OR IGNORE INTO domain_events (event_id, payload, occurred_at) VALUES (?, ?, ?)',
      [event.id, JSON.stringify(event), event.occurredAt],
    );
  }
}
